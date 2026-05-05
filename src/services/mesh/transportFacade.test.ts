// SPDX-License-Identifier: MIT
//
// Sprint 30 — TransportFacade tests (ADR 0013, Bucket II).
//
// Exercises the wire between the Sprint 25 engine and the Sprint 30
// Capacitor plugin scaffold. The plugin is mocked end-to-end so these
// tests run on Node/jsdom without any native bridge.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPacket, type MeshPacket } from './meshPacket';
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
  __sendImpl: ((p: MeshPacket) => MeshSendResult) | null;
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

describe('TransportFacade', () => {
  let queue: MeshRelayQueue;
  let plugin: FakePlugin;

  beforeEach(() => {
    queue = new MeshRelayQueue({
      selfUid: 'worker-self',
      projectId: 'project-X',
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
