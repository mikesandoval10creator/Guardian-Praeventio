import { describe, it, expect } from 'vitest';
import {
  evaluateGate,
  validateOverride,
  buildOverrideAuditEntry,
  isOverrideStillValid,
  GateOverrideError,
  type RequirementCheck,
  type OverrideInput,
} from './requirementGate.js';

const fakeHash = (s: string): string =>
  's_' + s.length + '_' + s.charCodeAt(0).toString(16);

function check(
  id: string,
  kind: RequirementCheck['requirement']['kind'],
  status: RequirementCheck['status'],
  isMandatory = true,
): RequirementCheck {
  return {
    requirement: {
      id,
      kind,
      label: `req-${id}`,
      isMandatory,
    },
    status,
  };
}

describe('evaluateGate', () => {
  it('pass cuando todos satisfied', () => {
    const d = evaluateGate([
      check('a', 'training', 'satisfied'),
      check('b', 'epp', 'satisfied'),
    ]);
    expect(d.level).toBe('pass');
    expect(d.canOverride).toBe(false);
  });

  it('soft_block cuando hay missing pero no critical', () => {
    const d = evaluateGate([
      check('a', 'training', 'satisfied'),
      check('b', 'epp', 'missing'),
    ]);
    expect(d.level).toBe('soft_block');
    expect(d.canOverride).toBe(true);
    expect(d.unsatisfied).toHaveLength(1);
  });

  it('cannot_override cuando critical_control_verification missing', () => {
    const d = evaluateGate([
      check('a', 'critical_control_verification', 'missing'),
    ]);
    expect(d.level).toBe('cannot_override');
    expect(d.canOverride).toBe(false);
  });

  it('reasoningText incluye lista de requisitos con tag OBLIGATORIO', () => {
    const d = evaluateGate([
      check('a', 'epp', 'expired'),
      check('b', 'training', 'overdue', false),
    ]);
    expect(d.reasoningText).toMatch(/OBLIGATORIO.*req-a.*expired/);
    expect(d.reasoningText).toMatch(/recomendado.*req-b/);
  });
});

describe('validateOverride', () => {
  const gateDecision = evaluateGate([check('a', 'epp', 'missing')]);

  it('rechaza si no canOverride', () => {
    const r = validateOverride({
      decision: { ...gateDecision, canOverride: false },
      override: {
        authorizingUid: 'sup-1',
        reason: 'lorem ipsum reason of more than 20 chars',
        approvedAt: '2026-05-12T10:00:00Z',
      },
    });
    expect(r.valid).toBe(false);
  });

  it('rechaza authorizingUid vacío', () => {
    const r = validateOverride({
      decision: gateDecision,
      override: { authorizingUid: '', reason: 'aaaaaaaaaaaaaaaaaaaaaaa', approvedAt: '2026-05-12T10:00:00Z' },
    });
    expect(r.valid).toBe(false);
  });

  it('rechaza reason corto (<20 chars)', () => {
    const r = validateOverride({
      decision: gateDecision,
      override: { authorizingUid: 'sup-1', reason: 'short', approvedAt: '2026-05-12T10:00:00Z' },
    });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/at least 20/);
  });

  it('rechaza approvedAt malformado', () => {
    const r = validateOverride({
      decision: gateDecision,
      override: { authorizingUid: 'sup-1', reason: 'aaaaaaaaaaaaaaaaaaaaaaa', approvedAt: 'invalid' },
    });
    expect(r.valid).toBe(false);
  });

  it('valida override correcto', () => {
    const r = validateOverride({
      decision: gateDecision,
      override: {
        authorizingUid: 'sup-1',
        reason: 'Trabajador con licencia vencida; renovación 24h.',
        approvedAt: '2026-05-12T10:00:00Z',
      },
    });
    expect(r.valid).toBe(true);
  });
});

describe('buildOverrideAuditEntry', () => {
  const decision = evaluateGate([check('a', 'epp', 'missing'), check('b', 'training', 'expired')]);
  const validOverride: OverrideInput = {
    authorizingUid: 'sup-1',
    reason: 'Lorem ipsum reasonable explanation here.',
    approvedAt: '2026-05-12T10:00:00Z',
    validUntil: '2026-05-13T10:00:00Z',
  };

  it('crea entry con contentHash determinístico', () => {
    const entry = buildOverrideAuditEntry({
      decision,
      override: validOverride,
      gateContext: { actorUid: 'w1', activityId: 'task-99', activityKind: 'altura' },
      hashFn: fakeHash,
    });
    expect(entry.contentHash).toBeTruthy();
    expect(entry.unsatisfiedRequirementIds).toEqual(['a', 'b']);
    expect(entry.authorizingUid).toBe('sup-1');
  });

  it('mismo input → mismo hash (idempotencia)', () => {
    const ctx = { actorUid: 'w1', activityId: 'task-99', activityKind: 'altura' };
    const a = buildOverrideAuditEntry({ decision, override: validOverride, gateContext: ctx, hashFn: fakeHash });
    const b = buildOverrideAuditEntry({ decision, override: validOverride, gateContext: ctx, hashFn: fakeHash });
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.id).toBe(b.id);
  });

  it('lanza error si override inválido', () => {
    expect(() =>
      buildOverrideAuditEntry({
        decision,
        override: { ...validOverride, reason: 'short' },
        gateContext: { actorUid: 'w', activityId: 't', activityKind: 'k' },
        hashFn: fakeHash,
      }),
    ).toThrowError(GateOverrideError);
  });
});

describe('isOverrideStillValid', () => {
  it('válido sin validUntil = true (sin expiración)', () => {
    const entry = {
      id: 'x',
      gateContext: { actorUid: 'a', activityId: 't', activityKind: 'k' },
      unsatisfiedRequirementIds: [],
      authorizingUid: 'sup',
      reason: 'x',
      approvedAt: '2026-01-01T00:00:00Z',
      contentHash: 'h',
    };
    expect(isOverrideStillValid(entry, new Date('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('válido si now < validUntil', () => {
    const entry = {
      id: 'x',
      gateContext: { actorUid: 'a', activityId: 't', activityKind: 'k' },
      unsatisfiedRequirementIds: [],
      authorizingUid: 'sup',
      reason: 'x',
      approvedAt: '2026-01-01T00:00:00Z',
      validUntil: '2026-12-31T23:59:59Z',
      contentHash: 'h',
    };
    expect(isOverrideStillValid(entry, new Date('2026-06-15T00:00:00Z'))).toBe(true);
  });

  it('expirado si now > validUntil', () => {
    const entry = {
      id: 'x',
      gateContext: { actorUid: 'a', activityId: 't', activityKind: 'k' },
      unsatisfiedRequirementIds: [],
      authorizingUid: 'sup',
      reason: 'x',
      approvedAt: '2026-01-01T00:00:00Z',
      validUntil: '2026-01-02T00:00:00Z',
      contentHash: 'h',
    };
    expect(isOverrideStillValid(entry, new Date('2026-06-15T00:00:00Z'))).toBe(false);
  });
});
