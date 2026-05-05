// SPDX-License-Identifier: MIT
//
// Sprint 26 — Mesh Request Router (ADR 0013)
//
// File request lifecycle service. Construye encima de:
//   - meshPacket.ts: types FileRequestPayload + FileChunkPayload
//   - meshRelayQueue.ts: enqueueLocal / receive / drainForPeer
//
// Función pura — no toca BT físico. Eso lo hace el plugin Capacitor
// (Sprint 26+ Kotlin/Swift). Acá solo lifecycle + chunking + cache.
//
// Casos de uso:
//   1. Worker pide un archivo que no tiene cached →
//      requestFile() crea file_request + lo enqueueLocal.
//   2. Llega file_request de otro peer y tenemos el archivo →
//      chunkear + emitir N file_chunk packets de respuesta.
//   3. Llegan file_chunks con requestId conocido → acumular →
//      cuando totalChunks recibidos → reconstruir Blob → callback.
//   4. TTL de request expira → state='expired'.

import {
  buildPacket,
  isFileChunk,
  isFileRequest,
  type FileChunkPayload,
  type FileRequestPayload,
  type MeshPacket,
} from './meshPacket';
import { MeshRelayQueue } from './meshRelayQueue';
import { chunkBlob, reconstructBlob } from './fileChunker';

export type FileRequestState =
  | 'pending'
  | 'in_transit'
  | 'complete'
  | 'expired'
  | 'cancelled';

export interface FileRequestRecord {
  requestId: string;
  requesterUid: string;
  nodeId: string;
  contentHash: string | null;
  title: string;
  state: FileRequestState;
  createdAt: number;
  expiresAt: number;
  receivedChunks: Map<number, Uint8Array>;
  totalChunks: number | null;
  reconstructedFile: Blob | null;
}

export interface MeshRequestRouterOptions {
  selfUid: string;
  projectId: string;
  queue: MeshRelayQueue;
  /** Lookup local del archivo por nodeId — retorna Blob si está cached. */
  localFileLookup: (
    nodeId: string,
  ) => Promise<{ blob: Blob; contentHash: string } | null>;
  /** Llamado cuando un archivo se reconstruye exitosamente. */
  onFileComplete: (record: FileRequestRecord) => void;
  /** Tamaño de chunk por default (BLE-safe). */
  chunkSize?: number;
  /** Lifetime de un request del lado del requester. */
  requestLifetimeMs?: number;
  /** Override de "ahora" para tests. */
  now?: () => number;
  /** Override de IDs (tests deterministas). Recibe el packet de origen. */
  generateRequestId?: () => string;
}

const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1000;

export class MeshRequestRouter {
  private readonly selfUid: string;
  private readonly projectId: string;
  private readonly queue: MeshRelayQueue;
  private readonly localFileLookup: (
    nodeId: string,
  ) => Promise<{ blob: Blob; contentHash: string } | null>;
  private readonly onFileComplete: (record: FileRequestRecord) => void;
  private readonly chunkSize: number;
  private readonly requestLifetimeMs: number;
  private readonly nowFn: () => number;
  private readonly idGen?: () => string;

  /** requestId → record (lado requester). */
  private readonly active: Map<string, FileRequestRecord> = new Map();

  constructor(opts: MeshRequestRouterOptions) {
    this.selfUid = opts.selfUid;
    this.projectId = opts.projectId;
    this.queue = opts.queue;
    this.localFileLookup = opts.localFileLookup;
    this.onFileComplete = opts.onFileComplete;
    this.chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE;
    this.requestLifetimeMs =
      opts.requestLifetimeMs ?? DEFAULT_REQUEST_LIFETIME_MS;
    this.nowFn = opts.now ?? Date.now;
    this.idGen = opts.generateRequestId;
  }

  /**
   * Worker pide un archivo del Zettelkasten que no tiene cached.
   * Crea un packet `file_request`, lo enqueueLocal en la queue mesh,
   * y registra el FileRequestRecord local para tracking.
   */
  async requestFile(opts: {
    nodeId: string;
    contentHash: string | null;
    title: string;
  }): Promise<{ requestId: string }> {
    const now = this.nowFn();
    const payload: FileRequestPayload = {
      requesterUid: this.selfUid,
      nodeId: opts.nodeId,
      contentHash: opts.contentHash,
      title: opts.title,
      projectId: this.projectId,
    };

    const packet = buildPacket({
      type: 'file_request',
      fromUid: this.selfUid,
      toUid: 'broadcast',
      payload,
      bornAtMs: now,
      projectId: this.projectId,
      expiresAtMs: now + this.requestLifetimeMs,
    });

    // Inyectar requestId determinista solo si el caller lo pidió (tests).
    const requestId = this.idGen ? this.idGen() : packet.id;
    if (this.idGen) {
      // Sustituimos el id del packet con el id determinista para que
      // matchee el record en la deserialización.
      (packet as { id: string }).id = requestId;
    }

    const record: FileRequestRecord = {
      requestId,
      requesterUid: this.selfUid,
      nodeId: opts.nodeId,
      contentHash: opts.contentHash,
      title: opts.title,
      state: 'pending',
      createdAt: now,
      expiresAt: now + this.requestLifetimeMs,
      receivedChunks: new Map(),
      totalChunks: null,
      reconstructedFile: null,
    };
    this.active.set(requestId, record);

    this.queue.enqueueLocal(packet);
    return { requestId };
  }

  /** Cancela un request pendiente. No-op si no existe o ya completó. */
  cancelRequest(requestId: string): void {
    const record = this.active.get(requestId);
    if (!record) return;
    if (record.state === 'complete') return;
    record.state = 'cancelled';
  }

  /**
   * Procesa packets recibidos del peer (post-receive de la queue).
   * Despacha por tipo:
   *   - file_request: si tenemos el archivo → emitimos chunks de respuesta.
   *   - file_chunk:   acumulamos en el record matchando por requestId.
   * Otros tipos se ignoran silenciosamente (los maneja otro consumer).
   */
  async processIncomingPackets(packets: MeshPacket[]): Promise<void> {
    for (const packet of packets) {
      if (isFileRequest(packet)) {
        await this.handleIncomingFileRequest(packet);
        continue;
      }
      if (isFileChunk(packet)) {
        this.handleIncomingFileChunk(packet);
        continue;
      }
    }
  }

  /** Snapshot de requests activos (UI). */
  getActiveRequests(): FileRequestRecord[] {
    return Array.from(this.active.values()).map((r) => ({
      ...r,
      receivedChunks: new Map(r.receivedChunks),
    }));
  }

  /** Cleanup de expirados. Marca state='expired' si TTL agotado y no completo. */
  cleanup(): void {
    const now = this.nowFn();
    for (const record of this.active.values()) {
      if (record.state === 'complete' || record.state === 'cancelled') continue;
      if (record.state === 'expired') continue;
      if (now > record.expiresAt) {
        record.state = 'expired';
      }
    }
  }

  // ---------------------------------------------------------------------------

  private async handleIncomingFileRequest(
    packet: MeshPacket & {
      type: 'file_request';
      payload: FileRequestPayload;
    },
  ): Promise<void> {
    // No respondemos a nuestros propios requests.
    if (packet.fromUid === this.selfUid) return;
    if (packet.payload.projectId !== this.projectId) return;

    const local = await this.localFileLookup(packet.payload.nodeId);
    if (!local) {
      // No tenemos el archivo. La queue ya se encarga del relay.
      return;
    }

    // Si el caller pidió un contentHash específico y no matchea, no
    // emitimos. Otra réplica con el hash correcto puede contestar.
    if (
      packet.payload.contentHash !== null &&
      packet.payload.contentHash !== local.contentHash
    ) {
      return;
    }

    const chunks = await chunkBlob(local.blob, this.chunkSize);
    const totalChunks = chunks.length;
    const now = this.nowFn();

    for (let idx = 0; idx < chunks.length; idx++) {
      const chunkPayload: FileChunkPayload = {
        requestId: packet.id,
        contentHash: local.contentHash,
        chunkIndex: idx,
        totalChunks,
        dataBase64: uint8ToBase64(chunks[idx]),
        projectId: this.projectId,
      };

      const chunkPacket = buildPacket({
        type: 'file_chunk',
        fromUid: this.selfUid,
        toUid: packet.payload.requesterUid,
        payload: chunkPayload,
        bornAtMs: now + idx, // ids únicos por chunk
        projectId: this.projectId,
      });

      this.queue.enqueueLocal(chunkPacket);
    }
  }

  private handleIncomingFileChunk(
    packet: MeshPacket & { type: 'file_chunk'; payload: FileChunkPayload },
  ): void {
    const { requestId, chunkIndex, totalChunks, dataBase64 } = packet.payload;
    const record = this.active.get(requestId);
    if (!record) {
      // No es un chunk para nosotros (o ya hicimos cleanup).
      return;
    }
    if (record.state === 'complete' || record.state === 'cancelled') {
      return;
    }
    if (record.state === 'expired') {
      return;
    }

    // Set totalChunks la primera vez.
    if (record.totalChunks === null) {
      record.totalChunks = totalChunks;
    } else if (record.totalChunks !== totalChunks) {
      // Inconsistencia entre peers — ignorar este chunk para no romper.
      return;
    }

    // Dedup: si ya tenemos este index, skip silencioso (idempotente).
    if (record.receivedChunks.has(chunkIndex)) {
      return;
    }

    record.receivedChunks.set(chunkIndex, base64ToUint8(dataBase64));
    if (record.state === 'pending') {
      record.state = 'in_transit';
    }

    if (
      record.totalChunks !== null &&
      record.receivedChunks.size === record.totalChunks
    ) {
      const ordered: Uint8Array[] = [];
      for (let i = 0; i < record.totalChunks; i++) {
        const piece = record.receivedChunks.get(i);
        if (!piece) {
          // Edge: contamos N piezas pero falta un index — imposible si
          // dedup funcionó. Bail-out defensivo.
          return;
        }
        ordered.push(piece);
      }
      record.reconstructedFile = reconstructBlob(
        ordered,
        'application/octet-stream',
      );
      record.state = 'complete';
      this.onFileComplete(record);
    }
  }
}

// ---------------------------------------------------------------------------
// Base64 helpers — agnósticos de Node/browser.
// ---------------------------------------------------------------------------

function uint8ToBase64(buf: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buf).toString('base64');
  }
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

function base64ToUint8(b64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
