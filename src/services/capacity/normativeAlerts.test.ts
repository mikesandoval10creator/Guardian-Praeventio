import { describe, it, expect } from 'vitest';
import { evaluateNormativeAlerts } from './normativeAlerts';

describe('evaluateNormativeAlerts — project-size rules', () => {
  it('1. project under 25 workers → no alerts', () => {
    const alerts = evaluateNormativeAlerts([{ id: 'p1', workerCount: 24 }]);
    expect(alerts).toEqual([]);
  });

  it('2. project at exactly 25 workers → comite-paritario-required (critical)', () => {
    const alerts = evaluateNormativeAlerts([{ id: 'p1', workerCount: 25 }]);
    const cp = alerts.filter((a) => a.rule === 'comite-paritario-required');
    expect(cp).toHaveLength(1);
    expect(cp[0].projectId).toBe('p1');
    expect(cp[0].severity).toBe('critical');
    expect(cp[0].message.length).toBeGreaterThan(0);
  });

  it('3. multiple projects each under 25 → no alerts (per-project, not aggregate)', () => {
    const alerts = evaluateNormativeAlerts([
      { id: 'p1', workerCount: 24 },
      { id: 'p2', workerCount: 24 },
    ]);
    expect(alerts).toEqual([]);
  });

  it('4. project at 99 workers → comite-paritario-required only', () => {
    const alerts = evaluateNormativeAlerts([{ id: 'p1', workerCount: 99 }]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].rule).toBe('comite-paritario-required');
    expect(alerts[0].projectId).toBe('p1');
  });

  it('5. project at 100 workers → both comite-paritario AND departamento-prevencion', () => {
    const alerts = evaluateNormativeAlerts([{ id: 'p1', workerCount: 100 }]);
    const rules = alerts.map((a) => a.rule).sort();
    expect(rules).toEqual(
      ['comite-paritario-required', 'departamento-prevencion-required'].sort(),
    );
    expect(alerts.every((a) => a.projectId === 'p1')).toBe(true);
    expect(alerts.every((a) => a.severity === 'critical')).toBe(true);
  });

  it('6. mixed: p1=30 (CP only), p2=120 (CP + DP)', () => {
    const alerts = evaluateNormativeAlerts([
      { id: 'p1', workerCount: 30 },
      { id: 'p2', workerCount: 120 },
    ]);
    expect(alerts).toHaveLength(3);
    const p1 = alerts.filter((a) => a.projectId === 'p1');
    const p2 = alerts.filter((a) => a.projectId === 'p2');
    expect(p1.map((a) => a.rule)).toEqual(['comite-paritario-required']);
    expect(p2.map((a) => a.rule).sort()).toEqual(
      ['comite-paritario-required', 'departamento-prevencion-required'].sort(),
    );
  });

  it('messages are written in Spanish and reference the project id', () => {
    const alerts = evaluateNormativeAlerts([{ id: 'obra-norte', workerCount: 100 }]);
    for (const a of alerts) {
      expect(a.message).toMatch(/[áéíóúñ]|Comit|Departamento|Ley/i);
      expect(a.message).toContain('obra-norte');
    }
  });
});
