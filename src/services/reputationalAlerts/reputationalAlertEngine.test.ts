import { describe, it, expect } from 'vitest';
import {
  analyzeReputationalRisk,
  summarizeReputationalRisk,
  type ExternalSignal,
} from './reputationalAlertEngine.js';

function sig(over: Partial<ExternalSignal> = {}): ExternalSignal {
  return {
    source: 'news',
    keyword: 'accidente faena',
    publishedAt: '2026-05-01T10:00:00Z',
    sentiment: 'negative',
    reach: 'local',
    ...over,
  };
}

describe('analyzeReputationalRisk', () => {
  it('lista vacía si no hay señales', () => {
    expect(analyzeReputationalRisk([])).toEqual([]);
  });

  it('una señal negativa local → info + monitor', () => {
    const alerts = analyzeReputationalRisk([sig()]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('info');
    expect(alerts[0].recommendation).toBe('monitor');
  });

  it('clusteriza señales con keyword similar dentro de la ventana', () => {
    const alerts = analyzeReputationalRisk([
      sig({ keyword: 'accidente faena norte' }),
      sig({
        keyword: 'accidente en faena',
        publishedAt: '2026-05-03T10:00:00Z',
      }),
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].signals).toHaveLength(2);
  });

  it('no clusteriza señales fuera de la ventana de 7 días', () => {
    const alerts = analyzeReputationalRisk([
      sig({ publishedAt: '2026-05-01T00:00:00Z' }),
      sig({ publishedAt: '2026-05-20T00:00:00Z' }),
    ]);
    expect(alerts).toHaveLength(2);
  });

  it('no clusteriza keywords distintas aunque estén en ventana', () => {
    const alerts = analyzeReputationalRisk([
      sig({ keyword: 'derrame químico' }),
      sig({ keyword: 'multa SUSESO', publishedAt: '2026-05-02T00:00:00Z' }),
    ]);
    expect(alerts).toHaveLength(2);
  });

  it('3+ señales negativas nacionales → critical + escalate_pr_team', () => {
    const alerts = analyzeReputationalRisk([
      sig({ reach: 'national', publishedAt: '2026-05-01T00:00:00Z' }),
      sig({ reach: 'national', publishedAt: '2026-05-02T00:00:00Z' }),
      sig({ reach: 'national', publishedAt: '2026-05-03T00:00:00Z' }),
    ]);
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].recommendation).toBe('escalate_pr_team');
  });

  it('international + fatality → emergency_pr + pr_emergency_response', () => {
    const alerts = analyzeReputationalRisk([
      sig({
        reach: 'international',
        flags: { fatality: true },
      }),
    ]);
    expect(alerts[0].severity).toBe('emergency_pr');
    expect(alerts[0].recommendation).toBe('pr_emergency_response');
  });

  it('fatality sin international → critical', () => {
    const alerts = analyzeReputationalRisk([
      sig({ reach: 'regional', flags: { fatality: true } }),
    ]);
    expect(alerts[0].severity).toBe('critical');
  });

  it('regulator action sin fatality → warning', () => {
    const alerts = analyzeReputationalRisk([
      sig({ reach: 'local', flags: { regulatorAction: true } }),
    ]);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].recommendation).toBe('prepare_statement');
  });

  it('reachScore base 10 para local single negative', () => {
    const alerts = analyzeReputationalRisk([sig({ reach: 'local' })]);
    // base=10, vol bonus=4, neg bonus=2 → 16
    expect(alerts[0].reachScore).toBe(16);
  });

  it('reachScore alcanza 100 con international + fatality + volumen', () => {
    const alerts = analyzeReputationalRisk([
      sig({ reach: 'international', flags: { fatality: true }, publishedAt: '2026-05-01T00:00:00Z' }),
      sig({ reach: 'international', publishedAt: '2026-05-02T00:00:00Z' }),
      sig({ reach: 'international', publishedAt: '2026-05-03T00:00:00Z' }),
    ]);
    expect(alerts[0].reachScore).toBe(100);
  });

  it('id estable basado en cluster key normalizado', () => {
    const alerts = analyzeReputationalRisk([sig({ keyword: 'Derrame Químico!' })]);
    expect(alerts[0].id).toContain('derrame_quimico');
    expect(alerts[0].clusterKey).toBe('derrame quimico');
  });

  it('windowFrom/To reflejan primer y último publishedAt del cluster', () => {
    const alerts = analyzeReputationalRisk([
      sig({ publishedAt: '2026-05-01T00:00:00Z' }),
      sig({ publishedAt: '2026-05-04T00:00:00Z' }),
      sig({ publishedAt: '2026-05-02T00:00:00Z' }),
    ]);
    expect(alerts[0].windowFrom).toBe('2026-05-01T00:00:00Z');
    expect(alerts[0].windowTo).toBe('2026-05-04T00:00:00Z');
  });

  it('rationale incluye severidad y conteos', () => {
    const alerts = analyzeReputationalRisk([
      sig({ reach: 'regional' }),
      sig({ reach: 'regional', publishedAt: '2026-05-02T00:00:00Z' }),
    ]);
    expect(alerts[0].rationale).toContain('2 señal');
    expect(alerts[0].rationale).toContain('regional');
    expect(alerts[0].rationale).toContain('warning');
  });

  it('ventana custom permite agrupar señales más distantes', () => {
    const alerts = analyzeReputationalRisk(
      [
        sig({ publishedAt: '2026-05-01T00:00:00Z' }),
        sig({ publishedAt: '2026-05-15T00:00:00Z' }),
      ],
      { windowDays: 30 },
    );
    expect(alerts).toHaveLength(1);
  });

  it('señal positiva no sube severidad', () => {
    const alerts = analyzeReputationalRisk([
      sig({ sentiment: 'positive', reach: 'national' }),
    ]);
    expect(alerts[0].severity).toBe('info');
  });
});

describe('summarizeReputationalRisk', () => {
  it('reporta highestSeverity correcta', () => {
    const out = summarizeReputationalRisk([
      sig({ keyword: 'queja local', reach: 'local' }),
      sig({
        keyword: 'fatalidad faena',
        reach: 'international',
        flags: { fatality: true },
        publishedAt: '2026-05-02T00:00:00Z',
      }),
    ]);
    expect(out.highestSeverity).toBe('emergency_pr');
    expect(out.topRecommendation).toBe('pr_emergency_response');
    expect(out.totalSignals).toBe(2);
  });

  it('highestSeverity info si todas son info', () => {
    const out = summarizeReputationalRisk([sig()]);
    expect(out.highestSeverity).toBe('info');
    expect(out.topRecommendation).toBe('monitor');
  });

  it('lista vacía → info por defecto', () => {
    const out = summarizeReputationalRisk([]);
    expect(out.alerts).toEqual([]);
    expect(out.highestSeverity).toBe('info');
    expect(out.totalSignals).toBe(0);
  });
});
