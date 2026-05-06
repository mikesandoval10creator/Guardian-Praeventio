// Sprint 34 — Tests for the per-field conflict resolver.
//
// Pure module, no idb / no firestore — all tests run in the default
// node vitest environment.

import { describe, it, expect } from 'vitest';
import {
  CRITICAL_FIELDS_BY_TYPE,
  buildAuditRow,
  detectConflicts,
  partitionFields,
  requiresManualResolution,
  resolveLww,
  type DocSnapshot,
  type PendingAction,
} from './conflictResolver';

const ISO_OLD = '2026-05-05T10:00:00.000Z';
const ISO_NEW = '2026-05-05T10:05:00.000Z';

function pending(over: Partial<PendingAction> = {}): PendingAction {
  return {
    collection: 'nodes',
    docId: 'n1',
    type: 'update',
    data: {},
    localUpdatedAt: ISO_NEW,
    ...over,
  };
}

function snap(over: Partial<DocSnapshot> = {}): DocSnapshot {
  return {
    collection: 'nodes',
    docId: 'n1',
    data: {},
    serverUpdatedAt: ISO_NEW,
    ...over,
  };
}

describe('conflictResolver', () => {
  it('Test 1 — non-critical field divergence: LWW chosen by greater updatedAt + audit row', () => {
    const local = pending({
      data: { description: 'updated by worker A offline' },
      localUpdatedAt: ISO_OLD,
    });
    const remote = snap({
      data: { description: 'edited by worker B on server' },
      serverUpdatedAt: ISO_NEW,
    });
    const conflicts = detectConflicts([local], [remote]);
    expect(conflicts).toHaveLength(1);
    const c = conflicts[0];
    expect(requiresManualResolution(c)).toBe(false);

    const fieldConflict = c.fields[0];
    const resolved = resolveLww(c, fieldConflict);
    // Server timestamp (ISO_NEW) > local (ISO_OLD), so remote wins.
    expect(resolved.chosen).toBe('remote');
    expect(resolved.value).toBe('edited by worker B on server');

    const audit = buildAuditRow(c, resolved, 'uid-A', true);
    expect(audit).toMatchObject({
      docId: 'n1',
      collection: 'nodes',
      field: 'description',
      chosen: 'remote',
      byUid: 'uid-A',
      automatic: true,
    });
    expect(typeof audit.appliedAt).toBe('string');
  });

  it('Test 2 — critical field divergence: requiresManualResolution=true (no auto)', () => {
    const local = pending({
      data: { severity: 'high' },
      localUpdatedAt: ISO_OLD,
    });
    const remote = snap({
      data: { severity: 'low' },
      serverUpdatedAt: ISO_NEW,
    });
    const conflicts = detectConflicts([local], [remote]);
    expect(conflicts).toHaveLength(1);
    expect(requiresManualResolution(conflicts[0])).toBe(true);

    expect(() => resolveLww(conflicts[0], conflicts[0].fields[0])).toThrow(
      /critical/,
    );
  });

  it('Test 3 — two critical conflicts in the same doc: drawer queue', () => {
    const local = pending({
      data: { severity: 'high', priority: 'urgent', notes: 'extra context' },
      localUpdatedAt: ISO_OLD,
    });
    const remote = snap({
      data: { severity: 'low', priority: 'normal', notes: 'old note' },
      serverUpdatedAt: ISO_NEW,
    });
    const conflicts = detectConflicts([local], [remote]);
    expect(conflicts).toHaveLength(1);
    const { autoResolvable, manual } = partitionFields(conflicts[0]);
    expect(manual.map((f) => f.field).sort()).toEqual(['priority', 'severity']);
    expect(autoResolvable.map((f) => f.field)).toEqual(['notes']);
    expect(requiresManualResolution(conflicts[0])).toBe(true);
  });

  it('Test 4 — local-only add (worker added a control offline, server lacks field): no conflict, additive merge', () => {
    const local = pending({
      data: { newControl: 'EPP-12 hardhat verification' },
      localUpdatedAt: ISO_NEW,
    });
    const remote = snap({
      data: { severity: 'low' }, // no newControl key on server
      serverUpdatedAt: ISO_NEW,
    });
    const conflicts = detectConflicts([local], [remote]);
    expect(conflicts).toHaveLength(0);
  });

  it('Test 5 — deletion conflict: local deletes, server updates → critical, prompt', () => {
    const local = pending({
      type: 'delete',
      data: {},
      localUpdatedAt: ISO_OLD,
    });
    const remote = snap({
      data: { severity: 'high', updatedBy: 'supervisor' },
      serverUpdatedAt: ISO_NEW,
    });
    const conflicts = detectConflicts([local], [remote]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].isDeletionConflict).toBe(true);
    expect(requiresManualResolution(conflicts[0])).toBe(true);
    expect(conflicts[0].fields[0].field).toBe('__deletion__');
  });

  it('skips conflict when server timestamp is older than local (we won the race)', () => {
    const local = pending({
      data: { severity: 'high' },
      localUpdatedAt: ISO_NEW,
    });
    const remote = snap({
      data: { severity: 'low' },
      serverUpdatedAt: ISO_OLD,
    });
    const conflicts = detectConflicts([local], [remote]);
    expect(conflicts).toHaveLength(0);
  });

  it('exposes the canonical CRITICAL_FIELDS list for documentation/tests', () => {
    expect(CRITICAL_FIELDS_BY_TYPE.RiskNode).toContain('severity');
    expect(CRITICAL_FIELDS_BY_TYPE.RiskNode).toContain('controls');
    expect(CRITICAL_FIELDS_BY_TYPE.Incident).toContain('rootCause');
    expect(CRITICAL_FIELDS_BY_TYPE.ErgonomicAssessment).toContain('rebaScore');
  });
});
