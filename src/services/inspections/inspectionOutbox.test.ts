// Praeventio Guard — Fase F.6 P1 #3 fix tests (PR #322 Codex review).
//
// The outbox runs in two modes:
//   (1) IndexedDB-backed (browser, Capacitor WebView).
//   (2) In-memory fallback (SSR, very old jsdom).
//
// These tests exercise the in-memory fallback path. By default vitest's
// jsdom environment exposes `indexedDB`, but we bias toward the simpler
// in-memory path here because:
//   - The fallback is the security-critical degraded mode (zero
//     persistence) and bugs there mean silent data loss on platforms
//     that lack IDB.
//   - Functional contract is identical between modes, so a passing
//     in-memory suite proves enqueueing/listing/marking semantics; the
//     IDB path adds storage but not different logic.
//
// We disable the global `indexedDB` for these tests via `vi.stubGlobal`
// so the module's `hasIndexedDB()` returns false and falls through to
// the Map-backed branch.

import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';

vi.stubGlobal('indexedDB', undefined);

import {
  acquireFlushLock,
  clearOutboxForOtherUsers,
  enqueueInspectionStart,
  listPendingInspections,
  markInspectionSynced,
  markInspectionFailed,
  dropSyncedInspections,
  enqueueObservation,
  listPendingObservations,
  countPendingObservations,
  markObservationSynced,
  markObservationFailed,
  rekeyObservation,
  releaseFlushLock,
  dropSyncedObservations,
  __resetInspectionOutboxForTests,
} from './inspectionOutbox';

beforeEach(() => {
  __resetInspectionOutboxForTests();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('inspectionOutbox — inspection-level queue', () => {
  it('enqueues a new pending inspection and lists it', async () => {
    const rec = await enqueueInspectionStart({
      id: 'insp_1',
      projectId: 'p1',
      templateId: 'tpl_altura_v1',
      responsibleUid: 'u1',
      startedAt: '2026-05-17T10:00:00.000Z',
    });
    expect(rec.status).toBe('pending');
    expect(rec.attempts).toBe(0);
    const pending = await listPendingInspections();
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('insp_1');
  });

  it('marks an inspection as synced and removes it from the pending list', async () => {
    await enqueueInspectionStart({
      id: 'insp_2',
      projectId: 'p1',
      templateId: 'tpl_loto_v1',
      responsibleUid: 'u1',
      startedAt: '2026-05-17T11:00:00.000Z',
    });
    await markInspectionSynced('insp_2');
    const pending = await listPendingInspections();
    expect(pending).toHaveLength(0);
  });

  it('marks an inspection as failed with error + bumps attempts', async () => {
    await enqueueInspectionStart({
      id: 'insp_3',
      projectId: 'p1',
      templateId: 'tpl_caliente_v1',
      responsibleUid: 'u1',
      startedAt: '2026-05-17T12:00:00.000Z',
    });
    await markInspectionFailed('insp_3', 'http_500');
    const pending = await listPendingInspections();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe('failed');
    expect(pending[0].lastError).toBe('http_500');
    expect(pending[0].attempts).toBe(1);
  });

  it('drops synced inspections via dropSyncedInspections()', async () => {
    await enqueueInspectionStart({
      id: 'insp_4',
      projectId: 'p1',
      templateId: 'tpl_epp_v1',
      responsibleUid: 'u1',
      startedAt: '2026-05-17T13:00:00.000Z',
    });
    await markInspectionSynced('insp_4');
    const dropped = await dropSyncedInspections();
    expect(dropped).toBe(1);
  });
});

describe('inspectionOutbox — observation-level queue', () => {
  it('enqueues + lists pending observations scoped by inspectionId', async () => {
    await enqueueObservation({
      observationId: 'obs_a',
      inspectionId: 'insp_x',
      projectId: 'p1',
      notes: 'Falta señalética',
      recordedAt: '2026-05-17T10:01:00.000Z',
    });
    await enqueueObservation({
      observationId: 'obs_b',
      inspectionId: 'insp_y',
      projectId: 'p1',
      notes: 'EPP incompleto',
      recordedAt: '2026-05-17T10:02:00.000Z',
    });
    const allPending = await listPendingObservations();
    expect(allPending).toHaveLength(2);
    const xOnly = await listPendingObservations('insp_x');
    expect(xOnly).toHaveLength(1);
    expect(xOnly[0].observationId).toBe('obs_a');
    expect(await countPendingObservations('insp_x')).toBe(1);
    expect(await countPendingObservations()).toBe(2);
  });

  it('marks an observation as synced and excludes it from the pending list', async () => {
    await enqueueObservation({
      observationId: 'obs_c',
      inspectionId: 'insp_z',
      projectId: 'p1',
      notes: 'OK',
      recordedAt: '2026-05-17T10:03:00.000Z',
    });
    await markObservationSynced('obs_c');
    expect(await listPendingObservations()).toHaveLength(0);
  });

  it('marks an observation as failed + retains it in pending list', async () => {
    await enqueueObservation({
      observationId: 'obs_d',
      inspectionId: 'insp_w',
      projectId: 'p1',
      notes: 'Pendiente',
      recordedAt: '2026-05-17T10:04:00.000Z',
    });
    await markObservationFailed('obs_d', 'http_503');
    const list = await listPendingObservations();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('failed');
    expect(list[0].lastError).toBe('http_503');
    expect(list[0].attempts).toBe(1);
  });

  it('re-keys an observation under a new id and resets its attempt counter shape', async () => {
    await enqueueObservation({
      observationId: 'obs_e',
      inspectionId: 'insp_v',
      projectId: 'p1',
      notes: 'Conflicted',
      recordedAt: '2026-05-17T10:05:00.000Z',
    });
    const next = await rekeyObservation('obs_e', 'obs_e_fresh');
    expect(next).not.toBeNull();
    expect(next!.observationId).toBe('obs_e_fresh');
    expect(next!.status).toBe('pending');
    expect(next!.lastError).toBeUndefined();
    const list = await listPendingObservations();
    expect(list.map((o) => o.observationId)).toEqual(['obs_e_fresh']);
  });

  it('returns null when re-keying a missing observation', async () => {
    const result = await rekeyObservation('nonexistent', 'whatever');
    expect(result).toBeNull();
  });

  it('drops synced observations via dropSyncedObservations()', async () => {
    await enqueueObservation({
      observationId: 'obs_f',
      inspectionId: 'insp_u',
      projectId: 'p1',
      notes: 'Cleared',
      recordedAt: '2026-05-17T10:06:00.000Z',
    });
    await markObservationSynced('obs_f');
    const dropped = await dropSyncedObservations();
    expect(dropped).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Codex round 2 hardening: module-level flush lock + cross-user purge.
// ────────────────────────────────────────────────────────────────────────

describe('inspectionOutbox — Codex round 2 hardening', () => {
  it('acquireFlushLock is mutually exclusive until releaseFlushLock is called', () => {
    expect(acquireFlushLock()).toBe(true);
    // A second acquire while the first is held must bail out.
    expect(acquireFlushLock()).toBe(false);
    releaseFlushLock();
    // After release the lock is taken again cleanly.
    expect(acquireFlushLock()).toBe(true);
    releaseFlushLock();
  });

  it('__resetInspectionOutboxForTests() also frees a held flush lock', () => {
    expect(acquireFlushLock()).toBe(true);
    __resetInspectionOutboxForTests();
    expect(acquireFlushLock()).toBe(true);
    releaseFlushLock();
  });

  it('listPendingInspections(ownerUid) hides rows owned by other users', async () => {
    await enqueueInspectionStart({
      id: 'insp_user_a',
      projectId: 'p1',
      templateId: 'tpl_altura_v1',
      responsibleUid: 'user_a',
      ownerUid: 'user_a',
      startedAt: '2026-05-17T10:00:00.000Z',
    });
    await enqueueInspectionStart({
      id: 'insp_user_b',
      projectId: 'p1',
      templateId: 'tpl_loto_v1',
      responsibleUid: 'user_b',
      ownerUid: 'user_b',
      startedAt: '2026-05-17T10:01:00.000Z',
    });
    const userA = await listPendingInspections('user_a');
    expect(userA).toHaveLength(1);
    expect(userA[0].id).toBe('insp_user_a');
    const userB = await listPendingInspections('user_b');
    expect(userB).toHaveLength(1);
    expect(userB[0].id).toBe('insp_user_b');
    // No ownerUid filter — both visible.
    const all = await listPendingInspections();
    expect(all).toHaveLength(2);
  });

  it('listPendingInspections(ownerUid) still includes legacy rows without ownerUid', async () => {
    // Legacy row (pre-Codex-round-2 schema) has no ownerUid.
    await enqueueInspectionStart({
      id: 'insp_legacy',
      projectId: 'p1',
      templateId: 'tpl_altura_v1',
      responsibleUid: 'someone',
      startedAt: '2026-05-17T10:00:00.000Z',
    });
    const filtered = await listPendingInspections('current_user');
    expect(filtered.map((i) => i.id)).toContain('insp_legacy');
  });

  it('listPendingObservations(_, ownerUid) hides rows owned by other users', async () => {
    await enqueueObservation({
      observationId: 'obs_a',
      inspectionId: 'insp_a',
      projectId: 'p1',
      ownerUid: 'user_a',
      notes: 'A',
      recordedAt: '2026-05-17T10:00:00.000Z',
    });
    await enqueueObservation({
      observationId: 'obs_b',
      inspectionId: 'insp_b',
      projectId: 'p1',
      ownerUid: 'user_b',
      notes: 'B',
      recordedAt: '2026-05-17T10:01:00.000Z',
    });
    const userA = await listPendingObservations(undefined, 'user_a');
    expect(userA.map((o) => o.observationId)).toEqual(['obs_a']);
    const userB = await listPendingObservations(undefined, 'user_b');
    expect(userB.map((o) => o.observationId)).toEqual(['obs_b']);
  });

  it('clearOutboxForOtherUsers() purges rows owned by other uids but spares legacy + current', async () => {
    // Owned by the previous user — should be purged.
    await enqueueInspectionStart({
      id: 'insp_prev',
      projectId: 'p1',
      templateId: 'tpl_altura_v1',
      responsibleUid: 'prev_user',
      ownerUid: 'prev_user',
      startedAt: '2026-05-17T10:00:00.000Z',
    });
    // Owned by the current user — must be kept.
    await enqueueInspectionStart({
      id: 'insp_curr',
      projectId: 'p1',
      templateId: 'tpl_loto_v1',
      responsibleUid: 'curr_user',
      ownerUid: 'curr_user',
      startedAt: '2026-05-17T10:01:00.000Z',
    });
    // Legacy row (no ownerUid) — preserved because we can't prove ownership.
    await enqueueInspectionStart({
      id: 'insp_legacy',
      projectId: 'p1',
      templateId: 'tpl_caliente_v1',
      responsibleUid: 'unknown',
      startedAt: '2026-05-17T10:02:00.000Z',
    });
    await enqueueObservation({
      observationId: 'obs_prev',
      inspectionId: 'insp_prev',
      projectId: 'p1',
      ownerUid: 'prev_user',
      notes: 'prev',
      recordedAt: '2026-05-17T10:00:30.000Z',
    });
    await enqueueObservation({
      observationId: 'obs_curr',
      inspectionId: 'insp_curr',
      projectId: 'p1',
      ownerUid: 'curr_user',
      notes: 'curr',
      recordedAt: '2026-05-17T10:01:30.000Z',
    });

    const removed = await clearOutboxForOtherUsers('curr_user');
    expect(removed).toBe(2); // insp_prev + obs_prev

    const remainingInsps = await listPendingInspections();
    const remainingIds = remainingInsps.map((i) => i.id).sort();
    expect(remainingIds).toEqual(['insp_curr', 'insp_legacy']);

    const remainingObs = await listPendingObservations();
    expect(remainingObs.map((o) => o.observationId)).toEqual(['obs_curr']);
  });

  it('clearOutboxForOtherUsers() is a no-op when no cross-user rows exist', async () => {
    await enqueueInspectionStart({
      id: 'insp_only',
      projectId: 'p1',
      templateId: 'tpl_altura_v1',
      responsibleUid: 'me',
      ownerUid: 'me',
      startedAt: '2026-05-17T10:00:00.000Z',
    });
    const removed = await clearOutboxForOtherUsers('me');
    expect(removed).toBe(0);
    const remaining = await listPendingInspections();
    expect(remaining).toHaveLength(1);
  });
});
