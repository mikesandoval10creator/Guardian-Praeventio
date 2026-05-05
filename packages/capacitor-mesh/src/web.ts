// SPDX-License-Identifier: MIT
//
// @praeventio/capacitor-mesh — web simulator (Sprint 30 scaffold).
//
// Uses `BroadcastChannel` to bridge multiple tabs of the same origin so
// the engine + UI can be exercised end-to-end without a physical device.
// Each tab acts as one "peer" identified by its `peerId`.
//
// Wire model on BroadcastChannel('praeventio-mesh-{projectId}'):
//   { kind: 'hello',     peerId, rssi }      — peer joined / heartbeat
//   { kind: 'bye',       peerId }             — peer leaving
//   { kind: 'packet',    fromPeerId, packet } — relayed mesh packet
//
// This is NOT real BLE. It is enough to test the engine wire (see
// transportFacade.ts and its tests). Sprint 31 replaces this whole
// file's behaviour with native BLE GATT.

import { WebPlugin } from '@capacitor/core';

import type {
  MeshPlugin,
  MeshSendResult,
  MeshStartOptions,
  MeshState,
} from './definitions';
import type { MeshPacket } from '../../../src/services/mesh/meshPacket';

interface WireHello {
  kind: 'hello';
  peerId: string;
  rssi: number;
}
interface WireBye {
  kind: 'bye';
  peerId: string;
}
interface WirePacket {
  kind: 'packet';
  fromPeerId: string;
  /**
   * Optional — narrows fan-out to a single peer. Omitted = broadcast to
   * everyone listening on the channel.
   */
  toPeerId?: string;
  packet: MeshPacket;
}
type WireMsg = WireHello | WireBye | WirePacket;

const HEARTBEAT_INTERVAL_MS = 5_000;
const PEER_TIMEOUT_MS = 15_000;

interface KnownPeer {
  id: string;
  rssi: number;
  lastSeenMs: number;
}

/**
 * Indirection point so tests can swap in a fake `BroadcastChannel` even
 * in a Node environment that does not ship one.
 */
type ChannelFactory = (name: string) => BroadcastChannelLike;

export interface BroadcastChannelLike {
  postMessage(msg: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

let channelFactory: ChannelFactory | null = null;

/**
 * Tests inject a fake channel factory before instantiating MeshWeb.
 * Calling with `null` restores the default `globalThis.BroadcastChannel`.
 */
export function __setChannelFactoryForTests(
  factory: ChannelFactory | null,
): void {
  channelFactory = factory;
}

function defaultChannelFactory(name: string): BroadcastChannelLike {
  // We accept `any` here because BroadcastChannel may not exist in older
  // node test runtimes; the factory injection covers that path.
  const Ctor = (globalThis as unknown as { BroadcastChannel?: new (n: string) => BroadcastChannelLike })
    .BroadcastChannel;
  if (!Ctor) {
    throw new Error(
      'MeshWeb: BroadcastChannel is not available in this environment. ' +
        'Install the polyfill or inject __setChannelFactoryForTests().',
    );
  }
  return new Ctor(name);
}

export class MeshWeb extends WebPlugin implements MeshPlugin {
  private active = false;
  private peerId: string | null = null;
  private projectId: string | null = null;
  private channel: BroadcastChannelLike | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly peers: Map<string, KnownPeer> = new Map();
  private packetsRelayed = 0;

  async start(opts: MeshStartOptions): Promise<{ ok: true }> {
    if (this.active) {
      // Idempotent restart: tear down before re-arming so projectId
      // changes (e.g. project switch) take effect immediately.
      await this.stop();
    }
    this.peerId = opts.peerId;
    this.projectId = opts.projectId;
    const factory = channelFactory ?? defaultChannelFactory;
    this.channel = factory(`praeventio-mesh-${opts.projectId}`);
    this.channel.onmessage = (ev: { data: unknown }) =>
      this.handleWire(ev.data as WireMsg);
    this.active = true;
    this.announce();
    this.heartbeatTimer = setInterval(() => {
      this.announce();
      this.reapStalePeers();
    }, HEARTBEAT_INTERVAL_MS);
    return { ok: true };
  }

  async stop(): Promise<{ ok: true }> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.channel && this.peerId) {
      try {
        this.channel.postMessage({
          kind: 'bye',
          peerId: this.peerId,
        } satisfies WireBye);
      } catch {
        /* channel could already be closed in tests */
      }
      this.channel.onmessage = null;
      this.channel.close();
    }
    this.channel = null;
    this.peers.clear();
    this.active = false;
    this.peerId = null;
    this.projectId = null;
    this.packetsRelayed = 0;
    return { ok: true };
  }

  async send(packet: MeshPacket): Promise<MeshSendResult> {
    if (!this.active || !this.channel || !this.peerId) {
      return { deliveredTo: [], queued: [] };
    }
    const peerIds = Array.from(this.peers.keys());
    if (peerIds.length === 0) {
      return { deliveredTo: [], queued: [] };
    }
    this.channel.postMessage({
      kind: 'packet',
      fromPeerId: this.peerId,
      packet,
    } satisfies WirePacket);
    this.packetsRelayed += 1;
    // BroadcastChannel is best-effort fan-out; we report all known peers
    // as "delivered" for the simulator. The native side will track real
    // GATT WRITE_NO_RESPONSE acks.
    return { deliveredTo: peerIds, queued: [] };
  }

  async getState(): Promise<MeshState> {
    return {
      active: this.active,
      peers: Array.from(this.peers.values()).map((p) => ({
        id: p.id,
        rssi: p.rssi,
      })),
      packetsRelayed: this.packetsRelayed,
    };
  }

  // ---------------------------------------------------------------------------

  private announce(): void {
    if (!this.channel || !this.peerId) return;
    const msg: WireHello = {
      kind: 'hello',
      peerId: this.peerId,
      // Synthetic RSSI — fixed to a plausible value for the simulator.
      rssi: -55,
    };
    this.channel.postMessage(msg);
  }

  private handleWire(msg: WireMsg): void {
    if (!msg || typeof msg !== 'object') return;
    if (!this.active || !this.peerId) return;
    switch (msg.kind) {
      case 'hello':
        if (msg.peerId === this.peerId) return; // ignore own heartbeat
        this.upsertPeer(msg.peerId, msg.rssi);
        return;
      case 'bye':
        if (this.peers.delete(msg.peerId)) {
          this.notifyListeners('mesh:peer-lost', { id: msg.peerId });
        }
        return;
      case 'packet':
        if (msg.fromPeerId === this.peerId) return;
        if (msg.toPeerId && msg.toPeerId !== this.peerId) return;
        // Mark the sender as alive too (acts as an implicit heartbeat).
        this.upsertPeer(msg.fromPeerId, -55);
        this.notifyListeners('mesh:packet', msg.packet);
        return;
    }
  }

  private upsertPeer(id: string, rssi: number): void {
    const existing = this.peers.get(id);
    const now = Date.now();
    if (existing) {
      existing.lastSeenMs = now;
      existing.rssi = rssi;
      return;
    }
    this.peers.set(id, { id, rssi, lastSeenMs: now });
    this.notifyListeners('mesh:peer-discovered', { id, rssi });
  }

  private reapStalePeers(): void {
    const cutoff = Date.now() - PEER_TIMEOUT_MS;
    for (const [id, peer] of this.peers.entries()) {
      if (peer.lastSeenMs < cutoff) {
        this.peers.delete(id);
        this.notifyListeners('mesh:peer-lost', { id });
      }
    }
  }
}
