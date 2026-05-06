// SPDX-License-Identifier: MIT
//
// Sprint 32 — Mesh relay → Positive XP wire.
//
// WHY este archivo existe:
//   El motor `MeshRelayQueue` es puro y NO conoce gamificación. Pero
//   cuando un worker rebroadcastea un SOS, eso es exactamente el cierre
//   de la fase 3 del Flow Infinito (Consolidación de Conocimiento): la
//   acción individual se registra en la historia colectiva como medalla.
//
//   La narrativa de marca de Praeventio es fuerte: "salvaste una vida".
//   Este wire es el cable mínimo para que esa promesa se materialice
//   sin contaminar la engine de mesh con dependencias de gamificación.
//
// Patrón:
//   - El caller que instancia `MeshRelayQueue` pasa
//     `onRelaySuccess: makeRelayXpHandler()` como opción.
//   - Ese handler llama awardXp('mesh_relay_sos', 50, ctx) en
//     fire-and-forget. Si awardXp tira, la queue lo captura — el relay
//     físico nunca se rompe por gamificación.
//
// TODO(toast): cuando exista hook `useToast` en runtime productivo,
//   inyectar acá un onSuccess opcional para mostrar al worker
//   "Salvaste una vida — +50 XP" inmediato (lo correcto es un
//   callback opt-in, no un import directo de UI desde un service).

import { awardXp } from '../gamification/positiveXp';
import type { MeshRelaySuccessEvent } from './meshRelayQueue';

export interface RelayXpHandlerOptions {
  /**
   * Callback opcional para que el caller observe cada award (testing,
   * telemetría, toast UI). NO debe lanzar; si lanza, se ignora.
   */
  onAward?: (event: MeshRelaySuccessEvent, xpAmount: number) => void;
}

/**
 * Construye el listener para `MeshRelayQueueOptions.onRelaySuccess`.
 * Mapea cada rebroadcast exitoso de SOS a un `awardXp` con razón
 * `'mesh_relay_sos'` (+50 XP por defecto). Idempotente desde el punto
 * de vista de la queue — cada packet único produce 1 award por nodo
 * relayer porque la queue dedupa packets por ID antes de drainForPeer.
 */
export function makeRelayXpHandler(
  options: RelayXpHandlerOptions = {},
): (event: MeshRelaySuccessEvent) => void {
  return (event) => {
    if (event.packetType !== 'sos') return;

    const result = awardXp('mesh_relay_sos', undefined, {
      packetId: event.packetId,
      originalSenderId: event.originalSenderId,
      relayedBy: event.relayedBy,
      toPeerUid: event.toPeerUid,
    });

    if (options.onAward) {
      try {
        options.onAward(event, result.amount);
      } catch (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[meshRelayXpWire] onAward callback threw — ignored', err);
        }
      }
    }
  };
}
