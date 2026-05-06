// SPDX-License-Identifier: MIT
//
// Sprint 25 — Mesh Relay Queue (ADR 0013)
//
// Store-carry-forward queue para Bluetooth/Wi-Fi Direct mesh.
// Función pura — NO toca transport físico ni IndexedDB directamente.
// Eso lo hace el caller (Sprint 26 wire) usando esta engine como brain.
//
// La queue:
//   - Mantiene packets que aún no se entregaron a sus destinos
//   - Drena en orden de priority cuando llega un peer
//   - Cleanup automático de packets expirados
//   - Dedup con Bloom-filter-like Set
//   - Loop avoidance via relayedBy[]

import {
  MeshPacket,
  applyHop,
  comparePackets,
  isPacketAlive,
  packetBelongsToProject,
  shouldRelay,
} from './meshPacket';

/**
 * Sprint 32 — hook que se dispara cuando un packet SOS se rebroadcastea
 * exitosamente desde este nodo a un peer (drainForPeer). El caller usa
 * esto para premiar XP al worker (Flow Infinito fase 3: el rebroadcaster
 * podría haber salvado una vida). Fire-and-forget: la queue NO espera
 * resultado y NO falla si el listener tira excepción.
 */
export interface MeshRelaySuccessEvent {
  /** Tipo del packet que se relayó (siempre 'sos' por ahora; se podría extender). */
  packetType: 'sos';
  /** ID content-addressed del packet rebroadcasteado. */
  packetId: string;
  /** UID del worker que originó el SOS (la potencial víctima). */
  originalSenderId: string;
  /** UID del worker que rebroadcasteó (este nodo). */
  relayedBy: string;
  /** UID del peer al que se entregó. */
  toPeerUid: string;
}

export interface MeshRelayQueueOptions {
  /** UID del worker dueño de este nodo. */
  selfUid: string;
  /** Project del worker — packets de otro project se descartan al recibir. */
  projectId: string;
  /** Cuántos packets max almacenar en queue. Default 500. */
  maxQueueSize?: number;
  /** Cuánto tiempo retener IDs de packets ya vistos para dedup. Default 6h. */
  dedupTtlMs?: number;
  /** Override de "ahora" para tests. */
  now?: () => number;
  /**
   * Sprint 32 — listener para 'rebroadcast_success' de SOS. Si está
   * presente, se invoca por cada SOS que sale en drainForPeer. Wire
   * principal: gamification awardXp('mesh_relay_sos', 50, ctx).
   * Excepciones del listener se capturan — NO rompen el path de relay.
   */
  onRelaySuccess?: (event: MeshRelaySuccessEvent) => void;
}

export interface RelayResult {
  /** Packets a enviar al peer en este encuentro, ya con hop aplicado. */
  toSend: MeshPacket[];
  /** Packets que se removieron de queue (expirados o entregados). */
  evicted: MeshPacket[];
}

export interface ReceiveResult {
  /** Packets que el receptor procesará localmente (van dirigidos a él). */
  forLocal: MeshPacket[];
  /** Packets agregados al store-carry para relay futuro. */
  enqueued: MeshPacket[];
  /** Packets descartados (loop, expirado, project mismatch, dup). */
  dropped: MeshPacket[];
}

const DEFAULT_MAX_QUEUE_SIZE = 500;
const DEFAULT_DEDUP_TTL_MS = 6 * 60 * 60 * 1000;

export class MeshRelayQueue {
  private readonly selfUid: string;
  private readonly projectId: string;
  private readonly maxQueueSize: number;
  private readonly dedupTtlMs: number;
  private readonly nowFn: () => number;
  private readonly onRelaySuccess?: (event: MeshRelaySuccessEvent) => void;

  private queue: MeshPacket[] = [];
  /** Set de packet IDs vistos recientemente. Cleanup por TTL. */
  private seenIds: Map<string, number> = new Map();

  constructor(options: MeshRelayQueueOptions) {
    this.selfUid = options.selfUid;
    this.projectId = options.projectId;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    this.dedupTtlMs = options.dedupTtlMs ?? DEFAULT_DEDUP_TTL_MS;
    this.nowFn = options.now ?? Date.now;
    this.onRelaySuccess = options.onRelaySuccess;
  }

  /** Estado actual (lectura). Útil para UI badge "N pendientes". */
  size(): number {
    return this.queue.length;
  }

  /** Snapshot inmutable de la queue (para debugging / UI). */
  snapshot(): MeshPacket[] {
    return [...this.queue];
  }

  /**
   * Inyecta un packet generado localmente (worker quiere enviar algo
   * propio: SOS, evento, request de archivo, breadcrumb GPS).
   * Se persiste en queue para relay cuando llegue peer.
   */
  enqueueLocal(packet: MeshPacket): { added: boolean; reason?: string } {
    if (!isPacketAlive(packet, { now: this.nowFn })) {
      return { added: false, reason: 'expired_at_birth' };
    }
    if (this.seenIds.has(packet.id)) {
      return { added: false, reason: 'duplicate_id' };
    }
    if (!packetBelongsToProject(packet, this.projectId)) {
      return { added: false, reason: 'wrong_project' };
    }
    this.append(packet);
    return { added: true };
  }

  /**
   * Procesa packets recibidos desde un peer (Bluetooth/Wi-Fi Direct
   * intercambio acaba de ocurrir). Decide qué se procesa local, qué
   * se almacena para relay futuro, qué se descarta.
   */
  receive(packets: MeshPacket[]): ReceiveResult {
    const forLocal: MeshPacket[] = [];
    const enqueued: MeshPacket[] = [];
    const dropped: MeshPacket[] = [];

    for (const packet of packets) {
      // Dedup: ya lo vimos
      if (this.seenIds.has(packet.id)) {
        dropped.push(packet);
        continue;
      }
      // Project mismatch: descartar (privacy ADR 0011 simétrico)
      if (!packetBelongsToProject(packet, this.projectId)) {
        this.seenIds.set(packet.id, this.nowFn()); // marcar visto para no reprocesar
        dropped.push(packet);
        continue;
      }
      // Vivo?
      if (!isPacketAlive(packet, { now: this.nowFn })) {
        this.seenIds.set(packet.id, this.nowFn());
        dropped.push(packet);
        continue;
      }

      // Marcar visto
      this.seenIds.set(packet.id, this.nowFn());

      // ¿Va dirigido a mí explícitamente?
      const isForMe =
        packet.toUid === this.selfUid ||
        packet.toUid === 'broadcast' ||
        (packet.toUid === 'supervisors' && this.isSupervisor());
      if (isForMe) {
        forLocal.push(packet);
      }

      // ¿Debo relayarlo a otros? (broadcast siempre se relaya hasta TTL=0)
      if (shouldRelay(packet, this.selfUid, { now: this.nowFn })) {
        this.append(packet);
        enqueued.push(packet);
      }
    }

    this.cleanup();
    return { forLocal, enqueued, dropped };
  }

  /**
   * Drain — obtiene los packets a enviar al peer recién encontrado.
   * Aplica hop a cada uno (decrementa TTL, agrega self a relayedBy).
   * Limita a `maxPackets` por encuentro (bandwidth).
   *
   * Después del send, el caller debe llamar `markDelivered(packet.id)`
   * por cada ack que reciba del peer, o `requeue(packet.id)` si la
   * conexión se cae mid-transfer.
   */
  drainForPeer(peerUid: string, maxPackets: number = 50): RelayResult {
    const toSend: MeshPacket[] = [];
    const evicted: MeshPacket[] = [];
    const remaining: MeshPacket[] = [];

    for (const packet of this.queue) {
      if (toSend.length >= maxPackets) {
        remaining.push(packet);
        continue;
      }
      if (!isPacketAlive(packet, { now: this.nowFn })) {
        evicted.push(packet);
        continue;
      }
      if (packet.relayedBy.includes(peerUid)) {
        // El peer ya vio este packet; no se lo enviamos otra vez
        remaining.push(packet);
        continue;
      }
      if (packet.fromUid === peerUid) {
        // El peer es el origen — no tiene sentido enviarle su propio packet
        remaining.push(packet);
        continue;
      }

      const hopped = applyHop(packet, this.selfUid);
      toSend.push(hopped);

      // Sprint 32 — Flow Infinito fase 3: si rebroadcasteamos un SOS,
      // el worker dueño de este nodo podría haber salvado una vida.
      // Notificamos al listener (gamification wire awardXp 'mesh_relay_sos').
      // Fire-and-forget: una excepción acá NO debe romper la entrega del
      // packet (la lógica core de mesh es vital — XP es secundario).
      if (packet.type === 'sos' && this.onRelaySuccess) {
        try {
          this.onRelaySuccess({
            packetType: 'sos',
            packetId: packet.id,
            originalSenderId: packet.fromUid,
            relayedBy: this.selfUid,
            toPeerUid: peerUid,
          });
        } catch (err) {
          if (typeof console !== 'undefined' && console.warn) {
            console.warn('[MeshRelayQueue] onRelaySuccess listener threw — ignored', err);
          }
        }
      }
    }

    // Sort por priority + age
    toSend.sort(comparePackets);

    this.queue = remaining;
    return { toSend, evicted };
  }

  /**
   * Marca un packet como entregado (ack recibido) y lo remueve de la
   * queue para no reenviar.
   */
  markDelivered(packetId: string): boolean {
    const initialLen = this.queue.length;
    this.queue = this.queue.filter((p) => p.id !== packetId);
    return this.queue.length < initialLen;
  }

  /**
   * Re-encola un packet que se intentó enviar pero la conexión falló
   * mid-transfer. La próxima ventana de oportunidad lo intenta de nuevo.
   */
  requeue(packet: MeshPacket): void {
    if (!this.seenIds.has(packet.id)) {
      this.seenIds.set(packet.id, this.nowFn());
    }
    this.append(packet);
  }

  /** Cleanup interno: remueve expirados + IDs vistos > dedupTtl. */
  cleanup(): { evictedQueue: number; evictedSeen: number } {
    const now = this.nowFn();
    const initialQueueLen = this.queue.length;
    this.queue = this.queue.filter((p) => isPacketAlive(p, { now: () => now }));
    const evictedQueue = initialQueueLen - this.queue.length;

    let evictedSeen = 0;
    const dedupCutoff = now - this.dedupTtlMs;
    for (const [id, ts] of this.seenIds.entries()) {
      if (ts < dedupCutoff) {
        this.seenIds.delete(id);
        evictedSeen++;
      }
    }
    return { evictedQueue, evictedSeen };
  }

  /** Reset total — solo para tests. */
  __reset(): void {
    this.queue = [];
    this.seenIds.clear();
  }

  // ---------------------------------------------------------------------------

  private append(packet: MeshPacket): void {
    this.queue.push(packet);
    this.seenIds.set(packet.id, this.nowFn());

    // Si nos pasamos del max, dropea el más antiguo de menor priority
    if (this.queue.length > this.maxQueueSize) {
      this.queue.sort(comparePackets);
      // El último después del sort por priority + bornAtMs (mayor first)
      this.queue.pop();
    }
  }

  private isSupervisor(): boolean {
    // Sprint 26 wire: leerá de FirebaseContext role. Por ahora no
    // sabemos — los supervisors se identifican por audience explícita.
    return false;
  }
}
