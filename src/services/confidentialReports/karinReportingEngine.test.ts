import { describe, it, expect } from 'vitest';
import {
  validateKarinReport,
  assignInvestigator,
  detectRetaliationPatterns,
  type KarinReport,
  type InvestigatorCandidate,
  type PostReportEvent,
} from './karinReportingEngine.js';

function report(over: Partial<KarinReport> & { id: string }): KarinReport {
  return {
    id: over.id,
    reporterAlias: over.reporterAlias ?? 'alias-1',
    reporterUidEncrypted: over.reporterUidEncrypted,
    kind: over.kind ?? 'harassment',
    summary: over.summary ?? 'description of incident',
    witnessesAlias: over.witnessesAlias,
    evidenceArtifacts: over.evidenceArtifacts,
    reportedAt: over.reportedAt ?? '2026-05-10T00:00:00Z',
    eventOccurredAt: over.eventOccurredAt ?? '2026-05-01T00:00:00Z',
    status: over.status ?? 'received',
    anonymous: over.anonymous,
    reporterGender: over.reporterGender,
    preferSameGenderInvestigator: over.preferSameGenderInvestigator,
  };
}

describe('validateKarinReport', () => {
  it('passes a well-formed report', () => {
    expect(validateKarinReport(report({ id: 'r-1' })).valid).toBe(true);
  });

  it('rejects when reporterAlias is empty and not anonymous', () => {
    const r = validateKarinReport(report({ id: 'r-1', reporterAlias: '', anonymous: false }));
    expect(r.valid).toBe(false);
    expect(r.errors).toContain('reporter_alias_required_for_non_anonymous');
  });

  it('allows empty alias when anonymous=true', () => {
    const r = validateKarinReport(report({ id: 'r-1', reporterAlias: '', anonymous: true }));
    expect(r.valid).toBe(true);
  });

  it('rejects when summary is empty', () => {
    const r = validateKarinReport(report({ id: 'r-1', summary: '' }));
    expect(r.errors).toContain('summary_required');
  });

  it('rejects when event is >30 days before report and not anonymous', () => {
    const r = validateKarinReport(
      report({
        id: 'r-1',
        eventOccurredAt: '2026-01-01T00:00:00Z',
        reportedAt: '2026-05-01T00:00:00Z',
      }),
    );
    expect(r.errors).toContain('reporting_deadline_passed');
  });

  it('downgrades deadline to warning when anonymous', () => {
    const r = validateKarinReport(
      report({
        id: 'r-1',
        eventOccurredAt: '2026-01-01T00:00:00Z',
        reportedAt: '2026-05-01T00:00:00Z',
        anonymous: true,
      }),
    );
    expect(r.valid).toBe(true);
    expect(r.warnings).toContain('reporting_deadline_passed_anonymous');
  });
});

const baseRules = {
  reporterTeamId: 'team-A',
  reporterReportingChainUids: ['mgr-1', 'mgr-2'],
  now: '2026-05-10T00:00:00Z',
};

function cand(over: Partial<InvestigatorCandidate> & { uid: string }): InvestigatorCandidate {
  return {
    uid: over.uid,
    teamId: over.teamId ?? 'team-B',
    reportingChainUids: over.reportingChainUids ?? [],
    gender: over.gender,
    organizationallyIndependent: over.organizationallyIndependent ?? true,
  };
}

describe('assignInvestigator', () => {
  it('rejects same-team candidates and assigns the next valid one', () => {
    const r = assignInvestigator(
      report({ id: 'r-1' }),
      [cand({ uid: 'c-1', teamId: 'team-A' }), cand({ uid: 'c-2', teamId: 'team-B' })],
      baseRules,
    );
    expect(r.assignedUid).toBe('c-2');
    expect(r.rejected[0]).toEqual({ uid: 'c-1', reason: 'same_team_as_reporter' });
  });

  it('rejects candidates in reporter reporting chain', () => {
    const r = assignInvestigator(
      report({ id: 'r-1' }),
      [cand({ uid: 'mgr-1' }), cand({ uid: 'c-2' })],
      baseRules,
    );
    expect(r.assignedUid).toBe('c-2');
    expect(r.rejected[0].reason).toBe('in_reporter_reporting_chain');
  });

  it('rejects non-independent candidates', () => {
    const r = assignInvestigator(
      report({ id: 'r-1' }),
      [
        cand({ uid: 'c-1', organizationallyIndependent: false }),
        cand({ uid: 'c-2' }),
      ],
      baseRules,
    );
    expect(r.assignedUid).toBe('c-2');
  });

  it('enforces same-gender for sexual harassment when requested', () => {
    const r = assignInvestigator(
      report({
        id: 'r-1',
        kind: 'sexual',
        reporterGender: 'female',
        preferSameGenderInvestigator: true,
      }),
      [
        cand({ uid: 'c-male', gender: 'male' }),
        cand({ uid: 'c-female', gender: 'female' }),
      ],
      baseRules,
    );
    expect(r.assignedUid).toBe('c-female');
    expect(r.rejected[0].reason).toBe('gender_mismatch_sexual_harassment');
  });

  it('returns null when no candidate satisfies rules', () => {
    const r = assignInvestigator(
      report({ id: 'r-1' }),
      [cand({ uid: 'c-1', teamId: 'team-A' })],
      baseRules,
    );
    expect(r.assignedUid).toBeNull();
  });
});

describe('detectRetaliationPatterns', () => {
  it('flags negative events within 90 days post-report', () => {
    const ev: PostReportEvent[] = [
      { kind: 'salary_change', direction: 'negative', occurredAt: '2026-05-15T00:00:00Z' },
      { kind: 'shift_change_negative', direction: 'negative', occurredAt: '2026-06-01T00:00:00Z' },
    ];
    const flags = detectRetaliationPatterns(
      report({ id: 'r-1', reportedAt: '2026-05-10T00:00:00Z' }),
      ev,
    );
    expect(flags).toHaveLength(2);
    expect(flags[0].kind).toBe('salary_change');
  });

  it('ignores positive/neutral events', () => {
    const flags = detectRetaliationPatterns(report({ id: 'r-1' }), [
      { kind: 'salary_change', direction: 'positive', occurredAt: '2026-05-15T00:00:00Z' },
    ]);
    expect(flags).toEqual([]);
  });

  it('ignores events outside the 90-day window', () => {
    const flags = detectRetaliationPatterns(
      report({ id: 'r-1', reportedAt: '2026-01-01T00:00:00Z' }),
      [{ kind: 'role_demoted', direction: 'negative', occurredAt: '2026-05-01T00:00:00Z' }],
    );
    expect(flags).toEqual([]);
  });

  it('ignores events before the report date', () => {
    const flags = detectRetaliationPatterns(
      report({ id: 'r-1', reportedAt: '2026-05-10T00:00:00Z' }),
      [{ kind: 'isolation', direction: 'negative', occurredAt: '2026-05-01T00:00:00Z' }],
    );
    expect(flags).toEqual([]);
  });
});
