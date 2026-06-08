// SPDX-License-Identifier: MIT
//
// Sprint 33 — Audit wire W10: emergency offline → mesh rebroadcast
// (ADR 0013, Mesh Information Relay).
//
// CONTEXTO
// ========
// Sprint 32 B3 cerró el wire EXITOSO de mesh→XP (`makeRelayXpHandler`):
// cuando un peer rebroadcastea un SOS ajeno, gana XP positivo. Esto
// completaba la fase 3 del Flow Infinito (Consolidación de
// Conocimiento) pero solo si el SOS llegaba al mesh en primer lugar.
//
// Hasta ahora, `triggerEmergency` solo intentaba el server fan-out
// (POST /api/emergency/notify-brigada). Si el device no tenía red
// mobile, el alerta moría en silencio — el HONEST_STATE de ADR 0013
// quedaba en 35% E2E (engine puro, sin consumer real en `src/`).
//
// CASO REAL (memoria del usuario): minero en túnel LATAM, sin señal
// celular, dispara fall_detected. El detector está vivo (Fase 1 del
// Flow Infinito), pero la red está caída. La respuesta adaptativa
// (Fase 2) DEBE rutear via mesh BLE/WiFi Direct hasta un peer que sí
// tenga red, y ese peer hará el server call por nosotros (transitivo).
//
// DISEÑO
// ======
// `enqueueOutbound(packet)` es el único entry point. Internamente:
//   - Si hay un `TransportFacade` registrado (runtime productivo),
//     delega a `facade.sendLocal(packet)` — eso encola en relay queue
//     + fan-out inmediato a peers conocidos.
//   - Si no hay facade (test, SSR, dev tab sin mesh activo), retorna
//     resultado neutro `{ enqueued: false, reason: 'no-transport' }`.
//
// La separación facade/wrapper existe a propósito: tests pueden
// `vi.mock('./meshFallback')` sin tocar la engine de mesh, y el caller
// (EmergencyContext) no tiene que conocer la existencia del facade.
//
// Patrón: NO importamos `TransportFacade` directamente en
// `EmergencyContext`. Solo este módulo lo conoce. El context cablea
// "envía SOS al mesh"; este módulo decide CÓMO.

import type { MeshPacket } from '../mesh/meshPacket';
import { buildSignedPacket } from '../mesh/meshPacket';
import { getMeshSigningKey } from '../mesh/meshKeyStore';
import type { TransportFacade } from '../mesh/transportFacade';

// Estado de módulo: el facade activo (si algún día el provider de
// runtime lo registra). En tests + dev sin mesh, queda null.
let activeFacade: TransportFacade | null = null;

/**
 * Registra el TransportFacade del runtime. Lo llama el provider de
 * mesh cuando arranca (Sprint 30+ wire de UI). Idempotente.
 */
export function registerMeshTransport(facade: TransportFacade | null): void {
  activeFacade = facade;
}

export interface SosFallbackPayload {
  projectId: string;
  emergencyType: string;
  uid: string;
  /** ms epoch — el bornAtMs del packet es independiente, esto es el
   *  trigger time clínico (cuándo se detectó la caída/incidente). */
  triggeredAtMs: number;
}

export interface EnqueueOutboundResult {
  enqueued: boolean;
  /** Razón cuando enqueued=false. Útil para logger + telemetría. */
  reason?: 'no-transport' | 'transport-error' | 'queue-rejected';
  packetId?: string;
}

/**
 * Enqueue un SOS packet al mesh para rebroadcast. El packet shape es
 * compatible con el XP wire de Sprint 32 B3 (`type: 'sos'` →
 * `makeRelayXpHandler` lo dispara cuando un peer relayer lo
 * rebroadcastea exitosamente).
 *
 * Llamado desde `EmergencyContext.triggerEmergency` cuando el server
 * fan-out falla por red caída. Fire-and-forget — nunca lanza al
 * caller; los errores se reportan via el resultado.
 */
export async function enqueueOutbound(
  payload: SosFallbackPayload,
): Promise<EnqueueOutboundResult> {
  if (!activeFacade) {
    return { enqueued: false, reason: 'no-transport' };
  }

  // SosPayload requiere location + capturedAtMs + triggerReason. En el
  // wire de emergency context no siempre tenemos GPS preciso (otro
  // motivo por el que estamos offline en túnel). Mandamos placeholders
  // honestos (lat/lng=0, accuracyM=-1) que peers downstream pueden
  // reconocer como "sin GPS" en lugar de creer que el worker está en
  // null-island. El triggerReason se mapea desde emergencyType.
  const sosPayload = {
    workerUid: payload.uid,
    location: { lat: 0, lng: 0, accuracyM: -1 },
    capturedAtMs: payload.triggeredAtMs,
    triggerReason: mapTriggerReason(payload.emergencyType),
    projectId: payload.projectId,
  };

  try {
    // Sign-on-build with the project mesh key so same-project peers can verify
    // this SOS is authentic (not a forged/spoofed broadcast). getMeshSigningKey
    // returns null when offline-without-key (first launch in a dead zone) →
    // buildSignedPacket degrades to an unkeyed packet, which peers still relay
    // as untrusted — we never block the life signal on a missing key.
    const signingKey = await getMeshSigningKey(payload.projectId);
    const packet: MeshPacket = await buildSignedPacket(
      {
        type: 'sos',
        fromUid: payload.uid,
        toUid: 'broadcast',
        payload: sosPayload,
        bornAtMs: Date.now(),
        projectId: payload.projectId,
      },
      signingKey,
    );
    const res = await activeFacade.sendLocal(packet);
    if (!res.enqueued) {
      return { enqueued: false, reason: 'queue-rejected', packetId: packet.id };
    }
    return { enqueued: true, packetId: packet.id };
  } catch {
    return { enqueued: false, reason: 'transport-error' };
  }
}

function mapTriggerReason(
  emergencyType: string,
): 'fall_detected' | 'manual' | 'man_down_timeout' | 'no_response' {
  const t = emergencyType.toLowerCase();
  if (t === 'fall' || t === 'fall_detected') return 'fall_detected';
  if (t === 'man_down' || t === 'man_down_timeout') return 'man_down_timeout';
  if (t === 'no_response') return 'no_response';
  return 'manual';
}

/** Test-only: limpia el facade registrado entre tests. */
export function __resetForTests(): void {
  activeFacade = null;
}
