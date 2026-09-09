// SPDX-License-Identifier: MIT
//
// Sprint 30 — Mesh Transport Facade (ADR 0013, Bucket II)
//
// Wires the pure engine (meshPacket / meshRelayQueue / meshRequestRouter)
// to the Capacitor plugin scaffold @praeventio/capacitor-mesh.
//
// On native platforms the plugin proxies BLE GATT (real impl = Sprint 31).
// On web it falls back to the BroadcastChannel-based simulator so multiple
// `npm run dev` tabs exchange packets exactly like two phones would.
//
// Responsibilities:
//   - start/stop the transport, attaching listeners
//   - on every received packet: hand to MeshRelayQueue.receive() and
//     forward forLocal packets to the request router
//   - on every locally enqueued packet: call Mesh.send fan-out
//   - reconcile every 30s: queue cleanup + state snapshot for UI

import { Capacitor, type PluginListenerHandle } from '@capacitor/core';

import { Mesh } from '@praeventio/capacitor-mesh';
import type {
  MeshPlugin,
  MeshPeerInfo,
  MeshState,
} from '@praeventio/capacitor-mesh';

import { buildPacket, isAck, type MeshPacket } from './meshPacket';
import { signPacket, type MeshSigningKey } from './meshPacketSigner';
import type { MeshRelayQueue } from './meshRelayQueue';
import type { MeshRequestRouter } from './meshRequestRouter';

export interface TransportFacadeOptions {
  peerId: string;
  projectId: string;
  queue: MeshRelayQueue;
  router?: MeshRequestRouter;
  /** Override for tests / DI. Defaults to the registered plugin. */
  plugin?: MeshPlugin;
  /** Override Capacitor.isNativePlatform() for tests. */
  isNativePlatform?: () => boolean;
  /** Reconciliation interval — defaults to 30s, mirror of ADR 0013. */
  reconcileIntervalMs?: number;
  /** Time allowed for a complete-packet ACK before requeue. */
  ackTimeoutMs?: number;
  /** Project key used to sign generated ACK packets when provisioned. */
  signingKey?: MeshSigningKey | null;
  /** Clock override for deterministic delivery tests. */
  now?: () => number;
  /** Hook invoked on every reconcile pass (UI badges, telemetry). */
  onReconcile?: (snapshot: TransportSnapshot) => void;
}

export interface TransportSnapshot {
  active: boolean;
  peers: MeshPeerInfo[];
  packetsRelayed: number;
  queueDepth: number;
  /** Whether we are running over native BLE or the web simulator. */
  platform: 'native' | 'web';
}

const DEFAULT_RECONCILE_INTERVAL_MS = 30_000;
const DEFAULT_ACK_TIMEOUT_MS = 10_000;

type PendingDelivery = {
  packet: MeshPacket;
  peerIds: Set<string>;
  /** True when drainForPeer already removed it from the queue. */
  removedFromQueue: boolean;
};

export class TransportFacade {
  private readonly peerId: string;
  private readonly projectId: string;
  private readonly queue: MeshRelayQueue;
  private readonly router?: MeshRequestRouter;
  private readonly plugin: MeshPlugin;
  private readonly platform: 'native' | 'web';
  private readonly reconcileIntervalMs: number;
  private readonly ackTimeoutMs: number;
  private readonly signingKey: MeshSigningKey | null;
  private readonly nowFn: () => number;
  private readonly onReconcile?: (snapshot: TransportSnapshot) => void;

  private listeners: PluginListenerHandle[] = [];
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private pendingDeliveries = new Map<string, PendingDelivery>();
  private pendingAckTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(opts: TransportFacadeOptions) {
    this.peerId = opts.peerId;
    this.projectId = opts.projectId;
    this.queue = opts.queue;
    this.router = opts.router;
    this.plugin = opts.plugin ?? (Mesh as unknown as MeshPlugin);
    const isNative = (opts.isNativePlatform ?? Capacitor.isNativePlatform)();
    this.platform = isNative ? 'native' : 'web';
    this.reconcileIntervalMs =
      opts.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
    this.ackTimeoutMs = opts.ackTimeoutMs ?? DEFAULT_ACK_TIMEOUT_MS;
    this.signingKey = opts.signingKey ?? null;
    this.nowFn = opts.now ?? Date.now;
    this.onReconcile = opts.onReconcile;
  }

  /**
   * Start the transport. Idempotent — calling twice is safe; the second
   * call is a no-op until `stopMesh()` is invoked.
   */
  async startMesh(): Promise<void> {
    if (this.active) return;
    if (!this.plugin) {
      throw new Error(
        'TransportFacade.startMesh: Mesh plugin is not available. ' +
          'Make sure @praeventio/capacitor-mesh is installed and registered.',
      );
    }
    await this.plugin.start({
      peerId: this.peerId,
      projectId: this.projectId,
    });

    const onPacket = await this.plugin.addListener(
      'mesh:packet',
      (packet: MeshPacket) => {
        this.handleIncomingPacket(packet);
      },
    );
    const onPeerDiscovered = await this.plugin.addListener(
      'mesh:peer-discovered',
      (peer: MeshPeerInfo) => {
        // A newly discovered peer is an immediate delivery opportunity. The
        // previous listener was informational only, so queued SOS/breadcrumb
        // packets waited until expiry even though a relay peer had appeared.
        void this.drainForPeer(peer.id);
      },
    );
    const onPeerLost = await this.plugin.addListener(
      'mesh:peer-lost',
      () => {
        // Peer loss is informational at the facade level.
      },
    );
    this.listeners = [onPacket, onPeerDiscovered, onPeerLost];

    this.active = true;
    this.reconcileTimer = setInterval(
      () => void this.reconcile(),
      this.reconcileIntervalMs,
    );
  }

  /**
   * Stop the transport, detach listeners, and clear timers. Idempotent.
   */
  async stopMesh(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    for (const handle of this.listeners) {
      try {
        await handle.remove();
      } catch {
        /* listener already gone */
      }
    }
    this.listeners = [];
    this.clearPendingDeliveries(true);
    try {
      await this.plugin.stop();
    } catch {
      /* plugin already stopped */
    }
  }

  /**
   * Inject a locally-generated packet: enqueue it in the relay queue
   * AND fan it out to every known peer over the transport now.
   */
  async sendLocal(packet: MeshPacket): Promise<{
    enqueued: boolean;
    deliveredTo: string[];
    queued: string[];
  }> {
    const enqRes = this.queue.enqueueLocal(packet);
    if (!this.active || !enqRes.added) {
      return {
        enqueued: enqRes.added,
        deliveredTo: [],
        queued: [],
      };
    }
    const sendRes = await this.plugin.send(packet);
    for (const peerId of sendRes.deliveredTo) {
      this.trackPendingDelivery(packet, peerId, false);
    }
    return {
      enqueued: true,
      deliveredTo: sendRes.deliveredTo,
      queued: sendRes.queued,
    };
  }

  /**
   * Public reconciliation entry — runs the same logic the timer fires.
   * Useful for tests that don't want to wait on real timers.
   */
  async reconcile(): Promise<TransportSnapshot> {
    this.queue.cleanup();
    let pluginState: MeshState;
    try {
      pluginState = await this.plugin.getState();
    } catch {
      pluginState = { active: false, peers: [], packetsRelayed: 0 };
    }
    const snap: TransportSnapshot = {
      active: pluginState.active,
      peers: pluginState.peers,
      packetsRelayed: pluginState.packetsRelayed,
      queueDepth: this.queue.size(),
      platform: this.platform,
    };
    this.onReconcile?.(snap);
    return snap;
  }

  /** Snapshot for UI consumers without forcing a reconcile cycle. */
  async snapshot(): Promise<TransportSnapshot> {
    return this.reconcile();
  }

  /**
   * Retry queued packets when a peer appears. The native plugin currently
   * reports local write acceptance in deliveredTo; the facade keeps that
   * packet pending until a complete-packet ACK arrives.
   */
  private async drainForPeer(peerId: string): Promise<void> {
    const { toSend } = this.queue.drainForPeer(peerId);
    for (const packet of toSend) {
      const pending = this.pendingDeliveries.get(packet.id);
      if (pending?.peerIds.has(peerId)) {
        // A direct send is already awaiting this peer's ACK. Restore the
        // queue entry instead of issuing a duplicate packet.
        this.queue.requeue(packet);
        continue;
      }
      try {
        const result = await this.plugin.send(packet);
        if (result.deliveredTo.includes(peerId)) {
          this.trackPendingDelivery(packet, peerId, true);
        } else {
          this.queue.requeue(packet);
        }
      } catch {
        this.queue.requeue(packet);
      }
    }
  }

  // ---------------------------------------------------------------------------

  private handleIncomingPacket(packet: MeshPacket): void {
    // receive() is async (verify-on-receive runs WebCrypto). Only VERIFIED
    // packets reach forLocal; untrusted SOS are relayed but intentionally NOT
    // handed to the local router for auto-escalation.
    void (async () => {
      const result = await this.queue.receive([packet]);
      const acceptedIds = new Set([
        ...result.forLocal.map((item) => item.id),
        ...result.enqueued.map((item) => item.id),
      ]);
      const untrusted = result.untrusted.some((item) => item.id === packet.id);

      if (isAck(packet)) {
        if (result.forLocal.some((item) => item.id === packet.id)) {
          this.handleDeliveryAck(packet);
        }
        return;
      }

      if (
        packet.fromUid !== this.peerId &&
        acceptedIds.has(packet.id) &&
        !untrusted
      ) {
        void this.sendReceiptAck(packet);
      }
      if (this.router && result.forLocal.length > 0) {
        void this.router.processIncomingPackets(result.forLocal);
      }
    })();
  }

  private async sendReceiptAck(packet: MeshPacket): Promise<void> {
    const base = buildPacket({
      type: 'ack',
      fromUid: this.peerId,
      toUid: packet.fromUid,
      bornAtMs: this.nowFn(),
      payload: {
        ackedPacketId: packet.id,
        confirmedBy: this.peerId,
      },
    });
    let ack = base;
    if (this.signingKey) {
      try {
        const signature = await signPacket(base, this.signingKey);
        ack = { ...base, ...signature };
      } catch {
        // A receipt that cannot be signed must not be emitted as trusted.
        return;
      }
    }
    try {
      await this.plugin.send(ack);
    } catch {
      // The original packet remains in the relay queue if its own ACK is absent.
    }
  }

  private handleDeliveryAck(packet: MeshPacket): void {
    if (packet.toUid !== this.peerId) return;
    const payload = packet.payload as {
      ackedPacketId?: unknown;
      confirmedBy?: unknown;
    };
    if (
      typeof payload.ackedPacketId !== 'string' ||
      payload.confirmedBy !== packet.fromUid
    ) {
      return;
    }
    const pending = this.pendingDeliveries.get(payload.ackedPacketId);
    if (!pending || !pending.peerIds.has(packet.fromUid)) return;
    this.clearPending(payload.ackedPacketId);
    this.queue.markDelivered(payload.ackedPacketId);
  }

  private trackPendingDelivery(
    packet: MeshPacket,
    peerId: string,
    removedFromQueue: boolean,
  ): void {
    const current = this.pendingDeliveries.get(packet.id);
    const peerIds = current?.peerIds ?? new Set<string>();
    peerIds.add(peerId);
    this.pendingDeliveries.set(packet.id, {
      packet,
      peerIds,
      removedFromQueue: Boolean(current?.removedFromQueue || removedFromQueue),
    });
    this.clearPendingTimer(packet.id);
    this.pendingAckTimers.set(
      packet.id,
      setTimeout(() => this.expirePending(packet.id), this.ackTimeoutMs),
    );
  }

  private expirePending(packetId: string): void {
    const pending = this.pendingDeliveries.get(packetId);
    if (!pending) return;
    this.clearPending(packetId);
    if (
      pending.removedFromQueue &&
      !this.queue.snapshot().some((packet) => packet.id === packetId)
    ) {
      this.queue.requeue(pending.packet);
    }
  }

  private clearPending(packetId: string): void {
    this.clearPendingTimer(packetId);
    this.pendingDeliveries.delete(packetId);
  }

  private clearPendingTimer(packetId: string): void {
    const timer = this.pendingAckTimers.get(packetId);
    if (timer) clearTimeout(timer);
    this.pendingAckTimers.delete(packetId);
  }

  private clearPendingDeliveries(requeueRemoved: boolean): void {
    for (const [packetId, pending] of this.pendingDeliveries) {
      this.clearPendingTimer(packetId);
      if (
        requeueRemoved &&
        pending.removedFromQueue &&
        !this.queue.snapshot().some((packet) => packet.id === packetId)
      ) {
        this.queue.requeue(pending.packet);
      }
    }
    this.pendingDeliveries.clear();
  }

}

/**
 * Convenience constructor that mirrors the Sprint 30 spec verb for the
 * UI / hook layer: `await startMesh(peerId, projectId, queue, router?)`
 * keeps callers from having to remember the options bag.
 */
export async function startMesh(
  peerId: string,
  projectId: string,
  queue: MeshRelayQueue,
  router?: MeshRequestRouter,
  extra?: Partial<TransportFacadeOptions>,
): Promise<TransportFacade> {
  const facade = new TransportFacade({
    peerId,
    projectId,
    queue,
    router,
    ...(extra ?? {}),
  });
  await facade.startMesh();
  return facade;
}
