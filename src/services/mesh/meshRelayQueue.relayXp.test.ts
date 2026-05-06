// SPDX-License-Identifier: MIT
//
// Sprint 32 — verifica que el wire SOS-rebroadcast → awardXp dispara
// solo para packets SOS, propaga metadata correcta y NO rompe el path
// de relay si el listener tira.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeshRelayQueue, type MeshRelaySuccessEvent } from './meshRelayQueue';
import { buildPacket } from './meshPacket';
import { makeRelayXpHandler } from './meshRelayXpWire';
import * as positiveXp from '../gamification/positiveXp';

const NOW = 1_000_000_000;
const PROJECT = 'p1';

function makeSos(fromUid: string) {
  return buildPacket({
    type: 'sos',
    fromUid,
    toUid: 'broadcast',
    bornAtMs: NOW,
    projectId: PROJECT,
    payload: {
      workerUid: fromUid,
      location: { lat: -33.45, lng: -70.66, accuracyM: 10 },
      capturedAtMs: NOW,
      triggerReason: 'manual' as const,
      projectId: PROJECT,
    },
  });
}

function makeBreadcrumb(fromUid: string) {
  return buildPacket({
    type: 'gps_breadcrumb',
    fromUid,
    toUid: 'broadcast',
    bornAtMs: NOW,
    projectId: PROJECT,
    payload: {
      workerUid: fromUid,
      lat: -33.45, lng: -70.66, accuracyM: 10,
      capturedAtMs: NOW,
      projectId: PROJECT,
    },
  });
}

describe('MeshRelayQueue — relay → XP wire (Sprint 32)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('packet SOS rebroadcasteado → onRelaySuccess llamado con metadata', () => {
    const events: MeshRelaySuccessEvent[] = [];
    const queue = new MeshRelayQueue({
      selfUid: 'self',
      projectId: PROJECT,
      now: () => NOW,
      onRelaySuccess: (e) => events.push(e),
    });

    const sos = makeSos('victim-uid');
    queue.receive([sos]);
    const result = queue.drainForPeer('peer-uid');

    expect(result.toSend).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      packetType: 'sos',
      packetId: sos.id,
      originalSenderId: 'victim-uid',
      relayedBy: 'self',
      toPeerUid: 'peer-uid',
    });
  });

  it('packet no-SOS rebroadcasteado → onRelaySuccess NO llamado', () => {
    const onRelaySuccess = vi.fn();
    const queue = new MeshRelayQueue({
      selfUid: 'self',
      projectId: PROJECT,
      now: () => NOW,
      onRelaySuccess,
    });

    queue.receive([makeBreadcrumb('worker-a')]);
    queue.drainForPeer('peer-uid');

    expect(onRelaySuccess).not.toHaveBeenCalled();
  });

  it('listener lanzando excepción NO rompe el path de relay', () => {
    const queue = new MeshRelayQueue({
      selfUid: 'self',
      projectId: PROJECT,
      now: () => NOW,
      onRelaySuccess: () => {
        throw new Error('boom');
      },
    });

    const sos = makeSos('victim-uid');
    queue.receive([sos]);

    // El drain NO debe lanzar; el packet sí debe entregarse.
    const result = queue.drainForPeer('peer-uid');
    expect(result.toSend).toHaveLength(1);
    expect(result.toSend[0].id).toBe(sos.id);
  });

  it('makeRelayXpHandler invoca awardXp con razón mesh_relay_sos +50', () => {
    const spy = vi.spyOn(positiveXp, 'awardXp');
    const handler = makeRelayXpHandler();

    handler({
      packetType: 'sos',
      packetId: 'pkt-1',
      originalSenderId: 'victim',
      relayedBy: 'self',
      toPeerUid: 'peer',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      'mesh_relay_sos',
      undefined,
      expect.objectContaining({
        packetId: 'pkt-1',
        originalSenderId: 'victim',
        relayedBy: 'self',
        toPeerUid: 'peer',
      }),
    );
    // Verifica que el monto canónico es 50 (no se rompió XP_AMOUNTS).
    const result = spy.mock.results[0].value as { amount: number; skipped: boolean };
    expect(result.skipped).toBe(false);
    expect(result.amount).toBe(50);
  });

  it('integración: queue + wire → awardXp se llama 1 vez por SOS único', () => {
    const spy = vi.spyOn(positiveXp, 'awardXp');
    const queue = new MeshRelayQueue({
      selfUid: 'self',
      projectId: PROJECT,
      now: () => NOW,
      onRelaySuccess: makeRelayXpHandler(),
    });

    const sos = makeSos('victim-uid');
    queue.receive([sos]);
    queue.drainForPeer('peer-1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      'mesh_relay_sos',
      undefined,
      expect.objectContaining({ packetId: sos.id }),
    );
  });
});
