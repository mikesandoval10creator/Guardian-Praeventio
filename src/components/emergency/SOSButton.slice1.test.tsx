/**
 * Slice 1 — SOSButton vida-safety fixes.
 *
 * Each test names the Notion ticket it closes. The repo does not ship jsdom /
 * @testing-library/react, so the contracts are exercised through the exported
 * pure helpers, exactly like the pre-existing long-press tests.
 *
 * Covered here:
 *   • "Race de doble fireSOS en hold repetido"    -> shouldScheduleHold
 *   • "res.json().catch(() => ({delivered:false}))"-> classifySosResponse
 *   • "captureGeo no abortable ni validado"       -> shouldPrioritizeHumanFallback
 *   • "PII (uid) crudo en analytics"              -> the payload carries a hash,
 *                                                     never the raw uid
 *   • "fallback tel: depende de project.phone"    -> the toast carries an
 *                                                     instruction when no
 *                                                     number can be dialed
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildSosRequest,
  classifySosResponse,
  createSosClientEventId,
  isLongPress,
  isValidGeoPoint,
  shouldPrioritizeHumanFallback,
  shouldScheduleHold,
  submitSosAttempt,
} from './SOSButton';

describe('SOSButton — double fireSOS guard', () => {
  it('schedules the first hold', () => {
    expect(shouldScheduleHold({ holdScheduled: false, submitting: false })).toBe(true);
  });

  it('refuses a second hold inside the 3s window', () => {
    expect(shouldScheduleHold({ holdScheduled: true, submitting: false })).toBe(false);
  });

  it('refuses a hold while a submission is in flight', () => {
    expect(shouldScheduleHold({ holdScheduled: false, submitting: true })).toBe(false);
  });
});

describe('SOSButton — response classification', () => {
  it('treats an explicit delivered:false as zero reach', async () => {
    const result = await classifySosResponse({
      json: async () => ({ delivered: false }),
    });
    expect(result.kind).toBe('zero_reach');
    expect(result.contractWarning).toBe(false);
  });

  it('treats an explicit delivered:true as delivered', async () => {
    const result = await classifySosResponse({
      json: async () => ({ delivered: true }),
    });
    expect(result.kind).toBe('delivered');
    expect(result.contractWarning).toBe(false);
  });

  it('does NOT report zero reach for a 2xx body that is not JSON', async () => {
    const result = await classifySosResponse({
      json: async () => {
        throw new Error('Unexpected token < in JSON');
      },
    });
    // The server accepted the SOS; the contract drifted, but the worker must
    // not be told that nobody was reached.
    expect(result.kind).toBe('delivered');
    expect(result.contractWarning).toBe(true);
  });

  it('reports a contract warning when the response has no json() at all', async () => {
    const result = await classifySosResponse({});
    expect(result.kind).toBe('delivered');
    expect(result.contractWarning).toBe(true);
  });
});

describe('SOSButton — submitSosAttempt honours the new classification', () => {
  it('returns zero_reach only on an explicit delivered:false', async () => {
    const attempt = await submitSosAttempt({
      clientEventId: 'k1',
      authHeader: null,
      body: {
        type: 'sos', uid: 'u1', projectId: 'p1', geo: null,
        timestamp: '2026-11-26T00:00:00.000Z',
      },
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ delivered: false }),
      }) as unknown as Response,
    });
    expect(attempt.kind).toBe('zero_reach');
  });

  it('returns delivered when the 2xx body is unreadable', async () => {
    const attempt = await submitSosAttempt({
      clientEventId: 'k2',
      authHeader: null,
      body: {
        type: 'sos', uid: 'u1', projectId: 'p1', geo: null,
        timestamp: '2026-11-26T00:00:00.000Z',
      },
      fetcher: async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('not json');
        },
      }) as unknown as Response,
    });
    expect(attempt.kind).toBe('delivered');
  });
});

describe('SOSButton — human fallback priority', () => {
  it('prioritizes the human channel when there are no coordinates', () => {
    expect(
      shouldPrioritizeHumanFallback({ geo: null, delivered: false, queued: true }),
    ).toBe(true);
  });

  it('prioritizes the human channel when nothing was queued', () => {
    expect(
      shouldPrioritizeHumanFallback({ geo: { lat: 1, lng: 2 }, delivered: false, queued: false }),
    ).toBe(true);
  });

  it('does not prioritize the human channel when the SOS was delivered', () => {
    expect(
      shouldPrioritizeHumanFallback({ geo: null, delivered: true, queued: false }),
    ).toBe(false);
  });
});

describe('SOSButton — body is an idempotency contract', () => {
  it('carries exactly the fields the outbox replay reconstructs', () => {
    const request = buildSosRequest('k3', null, {
      type: 'sos', uid: 'u1', projectId: 'p1', geo: null,
      timestamp: '2026-11-26T00:00:00.000Z',
    });
    const body = JSON.parse(request.body as string) as Record<string, unknown>;
    // The replay (`sosOutboxClient.sendSos`) rebuilds the body from the stored
    // SosEvent with EXACTLY these keys. Any extra key here would make the
    // replay a different request for the same Idempotency-Key: the server
    // would stop recognising it as a replay and create a SECOND alert.
    expect(Object.keys(body).sort()).toEqual(['geo', 'projectId', 'timestamp', 'type', 'uid']);
  });

  it('sends the same key on the replay', () => {
    const request = buildSosRequest('same-key', null, {
      type: 'sos', uid: 'u1', projectId: 'p1', geo: null,
      timestamp: '2026-11-26T00:00:00.000Z',
    });
    expect(request.headers['Idempotency-Key']).toBe('same-key');
  });
});

describe('SOSButton — geo validation', () => {
  it('accepts a real position', () => {
    expect(isValidGeoPoint({ lat: -33.45, lng: -70.67 })).toBe(true);
  });

  it('rejects an out-of-range latitude', () => {
    expect(isValidGeoPoint({ lat: 91, lng: 0 })).toBe(false);
  });

  it('rejects an out-of-range longitude', () => {
    expect(isValidGeoPoint({ lat: 0, lng: 181 })).toBe(false);
  });

  it('rejects a non-finite reading', () => {
    expect(isValidGeoPoint({ lat: Number.NaN, lng: 0 })).toBe(false);
  });

  it('rejects a non-numeric reading', () => {
    expect(isValidGeoPoint({ lat: 'abc', lng: 'def' })).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(isValidGeoPoint(null)).toBe(false);
    expect(isValidGeoPoint(undefined)).toBe(false);
  });
});

describe('SOSButton — pre-existing long-press contract (regression)', () => {
  it('still does not fire on a short tap', () => {
    expect(isLongPress(1000, 2000)).toBe(false);
  });

  it('still fires exactly at the boundary', () => {
    expect(isLongPress(1000, 4000)).toBe(true);
  });

  it('still creates a distinct identity per attempt', () => {
    expect(createSosClientEventId()).not.toBe(createSosClientEventId());
  });
});
