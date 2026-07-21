import { describe, it, expect } from 'vitest';
import { offlineOpDocId } from './offlineOpId';

/**
 * The bug this guards against: saveForSync() enqueues the same operation into
 * BOTH the legacy IndexedDB/SQLite queue and the central state machine, and
 * each one drains through its own executor. Without a shared identity a
 * `create` produced two distinct documents — the same hazard report filed
 * twice, from one tap.
 *
 * The fix is a document id derived from the operation's content, so both
 * queues write the same row and whichever drains second is a no-op.
 */
describe('offlineOpDocId', () => {
  const data = { title: 'Casco faltante', localUpdatedAt: '2026-07-20T06:00:00.000Z' };

  it('gives both queues the same id for the same operation', () => {
    // The legacy queue stores syncAction.data; the state machine stores a
    // spread copy of it. Same content, different object identity.
    const fromLegacyQueue = offlineOpDocId('incidents', 'create', data);
    const fromStateMachine = offlineOpDocId('incidents', 'create', { ...data });

    expect(fromStateMachine).toBe(fromLegacyQueue);
  });

  it('is stable across key ordering, so a re-serialized payload still matches', () => {
    const reordered = { localUpdatedAt: data.localUpdatedAt, title: data.title };

    expect(offlineOpDocId('incidents', 'create', reordered)).toBe(
      offlineOpDocId('incidents', 'create', data),
    );
  });

  it('keeps two genuinely different reports apart', () => {
    const other = { ...data, title: 'Andamio sin baranda' };

    expect(offlineOpDocId('incidents', 'create', other)).not.toBe(
      offlineOpDocId('incidents', 'create', data),
    );
  });

  it('never merges operations across collections or types', () => {
    const asIncident = offlineOpDocId('incidents', 'create', data);
    const asHazard = offlineOpDocId('hazards', 'create', data);
    const asUpload = offlineOpDocId('incidents', 'upload', data);

    expect(new Set([asIncident, asHazard, asUpload]).size).toBe(3);
  });

  it('separates two reports filed in the same millisecond', () => {
    // Timestamp alone would not be enough identity — a bulk flush can queue
    // several ops sharing localUpdatedAt, and merging them would silently
    // lose a report.
    const sameInstant = { ...data, title: 'Derrame de aceite' };

    expect(offlineOpDocId('incidents', 'create', sameInstant)).not.toBe(
      offlineOpDocId('incidents', 'create', data),
    );
  });

  it('matches across the two queues even though they carry different payloads', () => {
    // This is the whole point of the fix, using the real shapes. The legacy
    // executor strips createNode/nodeData before writing
    // (OfflineSyncManager.tsx:40); the state machine keeps them (:322). If
    // the hash saw that difference, each queue would create its own document
    // and nothing would be deduplicated.
    const legacyPayload = { ...data };
    const stateMachinePayload = { ...data, createNode: true, nodeData: { kind: 'hazard' } };

    expect(offlineOpDocId('incidents', 'create', stateMachinePayload)).toBe(
      offlineOpDocId('incidents', 'create', legacyPayload),
    );
  });

  it('produces an id Firestore rules accept as a document id', () => {
    // firestore.rules:33 — ^[a-zA-Z0-9_\-]+$, max 128 chars.
    const id = offlineOpDocId('incidents', 'create', data);

    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(id.length).toBeLessThanOrEqual(128);
  });

  it('handles a payload that carries no localUpdatedAt', () => {
    expect(() => offlineOpDocId('incidents', 'create', { title: 'x' })).not.toThrow();
    expect(offlineOpDocId('incidents', 'create', {})).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it('survives a payload holding a value JSON cannot serialize', () => {
    // Callers have been known to tuck non-serializable values into data.
    // An id is still required — throwing would strand the operation in the
    // queue forever, which for an incident report means it never arrives.
    const cyclic: Record<string, unknown> = { storagePath: 'docs/abc.pdf' };
    cyclic.self = cyclic;

    expect(() => offlineOpDocId('documents', 'upload', cyclic)).not.toThrow();
  });
});
