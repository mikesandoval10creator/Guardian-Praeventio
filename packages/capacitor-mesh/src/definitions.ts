// SPDX-License-Identifier: MIT
//
// @praeventio/capacitor-mesh — plugin definitions for native and web transports.
//
// MeshPacket is imported from the main app's pure engine
// (`src/services/mesh/meshPacket.ts`) to avoid duplicating the model.
// Android/iOS BLE implementations live in their native plugin files; this
// file only declares the JS-side surface. Wi-Fi Direct remains unimplemented.

import type { PluginListenerHandle } from '@capacitor/core';
import type { MeshPacket } from '../../../src/services/mesh/meshPacket';

export interface MeshStartOptions {
  /** Worker UID (matches MeshRelayQueue.selfUid). */
  peerId: string;
  /** Project UID — packets from other projects are dropped on receive. */
  projectId: string;
}

export interface MeshSendResult {
  /** Peer UIDs the native layer believes received the packet right now. */
  deliveredTo: string[];
  /** Peer UIDs that were known but unreachable in this attempt. */
  queued: string[];
}

export interface MeshPeerInfo {
  id: string;
  rssi: number;
}

export interface MeshState {
  active: boolean;
  peers: MeshPeerInfo[];
  /** Counter, useful for the diagnostic UI. */
  packetsRelayed: number;
}

export type MeshEventName =
  | 'mesh:packet'
  | 'mesh:peer-discovered'
  | 'mesh:peer-lost';

export interface MeshPlugin {
  /** Start advertising + scanning. Permissions are handled by the plugin. */
  start(opts: MeshStartOptions): Promise<{ ok: true }>;
  stop(): Promise<{ ok: true }>;
  /** Send a packet to known peers (best-effort fan-out). */
  send(packet: MeshPacket): Promise<MeshSendResult>;
  /** Listen for incoming packets received from any peer. */
  addListener(
    eventName: 'mesh:packet',
    cb: (packet: MeshPacket) => void,
  ): Promise<PluginListenerHandle>;
  /** Fired when a new peer enters BLE range. */
  addListener(
    eventName: 'mesh:peer-discovered',
    cb: (peer: MeshPeerInfo) => void,
  ): Promise<PluginListenerHandle>;
  /** Fired when a known peer drops out of range / GATT disconnects. */
  addListener(
    eventName: 'mesh:peer-lost',
    cb: (peer: { id: string }) => void,
  ): Promise<PluginListenerHandle>;
  /** State snapshot for UI badges (peer count, queue depth indicator, etc.). */
  getState(): Promise<MeshState>;
  /** Remove ALL listeners registered through this plugin instance. */
  removeAllListeners(): Promise<void>;
}
