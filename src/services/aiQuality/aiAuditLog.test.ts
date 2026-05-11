import { describe, it, expect } from 'vitest';
import {
  logAiResponse,
  assertHumanGatedAction,
  recordHumanDecision,
  recordOverride,
  rateEntry,
  summarizeAiQuality,
  BlacklistedAiActionError,
  BLACKLISTED_AI_ACTIONS,
  type LogAiResponseInput,
} from './aiAuditLog.js';

const NOW = new Date('2026-05-11T12:00:00Z');

function baseInput(over: Partial<LogAiResponseInput> = {}): LogAiResponseInput {
  return {
    id: 'ai-1',
    source: 'gemini',
    kind: 'risk_assessment',
    prompt: '¿Qué EPP necesita un soldador en altura?',
    response: 'Casco, careta facial, arnés, guantes ignífugos',
    contextDigest: 'sha256:abc123',
    recipientUid: 'sup-1',
    recipientRole: 'supervisor',
    now: NOW,
    ...over,
  };
}

describe('logAiResponse', () => {
  it('genera entry con timestamp + suggestion flag', () => {
    const e = logAiResponse(baseInput());
    expect(e.timestamp).toBe(NOW.toISOString());
    expect(e.presentedAsSuggestion).toBe(true);
    expect(e.humanDecision).toBeUndefined();
  });
});

describe('BLACKLISTED_AI_ACTIONS', () => {
  it('incluye work_approval, medical_triage, emergency_response', () => {
    expect(BLACKLISTED_AI_ACTIONS).toContain('work_approval');
    expect(BLACKLISTED_AI_ACTIONS).toContain('medical_triage');
    expect(BLACKLISTED_AI_ACTIONS).toContain('emergency_response');
  });
});

describe('assertHumanGatedAction', () => {
  it('rechaza work_approval sin humanDecision', () => {
    expect(() => assertHumanGatedAction('work_approval')).toThrow(BlacklistedAiActionError);
  });

  it('rechaza work_approval con humanDecision.followed=false', () => {
    expect(() =>
      assertHumanGatedAction('work_approval', {
        followed: false,
        decidedAt: NOW.toISOString(),
      }),
    ).toThrow(BlacklistedAiActionError);
  });

  it('permite work_approval con humanDecision.followed=true', () => {
    expect(() =>
      assertHumanGatedAction('work_approval', {
        followed: true,
        decidedAt: NOW.toISOString(),
      }),
    ).not.toThrow();
  });

  it('permite risk_assessment sin humanDecision (no blacklisted)', () => {
    expect(() => assertHumanGatedAction('risk_assessment')).not.toThrow();
  });
});

describe('recordOverride', () => {
  it('registra override con razón ≥10 chars', () => {
    const e = logAiResponse(baseInput());
    const after = recordOverride(
      e,
      'Operario tiene experiencia previa documentada en obra similar',
      NOW,
    );
    expect(after.humanDecision?.followed).toBe(false);
    expect(after.humanDecision?.overrideReason).toContain('experiencia');
  });

  it('rechaza razón < 10 chars', () => {
    const e = logAiResponse(baseInput());
    expect(() => recordOverride(e, 'no quiero', NOW)).toThrow();
  });
});

describe('recordHumanDecision', () => {
  it('marca followed=true', () => {
    const e = logAiResponse(baseInput());
    const after = recordHumanDecision(e, {
      followed: true,
      decidedAt: NOW.toISOString(),
      actionAuditId: 'audit-9',
    });
    expect(after.humanDecision?.followed).toBe(true);
    expect(after.humanDecision?.actionAuditId).toBe('audit-9');
  });
});

describe('rateEntry', () => {
  it('agrega rating por curador', () => {
    const e = logAiResponse(baseInput());
    const rated = rateEntry(e, {
      verdict: 'useful',
      reviewerUid: 'curator-1',
      reviewedAt: NOW.toISOString(),
      reviewerNote: 'EPP correctos según DS 594',
    });
    expect(rated.rating?.verdict).toBe('useful');
  });
});

describe('summarizeAiQuality', () => {
  it('cuenta total, decisión humana, override rate', () => {
    const e1 = logAiResponse(baseInput({ id: 'a' }));
    const e2 = recordHumanDecision(logAiResponse(baseInput({ id: 'b' })), {
      followed: true,
      decidedAt: NOW.toISOString(),
    });
    const e3 = recordOverride(logAiResponse(baseInput({ id: 'c' })), 'el operario insistió por experiencia', NOW);

    const summary = summarizeAiQuality([e1, e2, e3]);
    expect(summary.totalLogged).toBe(3);
    expect(summary.withHumanDecision).toBe(2);
    expect(summary.withOverride).toBe(1);
    expect(summary.overrideRate).toBe(50); // 1 override / 2 decisiones
  });

  it('cuenta bySource + byKind correctamente', () => {
    const entries = [
      logAiResponse(baseInput({ id: '1', source: 'gemini', kind: 'risk_assessment' })),
      logAiResponse(baseInput({ id: '2', source: 'gemini', kind: 'epp_suggestion' })),
      logAiResponse(baseInput({ id: '3', source: 'slm_offline_phi3', kind: 'risk_assessment' })),
    ];
    const summary = summarizeAiQuality(entries);
    expect(summary.bySource.gemini).toBe(2);
    expect(summary.bySource.slm_offline_phi3).toBe(1);
    expect(summary.byKind.risk_assessment).toBe(2);
  });

  it('cuenta ratings', () => {
    const e1 = rateEntry(logAiResponse(baseInput({ id: 'a' })), {
      verdict: 'useful',
      reviewerUid: 'c',
      reviewedAt: NOW.toISOString(),
    });
    const e2 = rateEntry(logAiResponse(baseInput({ id: 'b' })), {
      verdict: 'incorrect',
      reviewerUid: 'c',
      reviewedAt: NOW.toISOString(),
    });
    const summary = summarizeAiQuality([e1, e2]);
    expect(summary.ratingCounts.useful).toBe(1);
    expect(summary.ratingCounts.incorrect).toBe(1);
  });

  it('overrideRate = 0 sin decisiones humanas registradas', () => {
    const summary = summarizeAiQuality([logAiResponse(baseInput())]);
    expect(summary.overrideRate).toBe(0);
  });
});
