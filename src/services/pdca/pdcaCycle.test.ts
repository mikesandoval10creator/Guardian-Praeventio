import { describe, it, expect } from 'vitest';
import {
  currentPhase,
  buildPDCASummary,
  checkLinkageHealth,
  evaluateEffectiveness,
  rankZonesByNonConformities,
  rankTasksByNonConformities,
  type NonConformity,
} from './pdcaCycle.js';

function nc(over: Partial<NonConformity> & { id: string }): NonConformity {
  return {
    id: over.id,
    category: over.category ?? 'orden',
    severity: over.severity ?? 'minor',
    description: over.description ?? 'd',
    detectedAt: over.detectedAt ?? '2026-05-01T00:00:00Z',
    location: over.location ?? 'sector A',
    responsibleUid: over.responsibleUid ?? 'r1',
    status: over.status ?? 'open',
    taskId: over.taskId,
    correctiveActionId: over.correctiveActionId,
    closedAt: over.closedAt,
    verifiedEffectiveAt: over.verifiedEffectiveAt,
    reoccurredAt: over.reoccurredAt,
  };
}

describe('currentPhase', () => {
  it('open→plan, in_progress→do, closed→check, verified_effective→act', () => {
    expect(currentPhase(nc({ id: 'a', status: 'open' }))).toBe('plan');
    expect(currentPhase(nc({ id: 'b', status: 'in_progress' }))).toBe('do');
    expect(currentPhase(nc({ id: 'c', status: 'closed' }))).toBe('check');
    expect(currentPhase(nc({ id: 'd', status: 'verified_effective' }))).toBe('act');
    expect(currentPhase(nc({ id: 'e', status: 'reoccurred' }))).toBe('plan');
  });
});

describe('buildPDCASummary', () => {
  it('cuenta por fase + effectiveness rate', () => {
    const s = buildPDCASummary([
      nc({ id: 'a', status: 'open' }),
      nc({ id: 'b', status: 'closed' }),
      nc({ id: 'c', status: 'verified_effective' }),
      nc({ id: 'd', status: 'verified_effective' }),
    ]);
    expect(s.total).toBe(4);
    expect(s.byPhase.plan).toBe(1);
    expect(s.byPhase.check).toBe(1);
    expect(s.byPhase.act).toBe(2);
    expect(s.effectivenessRate).toBe(67);
  });
});

describe('checkLinkageHealth', () => {
  it('detecta NC abiertas >7d sin acción asignada', () => {
    const r = checkLinkageHealth(
      [
        nc({ id: 'a', detectedAt: '2026-05-01T00:00:00Z', status: 'open' }),
        nc({ id: 'b', correctiveActionId: 'ca1' }),
      ],
      '2026-05-11T00:00:00Z',
    );
    expect(r.staleOrphans).toHaveLength(1);
    expect(r.orphanRate).toBe(50);
  });
});

describe('evaluateEffectiveness', () => {
  it('NC sin closedAt → null', () => {
    expect(evaluateEffectiveness(nc({ id: 'a' }))).toBeNull();
  });

  it('reoccurred → passed=false', () => {
    const r = evaluateEffectiveness(
      nc({ id: 'a', status: 'reoccurred', closedAt: '2026-05-01T00:00:00Z' }),
      '2026-05-11T00:00:00Z',
    );
    expect(r?.passed).toBe(false);
  });

  it('verified_effective → passed=true', () => {
    const r = evaluateEffectiveness(
      nc({ id: 'a', status: 'verified_effective', closedAt: '2026-05-01T00:00:00Z' }),
      '2026-06-01T00:00:00Z',
    );
    expect(r?.passed).toBe(true);
  });

  it('closed >=30d sin verificación → pendingVerification', () => {
    const r = evaluateEffectiveness(
      nc({ id: 'a', status: 'closed', closedAt: '2026-04-01T00:00:00Z' }),
      '2026-05-11T00:00:00Z',
    );
    expect(r?.pendingVerification).toBe(true);
  });
});

describe('rankZonesByNonConformities', () => {
  it('ordena por críticas primero', () => {
    const r = rankZonesByNonConformities([
      nc({ id: 'a', location: 'X', severity: 'minor' }),
      nc({ id: 'b', location: 'X', severity: 'minor' }),
      nc({ id: 'c', location: 'Y', severity: 'critical' }),
    ]);
    expect(r[0].location).toBe('Y');
    expect(r[0].criticalCount).toBe(1);
  });
});

describe('rankTasksByNonConformities', () => {
  it('ordena por críticas, ignora NC sin taskId', () => {
    const r = rankTasksByNonConformities([
      nc({ id: 'a', taskId: 't1', severity: 'minor' }),
      nc({ id: 'b', taskId: 't1', severity: 'major' }),
      nc({ id: 'c', taskId: 't2', severity: 'critical' }),
      nc({ id: 'd' }), // sin taskId → ignorado
    ]);
    expect(r).toHaveLength(2);
    expect(r[0].taskId).toBe('t2');
  });
});
