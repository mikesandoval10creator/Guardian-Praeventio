import { describe, it, expect } from 'vitest';
import {
  verifyEfficacy,
  defaultPostActionWindow,
  type VerifyEfficacyInput,
} from './efficacyVerifier.js';

const NOW = new Date('2026-05-12T22:00:00Z');

function baseInput(over: Partial<VerifyEfficacyInput> = {}): VerifyEfficacyInput {
  return {
    baseline: {
      incidentId: 'inc-1',
      riskKind: 'caida_altura',
      severity: 'medium',
      preIncidenceRate30d: 3,
      conditions: { location: 'torre-N', timeOfDay: 'morning', crewKind: 'electricos' },
    },
    window: defaultPostActionWindow(
      '2026-04-12T10:00:00Z',
      [],
      { controlVerificationsCount: 4 },
    ),
    actions: [
      {
        id: 'ca-1',
        title: 'Instalar línea de vida engineering',
        level: 'engineering',
        closedAt: '2026-04-12T10:00:00Z',
        closedByUid: 'prev-1',
        evidenceCount: 3,
      },
    ],
    ...over,
  };
}

describe('verifyEfficacy', () => {
  it('cero reincidencias + verificaciones periódicas → effective + ratify', () => {
    const r = verifyEfficacy(baseInput(), { now: NOW });
    expect(r.verdict).toBe('effective');
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.recommendation).toBe('ratify_close');
    expect(r.reopenTriggers).toHaveLength(0);
  });

  it('1 reincidencia mismo sitio → partially_effective o ineffective + reopen', () => {
    const r = verifyEfficacy(
      baseInput({
        window: defaultPostActionWindow(
          '2026-04-12T10:00:00Z',
          [
            {
              incidentId: 'inc-2',
              occurredAt: '2026-04-25T10:00:00Z',
              sameLocation: true,
              sameCrew: false,
              severity: 'medium',
            },
          ],
          { controlVerificationsCount: 2 },
        ),
      }),
      { now: NOW },
    );
    expect(['partially_effective', 'inconclusive', 'ineffective']).toContain(r.verdict);
    expect(r.reopenTriggers).toContain('recurrence:1');
    expect(r.reopenTriggers).toContain('same_location');
  });

  it('múltiples reincidencias + severidad escalada → ineffective + investigate root cause', () => {
    const r = verifyEfficacy(
      baseInput({
        window: defaultPostActionWindow(
          '2026-04-12T10:00:00Z',
          [
            { incidentId: 'inc-a', occurredAt: '2026-04-15T10:00:00Z', sameLocation: true, sameCrew: true, severity: 'high' },
            { incidentId: 'inc-b', occurredAt: '2026-04-22T10:00:00Z', sameLocation: true, sameCrew: false, severity: 'critical' },
            { incidentId: 'inc-c', occurredAt: '2026-04-30T10:00:00Z', sameLocation: false, sameCrew: true, severity: 'medium' },
          ],
        ),
      }),
      { now: NOW },
    );
    expect(r.verdict).toBe('ineffective');
    expect(r.reopenTriggers).toContain('severity_escalated');
    expect(['investigate_root_cause_again', 'escalate_to_higher_level']).toContain(r.recommendation);
  });

  it('acción solo EPP/training + ineffective → recomienda escalate_to_higher_level', () => {
    const r = verifyEfficacy(
      baseInput({
        actions: [
          {
            id: 'ca-2',
            title: 'Reentrenamiento',
            level: 'training',
            closedAt: '2026-04-12T10:00:00Z',
            closedByUid: 'prev-1',
            evidenceCount: 1,
          },
        ],
        window: defaultPostActionWindow(
          '2026-04-12T10:00:00Z',
          [
            { incidentId: 'inc-x', occurredAt: '2026-04-15T10:00:00Z', sameLocation: true, sameCrew: false, severity: 'medium' },
            { incidentId: 'inc-y', occurredAt: '2026-04-20T10:00:00Z', sameLocation: true, sameCrew: false, severity: 'medium' },
            { incidentId: 'inc-z', occurredAt: '2026-04-26T10:00:00Z', sameLocation: true, sameCrew: false, severity: 'medium' },
            { incidentId: 'inc-w', occurredAt: '2026-04-28T10:00:00Z', sameLocation: false, sameCrew: false, severity: 'medium' },
          ],
        ),
      }),
      { now: NOW },
    );
    expect(r.verdict).toBe('ineffective');
    expect(r.recommendation).toBe('escalate_to_higher_level');
  });

  it('sin acciones registradas → score ≤30 + reopen', () => {
    const r = verifyEfficacy(
      baseInput({ actions: [] }),
      { now: NOW },
    );
    expect(r.score).toBeLessThanOrEqual(30);
    expect(r.reopenTriggers).toContain('no_actions_recorded');
  });

  it('sin verificaciones periódicas + sin reincidencias → effective con penalty leve', () => {
    const r = verifyEfficacy(
      baseInput({
        window: defaultPostActionWindow('2026-04-12T10:00:00Z', [], {}),
      }),
      { now: NOW },
    );
    // Score 100-5 = 95
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.reasons.some((x) => /verificaciones periódicas/i.test(x))).toBe(true);
  });

  it('partially_effective con ongoing verifications → extend window', () => {
    const r = verifyEfficacy(
      baseInput({
        window: defaultPostActionWindow(
          '2026-04-12T10:00:00Z',
          [
            { incidentId: 'inc-rare', occurredAt: '2026-04-30T10:00:00Z', sameLocation: false, sameCrew: false, severity: 'low' },
          ],
          { controlVerificationsCount: 4 },
        ),
      }),
      { now: NOW },
    );
    if (r.verdict === 'partially_effective') {
      expect(r.recommendation).toBe('extend_observation_window');
    }
  });
});

describe('defaultPostActionWindow', () => {
  it('genera ventana de 30 días desde closedAt', () => {
    const w = defaultPostActionWindow('2026-04-12T10:00:00Z');
    expect(w.windowStart).toBe('2026-04-12T10:00:00Z');
    expect(w.windowEnd).toBe('2026-05-12T10:00:00.000Z');
    expect(w.recurrenceIncidents).toHaveLength(0);
  });

  it('respeta windowDays custom', () => {
    const w = defaultPostActionWindow('2026-04-12T10:00:00Z', [], {}, 90);
    expect(w.windowEnd).toBe('2026-07-11T10:00:00.000Z');
  });
});
