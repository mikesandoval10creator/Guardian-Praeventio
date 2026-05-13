import { describe, it, expect } from 'vitest';
import {
  analyzeRetaliationRisk,
  recommendProtectiveActions,
  type RetaliationSignal,
} from './retaliationDetector.js';

function sig(over: Partial<RetaliationSignal> & { kind: RetaliationSignal['kind'] }): RetaliationSignal {
  return {
    kind: over.kind,
    severity: over.severity ?? 'medium',
    observedAt: over.observedAt ?? '2026-05-15T00:00:00Z',
    reporterUid: over.reporterUid ?? 'rep-1',
    supervisorUid: over.supervisorUid ?? 'sup-1',
  };
}

describe('analyzeRetaliationRisk', () => {
  it('returns low score with no signals', () => {
    const a = analyzeRetaliationRisk('2026-05-10T00:00:00Z', []);
    expect(a.score).toBe(0);
    expect(a.level).toBe('low');
  });

  it('scores high when severe salary + role + isolation signals stack', () => {
    const a = analyzeRetaliationRisk('2026-05-10T00:00:00Z', [
      sig({ kind: 'salary_change', severity: 'high', observedAt: '2026-05-15T00:00:00Z' }),
      sig({ kind: 'role_demoted', severity: 'high', observedAt: '2026-05-20T00:00:00Z' }),
      sig({ kind: 'isolation', severity: 'medium', observedAt: '2026-05-22T00:00:00Z' }),
    ]);
    expect(a.score).toBeGreaterThanOrEqual(70);
    expect(a.level).toBe('high');
    expect(a.topKinds).toContain('salary_change');
  });

  it('ignores signals outside the 90-day window', () => {
    const a = analyzeRetaliationRisk('2026-01-01T00:00:00Z', [
      sig({ kind: 'salary_change', observedAt: '2026-05-15T00:00:00Z' }),
    ]);
    expect(a.signalCount).toBe(0);
  });

  it('ignores signals before the report date', () => {
    const a = analyzeRetaliationRisk('2026-05-10T00:00:00Z', [
      sig({ kind: 'salary_change', observedAt: '2026-04-15T00:00:00Z' }),
    ]);
    expect(a.signalCount).toBe(0);
  });

  it('classifies moderate at score ≥35', () => {
    const a = analyzeRetaliationRisk('2026-05-10T00:00:00Z', [
      sig({ kind: 'shift_change_negative', severity: 'high', observedAt: '2026-05-15T00:00:00Z' }),
      sig({ kind: 'increased_scrutiny', severity: 'high', observedAt: '2026-05-16T00:00:00Z' }),
    ]);
    expect(a.level).toBe('moderate');
  });
});

describe('recommendProtectiveActions', () => {
  it('high risk yields full protective bundle', () => {
    const a = analyzeRetaliationRisk('2026-05-10T00:00:00Z', [
      sig({ kind: 'salary_change', severity: 'high', observedAt: '2026-05-15T00:00:00Z' }),
      sig({ kind: 'role_demoted', severity: 'high', observedAt: '2026-05-20T00:00:00Z' }),
      sig({ kind: 'isolation', severity: 'medium', observedAt: '2026-05-22T00:00:00Z' }),
    ]);
    const acts = recommendProtectiveActions(a);
    const kinds = acts.map((x) => x.kind);
    expect(kinds).toContain('separate_from_supervisor');
    expect(kinds).toContain('transfer_team');
    expect(kinds).toContain('external_mediation');
    expect(kinds).toContain('legal_counsel_referral');
  });

  it('low risk with material salary change still triggers legal counsel', () => {
    const a = analyzeRetaliationRisk('2026-05-10T00:00:00Z', [
      sig({ kind: 'salary_change', severity: 'low', observedAt: '2026-05-12T00:00:00Z' }),
    ]);
    const acts = recommendProtectiveActions(a);
    expect(acts.some((x) => x.kind === 'legal_counsel_referral')).toBe(true);
    expect(acts.some((x) => x.kind === 'wellbeing_check_in')).toBe(true);
  });
});
