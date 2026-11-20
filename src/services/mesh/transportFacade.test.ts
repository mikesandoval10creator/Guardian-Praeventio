// SPDX-License-Identifier: MIT
//
// Sprint 30 — TransportFacade tests (ADR 0013, Bucket II).
//
// Exercises the wire between the Sprint 25 engine and the Sprint 30
// Capacitor plugin scaffold. The plugin is mocked end-to-end so these
// tests run on Node/jsdom without any native bridge.

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPacket, type MeshPacket } from './meshPacket';
import {
  signPacket,
  verifyPacket,
  type MeshSigningKey,
} from './meshPacketSigner';
import { MeshRelayQueue } from './meshRelayQueue';
import { TransportFacade } from './transportFacade';
import type {
  MeshPlugin,
  MeshSendResult,
  MeshState,
} from '@praeventio/capacitor-mesh';

interface FakeListenerHandle {
  remove: () => Promise<void>;
}

interface FakePlugin extends MeshPlugin {
  __emit(eventName: string, payload: unknown): void;
  __startCalls: number;
  __stopCalls: number;
  __sentPackets: MeshPacket[];
  __sendImpl: ((p: MeshPacket) => MeshSendResult | Promise<MeshSendResult>) | null;
  __nextState: MeshState;
}

function makeFakePlugin(): FakePlugin {
  const handlers: Record<string, ((data: unknown) => void)[]> = {};

  const fake: FakePlugin = {
    __startCalls: 0,
    __stopCalls: 0,
    __sentPackets: [],
    __sendImpl: null,
    __nextState: { active: false, peers: [], packetsRelayed: 0 },
    __emit(eventName, payload) {
      const list = handlers[eventName] ?? [];
      for (const h of list) h(payload);
    },
    async start() {
      fake.__startCalls += 1;
      fake.__nextState = {
        active: true,
        peers: [],
        packetsRelayed: 0,
      };
      return { ok: true };
    },
    async stop() {
      fake.__stopCalls += 1;
      fake.__nextState = { active: false, peers: [], packetsRelayed: 0 };
      return { ok: true };
    },
    async send(packet: MeshPacket): Promise<MeshSendResult> {
      fake.__sentPackets.push(packet);
      if (fake.__sendImpl) return fake.__sendImpl(packet);
      return { deliveredTo: [], queued: [] };
    },
    addListener(eventName: string, cb: (data: unknown) => void) {
      const list = handlers[eventName] ?? [];
      list.push(cb);
      handlers[eventName] = list;
      const handle: FakeListenerHandle = {
        remove: async () => {
          handlers[eventName] = (handlers[eventName] ?? []).filter(
            (h) => h !== cb,
          );
        },
      };
      return Promise.resolve(handle as unknown as Awaited<ReturnType<MeshPlugin['addListener']>>);
    },
    async getState(): Promise<MeshState> {
      return fake.__nextState;
    },
    async removeAllListeners(): Promise<void> {
      for (const k of Object.keys(handlers)) handlers[k] = [];
    },
  } as FakePlugin;
  return fake;
}

function makePacket(overrides: Partial<Parameters<typeof buildPacket>[0]> = {}): MeshPacket {
  return buildPacket({
    type: 'gps_breadcrumb',
    fromUid: overrides.fromUid ?? 'worker-A',
    toUid: 'broadcast',
    bornAtMs: Date.now(),
    payload: {
      workerUid: 'worker-A',
      lat: -33.4,
      lng: -70.6,
      accuracyM: 8,
      capturedAtMs: Date.now(),
      projectId: 'project-X',
    },
    projectId: 'project-X',
    ...overrides,
  });
}

it('restores an originating SOS after restarting before acknowledgement', async () => {

  const { createOriginatingSosStore } = await import('./originatingSosStore');
  const { clearEncryptedStore } = await import('../security/encryptedKvStore');
  const plugin = makeFakePlugin();
  const options = { selfUid: 'worker-self', projectId: 'project-X' };
  const makeFacade = () => new TransportFacade({
    peerId: options.selfUid, projectId: options.projectId,
    queue: new MeshRelayQueue(options), plugin,
    packetStore: createOriginatingSosStore(options.selfUid, options.projectId),
  });
  const packet = makePacket({ type: 'sos', fromUid: options.selfUid });
  const first = makeFacade();
  await first.startMesh();
  try {
    await first.sendLocal(packet);
  } finally {
    await first.stopMesh();
  }
  const restarted = makeFacade();
  try {
    await restarted.startMesh();
    expect((await restarted.snapshot()).queueDepth).toBe(1);
    plugin.__sentPackets.length = 0;
    plugin.__emit('mesh:peer-discovered', { id: 'peer-1', rssi: -40 });
    expect(plugin.__sentPackets.at(-1)?.id).toBe(packet.id);
    expect(await createOriginatingSosStore('different-user', options.projectId).load()).toEqual([]);
    expect(await createOriginatingSosStore(options.selfUid, 'different-project').load()).toEqual([]);
  } finally {
    await restarted.stopMesh();
    await clearEncryptedStore();
  }
});

it('removes a persisted originating SOS only after its peer receipt', async () => {
  const { createOriginatingSosStore } = await import('./originatingSosStore');
  const { clearEncryptedStore } = await import('../security/encryptedKvStore');
  const signingKey = await makeSigningKey();
  const plugin = makeFakePlugin();
  plugin.__sendImpl = () => ({ deliveredTo: ['peer-1'], queued: [] });
  const scope = { selfUid: 'worker-self', projectId: 'project-X' };
  const store = createOriginatingSosStore(scope.selfUid, scope.projectId);
  const facade = new TransportFacade({
    peerId: scope.selfUid, projectId: scope.projectId, plugin, packetStore: store,
    queue: new MeshRelayQueue({ ...scope, signingKey }), signingKey,
  });
  try {
    await facade.startMesh();
    const packet = makePacket({ type: 'sos', fromUid: scope.selfUid });
    await facade.sendLocal(packet);
    expect((await store.load()).map(({ id }) => id)).toEqual([packet.id]);
    const ack = makeAck(packet.id);
    plugin.__emit('mesh:packet', { ...ack, ...(await signPacket(ack, signingKey)) });
    await vi.waitFor(async () => expect(await store.load()).toEqual([]));
    expect((await facade.snapshot()).queueDepth).toBe(0);
  } finally {
    await facade.stopMesh();
    await clearEncryptedStore();
  }
});

it('still attempts live delivery when saving an SOS fails', async () => {
  const plugin = makeFakePlugin();
  const onPersistenceError = vi.fn();
  const scope = { selfUid: 'worker-self', projectId: 'project-X' };
  const facade = new TransportFacade({
    peerId: scope.selfUid, projectId: scope.projectId, plugin, onPersistenceError,
    queue: new MeshRelayQueue(scope),
    packetStore: {
      async load() { return []; },
      async save() { throw new Error('test storage failure'); },
      async remove() {},
    },
  });
  try {
    await facade.startMesh();
    const packet = makePacket({ type: 'sos', fromUid: scope.selfUid });
    await facade.sendLocal(packet);
    expect(plugin.__sentPackets).toEqual([packet]);
    expect(onPersistenceError).toHaveBeenCalledOnce();
    expect((await facade.snapshot()).queueDepth).toBe(1);
  } finally {
    await facade.stopMesh();
  }
});

function makeAck(ackedPacketId: string, fromUid = 'peer-1'): MeshPacket {
  return buildPacket({
    type: 'ack',
    fromUid,
    toUid: 'worker-self',
    bornAtMs: Date.now(),
    payload: {
      ackedPacketId,
      confirmedBy: fromUid,
    },
  });
}

async function makeSigningKey(keyId = 'project-X:v1'): Promise<MeshSigningKey> {
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(32).fill(7),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return { keyId, key };
}

describe('TransportFacade', () => {
  let queue: MeshRelayQueue;
  let queueKey: MeshSigningKey;
  let plugin: FakePlugin;

  beforeEach(async () => {
    queueKey = await makeSigningKey();
    queue = new MeshRelayQueue({
      selfUid: 'worker-self',
      projectId: 'project-X',
      signingKey: queueKey,
    });
    plugin = makeFakePlugin();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startMesh delegates to the plugin and reports the platform correctly', async () => {
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    await facade.startMesh();
    expect(plugin.__startCalls).toBe(1);
    const snap = await facade.snapshot();
    expect(snap.platform).toBe('web');
    expect(snap.active).toBe(true);

    // Native path
    const facadeNative = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue: new MeshRelayQueue({ selfUid: 'worker-self', projectId: 'project-X' }),
      plugin,
      isNativePlatform: () => true,
    });
    await facadeNative.startMesh();
    const nativeSnap = await facadeNative.snapshot();
    expect(nativeSnap.platform).toBe('native');

    await facade.stopMesh();
    await facadeNative.stopMesh();
  });

  it('peer-discovered listener registers and updates the state snapshot', async () => {
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    await facade.startMesh();

    plugin.__nextState = {
      active: true,
      peers: [{ id: 'peer-1', rssi: -40 }],
      packetsRelayed: 0,
    };
    plugin.__emit('mesh:peer-discovered', { id: 'peer-1', rssi: -40 });

    const snap = await facade.snapshot();
    expect(snap.peers).toEqual([{ id: 'peer-1', rssi: -40 }]);

    await facade.stopMesh();
  });

  it('peer discovery drains queued packets and removes only confirmed delivery', async () => {
    plugin.__sendImpl = () => ({ deliveredTo: ['peer-1'], queued: [] });
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    await facade.startMesh();

    const packet = makePacket({ fromUid: 'worker-self' });
    await facade.sendLocal(packet);
    expect(queue.size()).toBe(1);

    plugin.__emit('mesh:peer-discovered', { id: 'peer-1', rssi: -40 });
    await vi.waitFor(
      () => expect(plugin.__sentPackets).toHaveLength(1),
      { timeout: 1000, interval: 10 },
    );
    // A native write is only local acceptance; the queue remains until peer ACK.
    expect(queue.size()).toBe(1);

    const ack = makeAck(packet.id);
    plugin.__emit('mesh:packet', {
      ...ack,
      ...(await signPacket(ack, queueKey)),
    });
    await vi.waitFor(
      () => expect(queue.size()).toBe(0),
      { timeout: 1000, interval: 10 },
    );

    await facade.stopMesh();
  });

  it('requeues a packet when the discovered peer is not confirmed as delivered', async () => {
    plugin.__sendImpl = () => ({ deliveredTo: [], queued: ['peer-1'] });
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    await facade.startMesh();

    await facade.sendLocal(makePacket({ fromUid: 'worker-self' }));
    plugin.__emit('mesh:peer-discovered', { id: 'peer-1', rssi: -40 });
    await vi.waitFor(
      () => expect(plugin.__sentPackets).toHaveLength(2),
      { timeout: 1000, interval: 10 },
    );
    expect(queue.size()).toBe(1);

    await facade.stopMesh();
  });

  it('does not confirm a delivery from an unexpected peer', async () => {
    plugin.__sendImpl = () => ({ deliveredTo: ['peer-1'], queued: [] });
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    await facade.startMesh();

    const packet = makePacket({ fromUid: 'worker-self' });
    await facade.sendLocal(packet);
    const unexpectedAck = makeAck(packet.id, 'peer-2');
    const receiveSpy = vi.spyOn(queue, 'receive');
    plugin.__emit('mesh:packet', {
      ...unexpectedAck,
      ...(await signPacket(unexpectedAck, queueKey)),
    });
    await vi.waitFor(
      () => expect(receiveSpy).toHaveBeenCalledTimes(1),
      { timeout: 1000, interval: 10 },
    );
    expect(queue.size()).toBe(1);

    await facade.stopMesh();
  });

  it.each([
    { from: 'peer-1', accepted: true, confirms: true },
    { from: 'peer-2', accepted: true, confirms: false },
    { from: 'peer-1', accepted: false, confirms: false },
  ])('handles an early relay ACK from $from with transport acceptance=$accepted', async ({ from, accepted, confirms }) => {
    let finishSend!: (result: MeshSendResult) => void;
    const send = new Promise<MeshSendResult>((resolve) => { finishSend = resolve; });
    plugin.__sendImpl = () => send;
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    await facade.startMesh();
    try {
      const packet = makePacket({ fromUid: 'worker-self' });
      const ack = makeAck(packet.id, from);
      const signedAck = { ...ack, ...(await signPacket(ack, queueKey)) };
      const receive = vi.spyOn(queue, 'receive');
      queue.enqueueLocal(packet);
      plugin.__emit('mesh:peer-discovered', { id: 'peer-1', rssi: -40 });
      expect(plugin.__sentPackets).toHaveLength(1);
      plugin.__emit('mesh:packet', signedAck);
      expect((await receive.mock.results[0]?.value)?.forLocal).toEqual([signedAck]);
      expect(queue.snapshot()).toEqual([packet]);
      finishSend(accepted ? { deliveredTo: ['peer-1'], queued: [] } : { deliveredTo: [], queued: ['peer-1'] });
      if (confirms) {
        await vi.waitFor(() => expect(queue.snapshot()).toEqual([]));
      } else {
        // A different peer can retry once the first attempt releases the packet.
        await vi.waitFor(() => {
          if (plugin.__sentPackets.length === 1) {
            plugin.__emit('mesh:peer-discovered', { id: 'peer-3', rssi: -40 });
          }
          expect(plugin.__sentPackets).toHaveLength(2);
        });
        expect(queue.snapshot()).toEqual([packet]);
      }
    } finally {
      finishSend({ deliveredTo: [], queued: [] });
      await facade.stopMesh();
    }
  });

  it('retains the original packet until ACK, without spending a hop on retry', async () => {
    plugin.__sendImpl = () => ({ deliveredTo: ['peer-1'], queued: [] });
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
      ackTimeoutMs: 20,
    });
    await facade.startMesh();

    const packet = makePacket({ fromUid: 'worker-self' });
    queue.enqueueLocal(packet);
    plugin.__emit('mesh:peer-discovered', { id: 'peer-1', rssi: -40 });
    await vi.waitFor(
      () => expect(plugin.__sentPackets).toHaveLength(1),
      { timeout: 1000, interval: 10 },
    );
    try {
      expect(queue.snapshot()).toEqual([packet]);
      await new Promise((resolve) => setTimeout(resolve, 35));
      plugin.__emit('mesh:peer-discovered', { id: 'peer-1', rssi: -40 });
      await vi.waitFor(() => expect(plugin.__sentPackets).toHaveLength(2));
      expect(plugin.__sentPackets[1]).toEqual(plugin.__sentPackets[0]);
      const ack = makeAck(packet.id, 'peer-1');
      plugin.__emit('mesh:packet', { ...ack, ...(await signPacket(ack, queueKey)) });
      await vi.waitFor(() => expect(queue.snapshot()).toEqual([]));
    } finally {
      await facade.stopMesh();
    }
  });

  it('sendLocal enqueues into the queue AND fans out via the plugin', async () => {
    plugin.__sendImpl = () => ({
      deliveredTo: ['peer-1', 'peer-2'],
      queued: [],
    });
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    await facade.startMesh();

    const packet = makePacket({ fromUid: 'worker-self' });
    const res = await facade.sendLocal(packet);

    expect(res.enqueued).toBe(true);
    expect(res.deliveredTo).toEqual(['peer-1', 'peer-2']);
    expect(plugin.__sentPackets).toHaveLength(1);
    expect(plugin.__sentPackets[0]?.id).toBe(packet.id);
    expect(queue.size()).toBe(1);

    await facade.stopMesh();
  });

  it('receiving an accepted packet emits an ACK to its original sender', async () => {
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    await facade.startMesh();

    const packet = makePacket({ fromUid: 'worker-other' });
    plugin.__emit('mesh:packet', {
      ...packet,
      ...(await signPacket(packet, queueKey)),
    });
    await vi.waitFor(
      () => {
        const ack = plugin.__sentPackets.find((sent) => sent.type === 'ack');
        expect(ack).toMatchObject({
          type: 'ack',
          fromUid: 'worker-self',
          toUid: 'worker-other',
          payload: {
            ackedPacketId: packet.id,
            confirmedBy: 'worker-self',
          },
        });
      },
      { timeout: 1000, interval: 10 },
    );

    await facade.stopMesh();
  });

  it('acknowledges each hop of a three-peer SOS relay in a simulated transport', async () => {
    const makeNode = (peerId: string) => {
      const nodeQueue = new MeshRelayQueue({ selfUid: peerId, projectId: 'project-X', signingKey: queueKey });
      const transport = makeFakePlugin();
      const facade = new TransportFacade({
        peerId, projectId: 'project-X', queue: nodeQueue, plugin: transport,
        signingKey: queueKey, isNativePlatform: () => false,
      });
      return { peerId, queue: nodeQueue, transport, facade };
    };
    const origin = makeNode('origin');
    const relay = makeNode('relay');
    const receiver = makeNode('receiver');
    const connect = (sender: typeof origin, neighbor: typeof origin) => {
      sender.transport.__sendImpl = (packet) => {
        neighbor.transport.__emit('mesh:packet', packet);
        return { deliveredTo: [neighbor.peerId], queued: [] };
      };
    };

    const unsigned = makePacket({
      type: 'sos', fromUid: origin.peerId,
      payload: { projectId: 'project-X', triggerReason: 'fall' },
    });
    const sos = { ...unsigned, ...(await signPacket(unsigned, queueKey)) };
    try {
      await Promise.all([origin.facade.startMesh(), relay.facade.startMesh(), receiver.facade.startMesh()]);
      connect(origin, relay);
      connect(relay, origin);
      expect((await origin.facade.sendLocal(sos)).enqueued).toBe(true);
      await vi.waitFor(() => expect(origin.queue.snapshot()).toEqual([]));
      expect(relay.queue.snapshot()).toEqual([sos]);

      // The origin is now out of range; only relay and receiver are neighbors.
      connect(relay, receiver);
      connect(receiver, relay);
      relay.transport.__emit('mesh:peer-discovered', { id: receiver.peerId, rssi: -40 });
      expect(relay.queue.snapshot()).toEqual([sos]);
      await vi.waitFor(() => expect(receiver.transport.__sentPackets).toHaveLength(1));
      expect(receiver.queue.snapshot()).toEqual([expect.objectContaining({ id: sos.id, fromUid: origin.peerId })]);
      expect(receiver.transport.__sentPackets[0]).toMatchObject({
        type: 'ack', fromUid: receiver.peerId, toUid: relay.peerId,
        payload: { ackedPacketId: sos.id, confirmedBy: receiver.peerId },
      });
      await vi.waitFor(() => expect(relay.queue.snapshot()).toEqual([]));
    } finally {
      await Promise.all([origin.facade.stopMesh(), relay.facade.stopMesh(), receiver.facade.stopMesh()]);
    }
  });

  it('signs generated ACKs when verify-on-receive has a project key', async () => {
    const signingKey = await makeSigningKey();
    queue = new MeshRelayQueue({
      selfUid: 'worker-self',
      projectId: 'project-X',
      signingKey,
    });
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      signingKey,
      isNativePlatform: () => false,
    });
    await facade.startMesh();

    const inbound = makePacket({ fromUid: 'worker-other' });
    const signature = await signPacket(inbound, signingKey);
    plugin.__emit('mesh:packet', { ...inbound, ...signature });

    let ack: MeshPacket | undefined;
    await vi.waitFor(
      () => {
        ack = plugin.__sentPackets.find((sent) => sent.type === 'ack');
        expect(ack).toBeDefined();
      },
      { timeout: 1000, interval: 10 },
    );
    if (!ack) throw new Error('expected a generated ACK');
    expect(await verifyPacket(ack, signingKey)).toBe(true);

    await facade.stopMesh();
  });

  it('incoming packets land in the queue receive() pipeline', async () => {
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    const receiveSpy = vi.spyOn(queue, 'receive');
    await facade.startMesh();

    const packet = makePacket({ fromUid: 'worker-other' });
    plugin.__emit('mesh:packet', packet);

    expect(receiveSpy).toHaveBeenCalledTimes(1);
    expect(receiveSpy.mock.calls[0]?.[0]).toEqual([packet]);

    await facade.stopMesh();
  });

  it('stopMesh detaches listeners and stops the plugin', async () => {
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    await facade.startMesh();
    const receiveSpy = vi.spyOn(queue, 'receive');

    await facade.stopMesh();
    expect(plugin.__stopCalls).toBe(1);

    // After stop, emitted packets should no longer reach the queue.
    plugin.__emit('mesh:packet', makePacket({ fromUid: 'worker-other' }));
    expect(receiveSpy).not.toHaveBeenCalled();
  });

  it('sendLocal returns enqueued=false and skips fan-out when not started', async () => {
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    const packet = makePacket({ fromUid: 'worker-self' });
    const res = await facade.sendLocal(packet);
    // Queue still accepts (engine doesn't know facade isn't started),
    // but the facade short-circuits the fan-out path.
    expect(res.deliveredTo).toEqual([]);
    expect(plugin.__sentPackets).toHaveLength(0);
  });

  it('reconcile() tolerates a getState() failure without throwing', async () => {
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    await facade.startMesh();
    plugin.getState = () => {
      throw new Error('plugin dead');
    };
    const snap = await facade.reconcile();
    expect(snap.active).toBe(false);
    expect(snap.peers).toEqual([]);
    await facade.stopMesh();
  });

  it('startMesh is idempotent when called twice in a row', async () => {
    const facade = new TransportFacade({
      peerId: 'worker-self',
      projectId: 'project-X',
      queue,
      plugin,
      isNativePlatform: () => false,
    });
    await facade.startMesh();
    await facade.startMesh();
    expect(plugin.__startCalls).toBe(1);
    await facade.stopMesh();
  });
});
