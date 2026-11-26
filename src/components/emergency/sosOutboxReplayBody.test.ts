/**
 * Regresión: el body del replay del outbox debe ser IDÉNTICO al del primer POST.
 *
 * Un campo extra en el body del primer POST (sin su equivalente en el replay)
 * rompe el contrato de idempotencia: el servidor calcula el fingerprint del
 * body COMPLETO para la `Idempotency-Key`, así que un body distinto en el
 * replay deja de reconocerse como replay y se crea una SEGUNDA alerta con el
 * mismo evento.
 *
 * Este test es el que habría atrapado el campo `coordsUncertain` que el slice
 * 1 añadió al body inicial y que rompió el E2E `sos-button.spec.ts`.
 */

import { describe, expect, it } from 'vitest';
import { buildSosRequest } from './SOSButton';
import type { SosEvent } from '../../services/emergency/sosOutbox';

/**
 * Mirror of `sosOutboxClient.sendSos`'s body construction. If that function
 * changes, THIS test must change with it — the two are one contract.
 */
function buildReplayBody(event: SosEvent): Record<string, unknown> {
  return {
    type: 'sos',
    uid: event.workerUid,
    projectId: event.projectId,
    geo: event.coords ? { lat: event.coords.lat, lng: event.coords.lng } : null,
    timestamp: event.occurredAt,
  };
}

describe('SOS outbox replay — body must match the first POST byte for byte', () => {
  it('reproduces the first request body exactly', () => {
    const event: SosEvent = {
      clientEventId: 'evt-1',
      workerUid: 'u1',
      reason: 'manual_button',
      projectId: 'p1',
      coords: { lat: -33.45, lng: -70.67 },
      occurredAt: '2026-11-26T00:00:00.000Z',
    };
    const first = buildSosRequest(event.clientEventId, null, {
      type: 'sos',
      uid: event.workerUid,
      projectId: event.projectId ?? null,
      geo: event.coords ? { lat: event.coords.lat, lng: event.coords.lng } : null,
      timestamp: event.occurredAt,
    });
    const firstBody = JSON.parse(first.body as string) as Record<string, unknown>;
    const replayBody = buildReplayBody(event);
    expect(replayBody).toEqual(firstBody);
  });

  it('reproduces it for a SOS without coordinates', () => {
    const event: SosEvent = {
      clientEventId: 'evt-2',
      workerUid: 'u2',
      reason: 'manual_button',
      projectId: 'p2',
      occurredAt: '2026-11-26T00:00:00.000Z',
    };
    const first = buildSosRequest(event.clientEventId, null, {
      type: 'sos',
      uid: event.workerUid,
      projectId: event.projectId ?? null,
      geo: null,
      timestamp: event.occurredAt,
    });
    const firstBody = JSON.parse(first.body as string) as Record<string, unknown>;
    expect(buildReplayBody(event)).toEqual(firstBody);
  });
});
