/**
 * Sprint 14 — SOSButton long-press timing tests.
 *
 * The repo intentionally does not ship `jsdom` / `happy-dom` /
 * `@testing-library/react` (see PredictedActivityModal.test.tsx for the
 * rationale). We exercise the production long-press contract via the
 * exported `isLongPress(downAt, upAt, holdMs)` helper, which is the same
 * predicate the component's `onPointerUp` handler calls to decide whether
 * the press should fire SOS or be cancelled.
 *
 * Coverage:
 *   • Short tap (<3s) → does NOT trigger.
 *   • Boundary (exactly 3s) → triggers (≥ holdMs).
 *   • Long press (>3s) → triggers.
 *   • Custom hold threshold → respects override.
 */

import { describe, expect, it, vi } from 'vitest';
import { InMemorySosStorage, SosOutbox } from '../../services/emergency/sosOutbox';
import {
  buildSosRequest,
  createSosClientEventId,
  isLongPress,
  submitSosAttempt,
} from './SOSButton';

describe('SOSButton — client event identity', () => {
  it('creates a non-empty idempotency identity for one SOS attempt', () => {
    expect(createSosClientEventId()).toBeTruthy();
  });

  it('builds the initial POST with the same idempotency identity used by retries', () => {
    const clientEventId = 'sos-attempt-42';
    const request = buildSosRequest(
      clientEventId,
      'Bearer test-token',
      {
        type: 'sos',
        uid: 'worker-1',
        projectId: 'project-1',
        geo: { lat: -33.4, lng: -70.6 },
        timestamp: '2026-09-04T17:00:00.000Z',
      },
    );

    expect(request.method).toBe('POST');
    expect(request.headers?.['Idempotency-Key']).toBe(clientEventId);
    expect(request.headers?.Authorization).toBe('Bearer test-token');
    expect(request.body).toContain('"projectId":"project-1"');
  });

  it('keeps the idempotency key while omitting auth when no token exists', () => {
    const request = buildSosRequest('sos-anonymous-7', null, {
      type: 'sos',
      uid: 'anonymous',
      projectId: 'project-1',
      geo: null,
      timestamp: '2026-09-04T17:00:00.000Z',
    });

    expect(request.headers['Idempotency-Key']).toBe('sos-anonymous-7');
    expect(request.headers.Authorization).toBeUndefined();
    expect(request.body).toContain('"geo":null');
  });

  it('queues and replays the same key when the initial POST committed but its response was lost', async () => {
    const serverRecords = new Map<
      string,
      { fingerprint: string; response: { alertId: string; delivered: true } }
    >();
    let alertWrites = 0;
    let fanOuts = 0;
    let dropInitialResponse = true;
    const requestKeys: string[] = [];
    const requestBodies: unknown[] = [];
    const replayBodies: unknown[] = [];

    const persistOnce = (key: string, body: unknown) => {
      const fingerprint = JSON.stringify(body);
      const existing = serverRecords.get(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new Error('422 idempotency fingerprint mismatch');
        }
        return existing.response;
      }
      const response = { alertId: `alert-${alertWrites + 1}`, delivered: true as const };
      serverRecords.set(key, { fingerprint, response });
      alertWrites += 1;
      fanOuts += 1;
      return response;
    };

    const initialPost = vi.fn(async (_url: string, init: RequestInit) => {
      const key = new Headers(init.headers).get('Idempotency-Key');
      if (!key) throw new Error('missing idempotency key');
      requestKeys.push(key);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      requestBodies.push(body);
      const record = persistOnce(key, body);
      if (dropInitialResponse) {
        dropInitialResponse = false;
        throw new Error('response lost after server commit');
      }
      return { ok: true, json: async () => record } as Response;
    });

    const storage = new InMemorySosStorage();
    const replayedKeys: string[] = [];
    const outbox = new SosOutbox({
      storage,
      send: async (event) => {
        replayedKeys.push(event.clientEventId);
        const body = {
          type: 'sos',
          uid: event.workerUid,
          projectId: event.projectId,
          geo: event.coords ? { lat: event.coords.lat, lng: event.coords.lng } : null,
          timestamp: event.occurredAt,
        };
        replayBodies.push(body);
        try {
          persistOnce(event.clientEventId, body);
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
    });

    const clientEventId = 'sos-lost-response-1';
    const result = await submitSosAttempt({
      clientEventId,
      authHeader: 'Bearer test-token',
      body: {
        type: 'sos',
        uid: 'worker-1',
        projectId: 'project-1',
        geo: null,
        timestamp: '2026-11-13T00:00:00.000Z',
      },
      fetcher: initialPost,
      enqueue: (event) => outbox.enqueue(event),
    });

    expect(result).toMatchObject({ kind: 'transport_failure', queued: true });
    expect(initialPost).toHaveBeenCalledTimes(1);
    expect(requestKeys).toEqual([clientEventId]);
    expect((await outbox.snapshot())[0]?.event.clientEventId).toBe(clientEventId);

    const replay = await outbox.flush();

    expect(replay).toMatchObject({ sent: 1, pending: 0 });
    expect(replayedKeys).toEqual([clientEventId]);
    expect(replayBodies).toEqual([requestBodies[0]]);
    expect(serverRecords.size).toBe(1);
    expect(alertWrites).toBe(1);
    expect(fanOuts).toBe(1);
    expect(await outbox.snapshot()).toHaveLength(0);
  });

  it('does not enqueue a server-recorded SOS when the response confirms zero reach', async () => {
    const enqueue = vi.fn(async () => {});
    const result = await submitSosAttempt({
      clientEventId: 'sos-zero-reach-1',
      authHeader: null,
      body: {
        type: 'sos',
        uid: 'worker-1',
        projectId: 'project-1',
        geo: null,
        timestamp: '2026-11-13T00:00:00.000Z',
      },
      fetcher: async () => ({
        ok: true,
        json: async () => ({ delivered: false }),
      }) as Response,
      enqueue,
    });

    expect(result).toEqual({ kind: 'zero_reach' });
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('SOSButton — long-press predicate', () => {
  it('short tap (1s) does NOT count as a long press', () => {
    const down = 1_000;
    const up = down + 1_000;
    expect(isLongPress(down, up)).toBe(false);
  });

  it('2.999s hold does NOT count as a long press (sub-3s)', () => {
    const down = 0;
    const up = 2_999;
    expect(isLongPress(down, up)).toBe(false);
  });

  it('exactly 3s hold triggers (>= holdMs boundary)', () => {
    const down = 0;
    const up = 3_000;
    expect(isLongPress(down, up)).toBe(true);
  });

  it('5s hold triggers', () => {
    const down = 10_000;
    const up = 15_000;
    expect(isLongPress(down, up)).toBe(true);
  });

  it('custom hold threshold is respected (e.g., 1.5s in tests)', () => {
    expect(isLongPress(0, 1_499, 1_500)).toBe(false);
    expect(isLongPress(0, 1_500, 1_500)).toBe(true);
  });
});
