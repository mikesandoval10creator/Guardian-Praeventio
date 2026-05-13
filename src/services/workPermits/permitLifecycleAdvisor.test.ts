import { describe, it, expect } from 'vitest';
import {
  advanceStage,
  currentStage,
  requiredApprovalsForKind,
  checklistForPermitKind,
  buildEmptyChecklist,
  daysUntilExpiry,
  escalateOverduePermits,
  checklistCompletion,
  isChecklistReady,
  REQUIRED_APPROVALS_BY_KIND,
  GRACE_PERIOD_HOURS,
  type PermitLifecycleStage,
} from './permitLifecycleAdvisor.js';
import type { WorkPermit, WorkPermitKind } from './workPermitEngine.js';

const KINDS: WorkPermitKind[] = [
  'altura',
  'caliente',
  'confinado',
  'loto',
  'excavacion',
  'izaje_critico',
];

const NOW = new Date('2026-05-12T10:00:00Z');

function mkPermit(over: Partial<WorkPermit> = {}): WorkPermit {
  return {
    id: 'p-1',
    kind: 'altura',
    workerUid: 'w1',
    approverUid: 'sup1',
    approverRole: 'supervisor',
    taskDescription: 'tarea x',
    status: 'active',
    preconditions: {
      workerHasTraining: true,
      workerHasEpp: true,
      workerMedicallyFit: true,
      checklist: { items: [] },
    },
    createdAt: NOW.toISOString(),
    approvedAt: NOW.toISOString(),
    validFrom: NOW.toISOString(),
    validUntil: new Date(NOW.getTime() + 8 * 3_600_000).toISOString(),
    ...over,
  };
}

describe('permitLifecycleAdvisor — checklistForPermitKind', () => {
  it.each(KINDS)('returns canonical checklist items for %s', (kind) => {
    const items = checklistForPermitKind(kind);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.id.startsWith(kind))).toBe(true);
    expect(items.every((i) => i.checked === false)).toBe(true);
    // ids must be unique
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('buildEmptyChecklist wraps items in WorkPermitChecklist shape', () => {
    const cl = buildEmptyChecklist('confinado');
    expect(cl.items.length).toBeGreaterThan(0);
    expect(cl.items.every((i) => !i.checked)).toBe(true);
  });
});

describe('permitLifecycleAdvisor — requiredApprovalsForKind', () => {
  it.each(KINDS)('lists at least one approver role for %s', (kind) => {
    const roles = requiredApprovalsForKind(kind);
    expect(roles.length).toBeGreaterThan(0);
  });

  it('confinado and izaje_critico require gerente in addition to supervisor', () => {
    expect(REQUIRED_APPROVALS_BY_KIND.confinado).toContain('gerente');
    expect(REQUIRED_APPROVALS_BY_KIND.izaje_critico).toContain('gerente');
  });

  it('altura and caliente do NOT require gerente', () => {
    expect(REQUIRED_APPROVALS_BY_KIND.altura).not.toContain('gerente');
    expect(REQUIRED_APPROVALS_BY_KIND.caliente).not.toContain('gerente');
  });
});

describe('permitLifecycleAdvisor — advanceStage transitions', () => {
  it('preparation → issued on submit_for_approval', () => {
    expect(advanceStage('preparation', 'submit_for_approval')).toBe('issued');
  });

  it('issued → active on approve', () => {
    expect(advanceStage('issued', 'approve')).toBe('active');
  });

  it('active → closed on fulfill', () => {
    expect(advanceStage('active', 'fulfill')).toBe('closed');
  });

  it('active → in_grace on enter_grace', () => {
    expect(advanceStage('active', 'enter_grace')).toBe('in_grace');
  });

  it('in_grace → expired on expire', () => {
    expect(advanceStage('in_grace', 'expire')).toBe('expired');
  });

  it('in_grace → closed on fulfill (worker llega tarde pero termina)', () => {
    expect(advanceStage('in_grace', 'fulfill')).toBe('closed');
  });

  it('any → cancelled on cancel from preparation/issued/active/in_grace', () => {
    const cancellable: PermitLifecycleStage[] = ['preparation', 'issued', 'active', 'in_grace'];
    for (const s of cancellable) {
      expect(advanceStage(s, 'cancel')).toBe('cancelled');
    }
  });

  it('terminal stages are no-ops', () => {
    expect(advanceStage('closed', 'cancel')).toBe('closed');
    expect(advanceStage('cancelled', 'approve')).toBe('cancelled');
    expect(advanceStage('expired', 'fulfill')).toBe('expired');
  });

  it('invalid event for stage is no-op (does not throw)', () => {
    expect(advanceStage('preparation', 'fulfill')).toBe('preparation');
    expect(advanceStage('issued', 'enter_grace')).toBe('issued');
  });
});

describe('permitLifecycleAdvisor — currentStage', () => {
  it('returns active for valid permit before expiry', () => {
    const p = mkPermit();
    expect(currentStage(p, NOW)).toBe('active');
  });

  it('returns in_grace when past validUntil but within grace window', () => {
    const p = mkPermit();
    const justAfter = new Date(Date.parse(p.validUntil) + 30 * 60_000); // +30 min
    expect(currentStage(p, justAfter)).toBe('in_grace');
  });

  it('returns expired after grace window', () => {
    const p = mkPermit();
    const wayAfter = new Date(
      Date.parse(p.validUntil) + (GRACE_PERIOD_HOURS + 1) * 3_600_000,
    );
    expect(currentStage(p, wayAfter)).toBe('expired');
  });

  it('returns cancelled / closed for terminal engine status', () => {
    expect(currentStage(mkPermit({ status: 'cancelled', cancelledAt: NOW.toISOString() }))).toBe(
      'cancelled',
    );
    expect(currentStage(mkPermit({ status: 'fulfilled', fulfilledAt: NOW.toISOString() }))).toBe(
      'closed',
    );
  });

  it('maps draft → preparation, pending_approval → issued', () => {
    expect(currentStage(mkPermit({ status: 'draft' }), NOW)).toBe('preparation');
    expect(currentStage(mkPermit({ status: 'pending_approval' }), NOW)).toBe('issued');
  });
});

describe('permitLifecycleAdvisor — daysUntilExpiry', () => {
  it('positive for future expiry', () => {
    const p = mkPermit({
      validUntil: new Date(NOW.getTime() + 3 * 86_400_000).toISOString(),
    });
    expect(daysUntilExpiry(p, NOW)).toBe(3);
  });

  it('negative when already expired', () => {
    const p = mkPermit({
      validUntil: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
    });
    expect(daysUntilExpiry(p, NOW)).toBeLessThan(0);
  });
});

describe('permitLifecycleAdvisor — escalateOverduePermits', () => {
  it('returns only active permits past validUntil', () => {
    const overdue = mkPermit({
      id: 'overdue',
      validUntil: new Date(NOW.getTime() - 3_600_000).toISOString(),
      status: 'active',
    });
    const fresh = mkPermit({
      id: 'fresh',
      validUntil: new Date(NOW.getTime() + 3_600_000).toISOString(),
    });
    const closedOld = mkPermit({
      id: 'closed-old',
      status: 'fulfilled',
      fulfilledAt: NOW.toISOString(),
      validUntil: new Date(NOW.getTime() - 3_600_000).toISOString(),
    });

    const result = escalateOverduePermits([overdue, fresh, closedOld], NOW);
    expect(result.map((p) => p.id)).toEqual(['overdue']);
  });

  it('empty list returns empty', () => {
    expect(escalateOverduePermits([], NOW)).toEqual([]);
  });
});

describe('permitLifecycleAdvisor — checklist completion helpers', () => {
  it('checklistCompletion returns fraction', () => {
    const cl = buildEmptyChecklist('altura');
    expect(checklistCompletion(cl)).toBe(0);
    cl.items[0].checked = true;
    expect(checklistCompletion(cl)).toBeCloseTo(1 / cl.items.length);
  });

  it('isChecklistReady true only when all required labels checked', () => {
    const cl = buildEmptyChecklist('loto');
    expect(isChecklistReady('loto', cl)).toBe(false);
    cl.items.forEach((i) => (i.checked = true));
    expect(isChecklistReady('loto', cl)).toBe(true);
  });

  it('isChecklistReady false if items checked but labels differ from canon', () => {
    const fakeChecklist = {
      items: [{ id: 'x', label: 'algo distinto', checked: true }],
    };
    expect(isChecklistReady('altura', fakeChecklist)).toBe(false);
  });
});
