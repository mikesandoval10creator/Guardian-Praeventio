// Praeventio Guard — conflictQueue unit tests.

import { describe, it, expect } from 'vitest';
import {
  shouldEnqueueForHumanResolution,
  buildConflictQueueEntry,
  selectEntriesToEnqueue,
  resolveConflictQueueEntry,
  markInReview,
  rejectAsInvalid,
  ConflictQueueValidationError,
} from './conflictQueue';
import type { Conflict } from './conflictResolver';

function makeConflict(overrides: Partial<Conflict> = {}): Conflict {
  return {
    collection: 'incident_reports',
    docId: 'inc-1',
    docType: 'IncidentReport',
    localUpdatedAt: '2026-01-01T00:00:00Z',
    serverUpdatedAt: '2026-01-01T00:01:00Z',
    isDeletionConflict: false,
    fields: [
      { field: 'severity', localValue: 'high', remoteValue: 'medium', critical: true },
    ],
    ...overrides,
  };
}

describe('shouldEnqueueForHumanResolution', () => {
  it('enqueues siempre para los 5 safety doc types', () => {
    for (const type of ['Inspection', 'IncidentReport', 'EmergencyAlert', 'MedicalRecord', 'TrainingCompletion']) {
      const c = makeConflict({
        docType: type,
        fields: [{ field: 'foo', localValue: 1, remoteValue: 2, critical: false }],
      });
      expect(shouldEnqueueForHumanResolution(c)).toBe(true);
    }
  });

  it('enqueues si hay deletion conflict', () => {
    const c = makeConflict({
      docType: 'RiskNode',
      isDeletionConflict: true,
      fields: [{ field: 'foo', localValue: 'a', remoteValue: 'b', critical: false }],
    });
    expect(shouldEnqueueForHumanResolution(c)).toBe(true);
  });

  it('enqueues si algún field es critical', () => {
    const c = makeConflict({
      docType: 'RiskNode',
      fields: [
        { field: 'description', localValue: 'a', remoteValue: 'b', critical: false },
        { field: 'severity', localValue: 'high', remoteValue: 'low', critical: true },
      ],
    });
    expect(shouldEnqueueForHumanResolution(c)).toBe(true);
  });

  it('NO enqueues si solo hay LWW non-critical', () => {
    const c = makeConflict({
      docType: 'RiskNode',
      fields: [
        { field: 'description', localValue: 'a', remoteValue: 'b', critical: false },
      ],
    });
    expect(shouldEnqueueForHumanResolution(c)).toBe(false);
  });
});

describe('buildConflictQueueEntry', () => {
  it('produce queueId determinístico para el mismo input', () => {
    const now = new Date('2026-01-01T00:05:00Z');
    const a = buildConflictQueueEntry({
      conflict: makeConflict(),
      localAuthorUid: 'worker-1',
      projectId: 'proj-1',
      now,
    });
    const b = buildConflictQueueEntry({
      conflict: makeConflict(),
      localAuthorUid: 'worker-1',
      projectId: 'proj-1',
      now,
    });
    expect(a.queueId).toBe(b.queueId);
    expect(a.queueId).toHaveLength(32);
  });

  it('inicia con status pending y timestamp', () => {
    const now = new Date('2026-01-01T00:05:00Z');
    const entry = buildConflictQueueEntry({
      conflict: makeConflict(),
      localAuthorUid: 'worker-1',
      projectId: 'proj-1',
      now,
    });
    expect(entry.status).toBe('pending');
    expect(entry.enqueuedAt).toBe('2026-01-01T00:05:00.000Z');
    expect(entry.resolvedAt).toBeUndefined();
    expect(entry.resolvedByUid).toBeUndefined();
  });

  it('rechaza uid o projectId vacíos', () => {
    expect(() =>
      buildConflictQueueEntry({
        conflict: makeConflict(),
        localAuthorUid: '',
        projectId: 'p',
      }),
    ).toThrow(/MISSING_UID/);
    expect(() =>
      buildConflictQueueEntry({
        conflict: makeConflict(),
        localAuthorUid: 'w',
        projectId: '',
      }),
    ).toThrow(/MISSING_PROJECT/);
  });
});

describe('selectEntriesToEnqueue', () => {
  it('filtra conflictos que no requieren resolución humana', () => {
    const conflicts: Conflict[] = [
      makeConflict({
        docType: 'RiskNode',
        fields: [{ field: 'description', localValue: 'a', remoteValue: 'b', critical: false }],
      }),
      makeConflict({
        docType: 'IncidentReport',
      }),
    ];
    const out = selectEntriesToEnqueue(conflicts, 'w', 'p');
    expect(out).toHaveLength(1);
    expect(out[0].conflict.docType).toBe('IncidentReport');
  });
});

describe('resolveConflictQueueEntry', () => {
  it('marca como resolved con choices del supervisor', () => {
    const entry = buildConflictQueueEntry({
      conflict: makeConflict(),
      localAuthorUid: 'w',
      projectId: 'p',
    });
    const resolved = resolveConflictQueueEntry(
      entry,
      'supervisor-1',
      { severity: { chosen: 'remote', value: 'medium' } },
      'Decided remote was correct after review',
    );
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedByUid).toBe('supervisor-1');
    expect(resolved.resolution?.severity.chosen).toBe('remote');
    expect(resolved.notes).toContain('Decided');
  });

  it('rechaza si la resolución no cubre todos los critical fields', () => {
    const entry = buildConflictQueueEntry({
      conflict: makeConflict({
        fields: [
          { field: 'severity', localValue: 1, remoteValue: 2, critical: true },
          { field: 'status', localValue: 'open', remoteValue: 'closed', critical: true },
        ],
      }),
      localAuthorUid: 'w',
      projectId: 'p',
    });
    expect(() =>
      resolveConflictQueueEntry(entry, 'supervisor-1', {
        severity: { chosen: 'local', value: 1 },
        // status falta
      }),
    ).toThrow(/INCOMPLETE_RESOLUTION/);
  });

  it('rechaza re-resolución de entries ya finalizados', () => {
    const entry = buildConflictQueueEntry({
      conflict: makeConflict(),
      localAuthorUid: 'w',
      projectId: 'p',
    });
    const resolved = resolveConflictQueueEntry(entry, 'sup', {
      severity: { chosen: 'local', value: 'high' },
    });
    expect(() =>
      resolveConflictQueueEntry(resolved, 'sup2', {
        severity: { chosen: 'remote', value: 'low' },
      }),
    ).toThrow(/ALREADY_FINALIZED/);
  });
});

describe('markInReview / rejectAsInvalid', () => {
  it('transition pending → in_review', () => {
    const entry = buildConflictQueueEntry({
      conflict: makeConflict(),
      localAuthorUid: 'w',
      projectId: 'p',
    });
    const reviewing = markInReview(entry, 'supervisor-1');
    expect(reviewing.status).toBe('in_review');
  });

  it('rejectAsInvalid requiere reason de ≥5 chars', () => {
    const entry = buildConflictQueueEntry({
      conflict: makeConflict(),
      localAuthorUid: 'w',
      projectId: 'p',
    });
    expect(() => rejectAsInvalid(entry, 'sup', 'wat')).toThrow(/REASON_TOO_SHORT/);
    const rejected = rejectAsInvalid(entry, 'sup', 'Duplicate report from sync race');
    expect(rejected.status).toBe('rejected');
    expect(rejected.notes).toContain('Duplicate');
  });
});
