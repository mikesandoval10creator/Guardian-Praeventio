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

import type { MeshPacket } from './meshPacket';
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

export class TransportFacade {
  private readonly peerId: string;
  private readonly projectId: string;
  private readonly queue: MeshRelayQueue;
  private readonly router?: MeshRequestRouter;
  private readonly plugin: MeshPlugin;
  private readonly platform: 'native' | 'web';
  private readonly reconcileIntervalMs: number;
  private readonly onReconcile?: (snapshot: TransportSnapshot) => void;

  private listeners: PluginListenerHandle[] = [];
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private active = false;

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
      () => {
        // Peer discovery alone does not move packets; reconciliation
        // will pick up the new peer in its next pass. We still record
        // the listener so removeAllListeners cleans up.
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

  // ---------------------------------------------------------------------------

  private handleIncomingPacket(packet: MeshPacket): void {
    // receive() is async (verify-on-receive runs WebCrypto). Only VERIFIED
    // packets reach forLocal; untrusted SOS are relayed but intentionally NOT
    // handed to the local router for auto-escalation.
    void (async () => {
      const result = await this.queue.receive([packet]);
      if (this.router && result.forLocal.length > 0) {
        void this.router.processIncomingPackets(result.forLocal);
      }
    })();
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
