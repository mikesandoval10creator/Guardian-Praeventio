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

/* -------------------------------------------------------------------------- */
/* Time-based normative rules                                                 */
/* -------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;
// Anchor "now" for deterministic time-based tests.
const NOW = new Date('2026-04-28T12:00:00Z');

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS);
}

describe('evaluateNormativeAlerts — CPHS monthly meeting (DS 54 art. 24)', () => {
  it('7. CPHS — last meeting 20 days ago → no alert', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 30 }],
      {
        lastCphsMeetingByProject: { p1: daysAgo(20) },
        now: NOW,
      },
    );
    expect(alerts.filter((a) => a.rule === 'cphs-monthly-meeting-due')).toEqual([]);
  });

  it('8. CPHS — last meeting 26 days ago → warning, daysUntilDue 4', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 30 }],
      {
        lastCphsMeetingByProject: { p1: daysAgo(26) },
        now: NOW,
      },
    );
    const cphs = alerts.filter((a) => a.rule === 'cphs-monthly-meeting-due');
    expect(cphs).toHaveLength(1);
    expect(cphs[0].severity).toBe('warning');
    expect(cphs[0].projectId).toBe('p1');
    expect(cphs[0].daysUntilDue).toBe(4);
  });

  it('9. CPHS — last meeting 35 days ago → critical, daysUntilDue ≤ 0', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 30 }],
      {
        lastCphsMeetingByProject: { p1: daysAgo(35) },
        now: NOW,
      },
    );
    const cphs = alerts.filter((a) => a.rule === 'cphs-monthly-meeting-due');
    expect(cphs).toHaveLength(1);
    expect(cphs[0].severity).toBe('critical');
    expect(cphs[0].daysUntilDue).toBeLessThanOrEqual(0);
  });

  it('10. CPHS — never met AND project ≥25 workers → critical with "constituye comité" message', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 30 }],
      {
        // No entry for p1 in lastCphsMeetingByProject.
        lastCphsMeetingByProject: {},
        now: NOW,
      },
    );
    const cphs = alerts.filter((a) => a.rule === 'cphs-monthly-meeting-due');
    expect(cphs).toHaveLength(1);
    expect(cphs[0].severity).toBe('critical');
    expect(cphs[0].message.toLowerCase()).toContain('constituye');
    expect(cphs[0].message.toLowerCase()).toContain('comité');
  });

  it('11. CPHS — never met AND project < 25 workers → no alert (no obligation)', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 10 }],
      {
        lastCphsMeetingByProject: {},
        now: NOW,
      },
    );
    expect(alerts.filter((a) => a.rule === 'cphs-monthly-meeting-due')).toEqual([]);
  });
});

describe('evaluateNormativeAlerts — ODI semestral (Ley 16.744 art. 21)', () => {
  it('12. ODI — 100 days since last → no alert', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 10 }],
      {
        lastOdiByProject: { p1: daysAgo(100) },
        now: NOW,
      },
    );
    expect(alerts.filter((a) => a.rule === 'odi-semestral-due')).toEqual([]);
  });

  it('13. ODI — 160 days since last → warning', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 10 }],
      {
        lastOdiByProject: { p1: daysAgo(160) },
        now: NOW,
      },
    );
    const odi = alerts.filter((a) => a.rule === 'odi-semestral-due');
    expect(odi).toHaveLength(1);
    expect(odi[0].severity).toBe('warning');
    expect(odi[0].projectId).toBe('p1');
  });

  it('14. ODI — 200 days since last → critical', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 10 }],
      {
        lastOdiByProject: { p1: daysAgo(200) },
        now: NOW,
      },
    );
    const odi = alerts.filter((a) => a.rule === 'odi-semestral-due');
    expect(odi).toHaveLength(1);
    expect(odi[0].severity).toBe('critical');
    expect(odi[0].daysUntilDue).toBeLessThanOrEqual(0);
  });

  it('15. ODI — never trained → critical for any project size', () => {
    const alertsSmall = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 5 }],
      {
        lastOdiByProject: {},
        now: NOW,
      },
    );
    const alertsLarge = evaluateNormativeAlerts(
      [{ id: 'p2', workerCount: 200 }],
      {
        lastOdiByProject: {},
        now: NOW,
      },
    );
    const small = alertsSmall.filter((a) => a.rule === 'odi-semestral-due');
    const large = alertsLarge.filter((a) => a.rule === 'odi-semestral-due');
    expect(small).toHaveLength(1);
    expect(small[0].severity).toBe('critical');
    expect(large).toHaveLength(1);
    expect(large[0].severity).toBe('critical');
  });
});

describe('evaluateNormativeAlerts — Audiometría PREXOR', () => {
  it('16. Audiometría — last 6 months ago, dose 50% → no alert (annual cadence)', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 10 }],
      {
        lastAudiometriaByWorker: { w1: daysAgo(180) },
        prexorDoseByWorker: { w1: 50 },
        now: NOW,
      },
    );
    expect(alerts.filter((a) => a.rule === 'audiometria-prexor-due')).toEqual([]);
  });

  it('17. Audiometría — last 11 months ago, dose 50% → warning (annual, ~92% of cadence)', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 10 }],
      {
        lastAudiometriaByWorker: { w1: daysAgo(335) },
        prexorDoseByWorker: { w1: 50 },
        now: NOW,
      },
    );
    const a = alerts.filter((x) => x.rule === 'audiometria-prexor-due');
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe('warning');
  });

  it('18. Audiometría — last 13 months ago, dose 50% → critical', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 10 }],
      {
        lastAudiometriaByWorker: { w1: daysAgo(395) },
        prexorDoseByWorker: { w1: 50 },
        now: NOW,
      },
    );
    const a = alerts.filter((x) => x.rule === 'audiometria-prexor-due');
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe('critical');
    expect(a[0].daysUntilDue).toBeLessThanOrEqual(0);
  });

  it('19. Audiometría — last 5 months ago, dose 150% → warning (accelerated 6mo cadence triggered)', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 10 }],
      {
        lastAudiometriaByWorker: { w1: daysAgo(150) },
        prexorDoseByWorker: { w1: 150 },
        now: NOW,
      },
    );
    const a = alerts.filter((x) => x.rule === 'audiometria-prexor-due');
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe('warning');
  });

  it('20. Audiometría — last 7 months ago, dose 150% → critical', () => {
    const alerts = evaluateNormativeAlerts(
      [{ id: 'p1', workerCount: 10 }],
      {
        lastAudiometriaByWorker: { w1: daysAgo(210) },
        prexorDoseByWorker: { w1: 150 },
        now: NOW,
      },
    );
    const a = alerts.filter((x) => x.rule === 'audiometria-prexor-due');
    expect(a).toHaveLength(1);
    expect(a[0].severity).toBe('critical');
  });
});

describe('evaluateNormativeAlerts — determinism + backwards compat', () => {
  it('21. determinism: same input + same `now` → same output', () => {
    const ctx = {
      lastCphsMeetingByProject: { p1: daysAgo(26) },
      lastOdiByProject: { p1: daysAgo(160) },
      lastAudiometriaByWorker: { w1: daysAgo(395) },
      prexorDoseByWorker: { w1: 50 },
      now: NOW,
    };
    const projects = [{ id: 'p1', workerCount: 30 }];
    const a1 = evaluateNormativeAlerts(projects, ctx);
    const a2 = evaluateNormativeAlerts(projects, ctx);
    expect(a2).toEqual(a1);
  });

  it('22. backwards-compat: existing project-size tests still pass when `context` is undefined', () => {
    // Mirrors test #5 above; this asserts the new optional parameter
    // does not break the legacy single-arg call shape.
    const alerts = evaluateNormativeAlerts([{ id: 'p1', workerCount: 100 }]);
    const rules = alerts.map((a) => a.rule).sort();
    expect(rules).toEqual(
      ['comite-paritario-required', 'departamento-prevencion-required'].sort(),
    );
  });
});
