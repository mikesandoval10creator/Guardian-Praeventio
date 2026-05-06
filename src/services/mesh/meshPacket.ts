// SPDX-License-Identifier: MIT
//
// Sprint 25 — Mesh Packet (ADR 0013)
//
// Modelo + helpers de paquetes de la red mesh Bluetooth/Wi-Fi Direct.
// Función pura — NO toca transport físico. El transport vive en
// `@praeventio/capacitor-mesh` (Sprint 26+, Kotlin/Swift nativo).
// Stack 100% propio open-source — sin SDKs comerciales (ver ADR 0013).
//
// Acá vive la lógica de:
//   - sign/verify integridad
//   - content-addressed IDs (SHA-256)
//   - TTL/expiry checks
//   - dedup (loop avoidance)
//   - priority ordering

// Sprint 33 D3 build fix — replaced node:crypto.createHash with @noble/hashes
// because Sprint 33 wired meshFallback.ts (which imports buildPacket) into
// the browser bundle for offline SOS rebroadcast (audit wire W10). vite
// rejects node:crypto in client builds (__vite-browser-external doesn't
// export createHash). @noble/hashes is sync, browser+node compatible, and
// adds ~10KB gzipped to the bundle. The deterministic content-addressed
// hash semantic stays identical (sha256 of canonical JSON).
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

export type MeshPacketType =
  | 'gps_breadcrumb'
  | 'file_request'
  | 'file_chunk'
  | 'event_to_supervisor'
  | 'sos'
  | 'ack';

export type MeshPacketPriority = 'sos' | 'high' | 'normal' | 'low';

export type MeshDestination = string | 'broadcast' | 'supervisors';

export interface MeshPacket {
  /** SHA-256 del payload + fromUid + bornAtMs. Content-addressed. */
  id: string;
  type: MeshPacketType;
  fromUid: string;
  toUid: MeshDestination;

  /** Hops remaining. Decrementa en cada relay. */
  ttl: number;
  /** Hops actuales (diagnóstico). */
  hopCount: number;

  bornAtMs: number;
  expiresAtMs: number;

  /** Tipo-específico. Validado por type guards al consumir. */
  payload: unknown;

  /** Firma del fromUid sobre payload. */
  signature: string;
  signaturePublicKeyId: string;

  /** UIDs que ya relayaron este packet (loop avoidance). */
  relayedBy: string[];

  /** Solo informativo en payload de project-scope packets. */
  projectId?: string;

  priority: MeshPacketPriority;
}

// ---------------------------------------------------------------------------
// Payload type guards (los consumers usan esto para narrow type)
// ---------------------------------------------------------------------------

export interface GpsBreadcrumbPayload {
  workerUid: string;
  lat: number;
  lng: number;
  accuracyM: number;
  capturedAtMs: number;
  projectId: string;
}

export interface FileRequestPayload {
  requesterUid: string;
  nodeId: string;
  contentHash: string | null;
  title: string;
  projectId: string;
}

export interface FileChunkPayload {
  requestId: string;
  contentHash: string;
  chunkIndex: number;
  totalChunks: number;
  /** Base64-encoded para serialización. Decoder reconstituye Uint8Array. */
  dataBase64: string;
  projectId: string;
}

export interface EventToSupervisorPayload {
  eventType:
    | 'incident'
    | 'evacuation'
    | 'medical'
    | 'leak'
    | 'fire';
  workerUid: string;
  location: { lat: number; lng: number; accuracyM: number };
  capturedAtMs: number;
  description: string;
  photoHash?: string;
  projectId: string;
}

export interface SosPayload {
  workerUid: string;
  location: { lat: number; lng: number; accuracyM: number };
  capturedAtMs: number;
  triggerReason:
    | 'fall_detected'
    | 'manual'
    | 'man_down_timeout'
    | 'no_response';
  projectId: string;
}

export interface AckPayload {
  ackedPacketId: string;
  confirmedBy: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_TTL_BY_TYPE: Record<MeshPacketType, number> = {
  gps_breadcrumb: 4,
  file_request: 8,
  file_chunk: 12,
  event_to_supervisor: 12,
  sos: 16,
  ack: 4,
};

export const DEFAULT_LIFETIME_MS_BY_TYPE: Record<MeshPacketType, number> = {
  gps_breadcrumb: 6 * 60 * 60 * 1000, // 6h
  file_request: 24 * 60 * 60 * 1000, // 24h
  file_chunk: 60 * 60 * 1000, // 1h
  event_to_supervisor: 24 * 60 * 60 * 1000,
  sos: 48 * 60 * 60 * 1000, // 48h
  ack: 60 * 60 * 1000,
};

export const DEFAULT_PRIORITY_BY_TYPE: Record<MeshPacketType, MeshPacketPriority> = {
  gps_breadcrumb: 'high',
  file_request: 'high',
  file_chunk: 'normal',
  event_to_supervisor: 'high',
  sos: 'sos',
  ack: 'normal',
};

const PRIORITY_RANK: Record<MeshPacketPriority, number> = {
  sos: 4,
  high: 3,
  normal: 2,
  low: 1,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computa el ID content-addressed de un packet a partir de sus campos
 * inmutables. Mismo payload + fromUid + bornAtMs → mismo ID. Esto
 * permite dedup determinista sin coordinación.
 */
export function computePacketId(opts: {
  type: MeshPacketType;
  fromUid: string;
  bornAtMs: number;
  payload: unknown;
}): string {
  const canonical = JSON.stringify({
    type: opts.type,
    fromUid: opts.fromUid,
    bornAtMs: opts.bornAtMs,
    payload: opts.payload,
  });
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

/**
 * Wrapper conveniente para crear un packet con defaults.
 *
 * El caller debe firmar con su passkey privada (Sprint 26 wire); acá
 * dejamos un placeholder que se reemplaza en runtime real.
 */
export function buildPacket(opts: {
  type: MeshPacketType;
  fromUid: string;
  toUid: MeshDestination;
  payload: unknown;
  bornAtMs: number;
  signature?: string;
  signaturePublicKeyId?: string;
  ttl?: number;
  expiresAtMs?: number;
  priority?: MeshPacketPriority;
  projectId?: string;
}): MeshPacket {
  const ttl = opts.ttl ?? DEFAULT_TTL_BY_TYPE[opts.type];
  const expiresAtMs =
    opts.expiresAtMs ??
    opts.bornAtMs + DEFAULT_LIFETIME_MS_BY_TYPE[opts.type];
  const priority = opts.priority ?? DEFAULT_PRIORITY_BY_TYPE[opts.type];

  const id = computePacketId({
    type: opts.type,
    fromUid: opts.fromUid,
    bornAtMs: opts.bornAtMs,
    payload: opts.payload,
  });

  return {
    id,
    type: opts.type,
    fromUid: opts.fromUid,
    toUid: opts.toUid,
    ttl,
    hopCount: 0,
    bornAtMs: opts.bornAtMs,
    expiresAtMs,
    payload: opts.payload,
    signature: opts.signature ?? 'unsigned-dev',
    signaturePublicKeyId: opts.signaturePublicKeyId ?? 'unsigned-dev',
    relayedBy: [],
    projectId: opts.projectId,
    priority,
  };
}

/**
 * Verifica si un packet sigue vivo: TTL > 0 y no expirado.
 */
export function isPacketAlive(
  packet: MeshPacket,
  options: { now?: () => number } = {},
): boolean {
  const now = (options.now ?? Date.now)();
  return packet.ttl > 0 && now < packet.expiresAtMs;
}

/**
 * Decide si el receptor debe relayar este packet:
 *   - Está vivo (TTL > 0, no expirado)
 *   - El receptor NO está ya en relayedBy[] (loop avoidance)
 *   - El packet NO va específicamente a otro UID que ya recibió (los broadcast sí relayan)
 */
export function shouldRelay(
  packet: MeshPacket,
  receiverUid: string,
  options: { now?: () => number } = {},
): boolean {
  if (!isPacketAlive(packet, options)) return false;
  if (packet.relayedBy.includes(receiverUid)) return false;
  if (packet.fromUid === receiverUid) return false;
  if (packet.toUid === receiverUid && packet.type === 'ack') return false;
  return true;
}

/**
 * Aplica un hop al packet: decrementa TTL, incrementa hopCount, agrega
 * receiver a relayedBy. Retorna packet nuevo (immutable).
 */
export function applyHop(packet: MeshPacket, hopperUid: string): MeshPacket {
  return {
    ...packet,
    ttl: Math.max(0, packet.ttl - 1),
    hopCount: packet.hopCount + 1,
    relayedBy: [...packet.relayedBy, hopperUid],
  };
}

/**
 * Compara packets por priority (descendiente) y luego por bornAtMs
 * (ascendente, FIFO dentro de misma priority).
 *
 * SOS siempre primero. Dentro de SOS, el más antiguo primero (más
 * urgente entregar).
 */
export function comparePackets(a: MeshPacket, b: MeshPacket): number {
  const pa = PRIORITY_RANK[a.priority];
  const pb = PRIORITY_RANK[b.priority];
  if (pa !== pb) return pb - pa;
  return a.bornAtMs - b.bornAtMs;
}

/**
 * Verifica que dos packets son el mismo (por content-addressed ID).
 * Útil para dedup en queue.
 */
export function isSamePacket(a: MeshPacket, b: MeshPacket): boolean {
  return a.id === b.id;
}

/**
 * Verifica que un packet pertenece a un project específico. Workers
 * de project A descartan packets de project B aunque estén en
 * proximidad (ADR 0011 simétrico para mesh).
 */
export function packetBelongsToProject(
  packet: MeshPacket,
  expectedProjectId: string,
): boolean {
  // Project ID en payload (cuando el tipo lo incluye)
  if (typeof packet.payload === 'object' && packet.payload !== null) {
    const p = packet.payload as { projectId?: string };
    if (typeof p.projectId === 'string') {
      return p.projectId === expectedProjectId;
    }
  }
  // Project ID en packet metadata (fallback)
  if (typeof packet.projectId === 'string') {
    return packet.projectId === expectedProjectId;
  }
  // Sin projectId: ack global o tipo de sistema → permitir
  if (packet.type === 'ack') return true;
  return false;
}

/**
 * Type guards para narrow del payload. Cada consumer llama el guard
 * antes de leer el payload para evitar runtime errors.
 */
export const isGpsBreadcrumb = (
  p: MeshPacket,
): p is MeshPacket & { type: 'gps_breadcrumb'; payload: GpsBreadcrumbPayload } =>
  p.type === 'gps_breadcrumb';

export const isFileRequest = (
  p: MeshPacket,
): p is MeshPacket & { type: 'file_request'; payload: FileRequestPayload } =>
  p.type === 'file_request';

export const isFileChunk = (
  p: MeshPacket,
): p is MeshPacket & { type: 'file_chunk'; payload: FileChunkPayload } =>
  p.type === 'file_chunk';

export const isEventToSupervisor = (
  p: MeshPacket,
): p is MeshPacket & {
  type: 'event_to_supervisor';
  payload: EventToSupervisorPayload;
} => p.type === 'event_to_supervisor';

export const isSos = (
  p: MeshPacket,
): p is MeshPacket & { type: 'sos'; payload: SosPayload } => p.type === 'sos';

export const isAck = (
  p: MeshPacket,
): p is MeshPacket & { type: 'ack'; payload: AckPayload } => p.type === 'ack';
