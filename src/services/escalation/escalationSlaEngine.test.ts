import { describe, it, expect } from 'vitest';
import {
  assessSla,
  decideEscalation,
  applyEscalation,
  processBatchEscalations,
  getSlaMinutes,
  type WorkflowItem,
  type EscalationChain,
} from './escalationSlaEngine.js';

const NOW = new Date('2026-05-13T12:00:00Z');

const CHAIN: EscalationChain = {
  level1: { primary: 'sup-1', fallback: 'sup-2', label: 'Supervisor' },
  level2: { primary: 'jefe-1', fallback: 'jefe-2', label: 'Jefe Faena' },
  level3: { primary: 'prev-1', fallback: 'prev-2', label: 'Prevencionista' },
  level4: { primary: 'gerente-1', label: 'Gerente Operaciones' },
  level5: { primary: 'cphs-1', label: 'CPHS' },
};

function makeItem(over: Partial<WorkflowItem> = {}): WorkflowItem {
  return {
    id: 'inc-1',
    kind: 'incident',
    severity: 'medium',
    status: 'open',
    createdAt: '2026-05-13T11:00:00Z',
    assignedToUid: 'sup-1',
    currentLevel: 1,
    ...over,
  };
}

describe('getSlaMinutes', () => {
  it('SOS critical = 1 min', () => {
    expect(getSlaMinutes('sos_alert', 'critical')).toBe(1);
  });

  it('SIF incident = 60 min', () => {
    expect(getSlaMinutes('incident', 'sif')).toBe(60);
  });

  it('low corrective_action = 30 días', () => {
    expect(getSlaMinutes('corrective_action', 'low')).toBe(60 * 24 * 30);
  });
});

describe('assessSla', () => {
  it('item fresco (1h, SLA medium incident 3 días) → within_sla', () => {
    const sla = assessSla(makeItem(), NOW);
    expect(sla.state).toBe('within_sla');
    expect(sla.consumedFraction).toBeLessThan(0.1);
  });

  it('80% del SLA consumido → near_breach', () => {
    // medium incident SLA = 4320 min (3 días). 80% = 3456 min ≈ 57.6h
    const item = makeItem({ createdAt: new Date(NOW.getTime() - 3500 * 60_000).toISOString() });
    const sla = assessSla(item, NOW);
    expect(sla.state).toBe('near_breach');
  });

  it('120% del SLA consumido → breached', () => {
    const item = makeItem({ createdAt: new Date(NOW.getTime() - 5000 * 60_000).toISOString() });
    const sla = assessSla(item, NOW);
    expect(sla.state).toBe('breached');
  });

  it('300%+ del SLA → permanently_overdue', () => {
    const item = makeItem({ createdAt: new Date(NOW.getTime() - 15000 * 60_000).toISOString() });
    const sla = assessSla(item, NOW);
    expect(sla.state).toBe('permanently_overdue');
  });

  it('minutesUntilBreach negativo cuando breached', () => {
    const item = makeItem({ createdAt: new Date(NOW.getTime() - 5000 * 60_000).toISOString() });
    const sla = assessSla(item, NOW);
    expect(sla.minutesUntilBreach).toBeLessThan(0);
  });
});

describe('decideEscalation — auto trigger reasons', () => {
  it('within_sla, primary disponible → no escala', () => {
    const d = decideEscalation(makeItem(), CHAIN, NOW);
    expect(d.shouldEscalate).toBe(false);
  });

  it('breached → escala a nivel 2', () => {
    const item = makeItem({ createdAt: new Date(NOW.getTime() - 5000 * 60_000).toISOString() });
    const d = decideEscalation(item, CHAIN, NOW);
    expect(d.shouldEscalate).toBe(true);
    expect(d.toLevel).toBe(2);
    expect(d.toUid).toBe('jefe-1');
    expect(d.reason).toBe('sla_breach');
  });

  it('severityJustIncreased dispara escalation aunque within_sla', () => {
    const d = decideEscalation(makeItem(), CHAIN, NOW, { severityJustIncreased: true });
    expect(d.shouldEscalate).toBe(true);
    expect(d.reason).toBe('severity_increase');
  });

  it('manualEscalation override', () => {
    const d = decideEscalation(makeItem(), CHAIN, NOW, { manualEscalation: true });
    expect(d.shouldEscalate).toBe(true);
    expect(d.reason).toBe('manual_escalation');
  });

  it('assigned uid unavailable → escala con razón recipient_unavailable', () => {
    const d = decideEscalation(makeItem({ assignedToUid: 'sup-1' }), CHAIN, NOW, {
      unavailableUids: new Set(['sup-1']),
    });
    expect(d.shouldEscalate).toBe(true);
    expect(d.reason).toBe('recipient_unavailable');
  });

  it('primary unavailable usa fallback', () => {
    const item = makeItem({
      currentLevel: 1,
      createdAt: new Date(NOW.getTime() - 5000 * 60_000).toISOString(),
    });
    const d = decideEscalation(item, CHAIN, NOW, {
      unavailableUids: new Set(['jefe-1']),
    });
    expect(d.toUid).toBe('jefe-2');
  });
});

describe('decideEscalation — chain exhaustion', () => {
  it('nivel max (5) → no escalation + chainExhausted', () => {
    const item = makeItem({
      currentLevel: 5,
      createdAt: new Date(NOW.getTime() - 50_000 * 60_000).toISOString(),
    });
    const d = decideEscalation(item, CHAIN, NOW);
    expect(d.shouldEscalate).toBe(false);
    expect(d.chainExhausted).toBe(true);
  });

  it('siguiente nivel sin primary ni fallback → no escalation', () => {
    const noFallbackChain: EscalationChain = {
      ...CHAIN,
      level2: { primary: 'jefe-1', label: 'Jefe' }, // sin fallback
    };
    const d = decideEscalation(makeItem({ createdAt: new Date(NOW.getTime() - 5000 * 60_000).toISOString() }), noFallbackChain, NOW, {
      unavailableUids: new Set(['jefe-1']),
    });
    expect(d.shouldEscalate).toBe(false);
  });

  it('closed item nunca escala', () => {
    const item = makeItem({ status: 'closed' });
    const d = decideEscalation(item, CHAIN, NOW, { manualEscalation: true });
    expect(d.shouldEscalate).toBe(false);
  });

  it('rejected item nunca escala', () => {
    const item = makeItem({ status: 'rejected' });
    const d = decideEscalation(item, CHAIN, NOW, { manualEscalation: true });
    expect(d.shouldEscalate).toBe(false);
  });
});

describe('applyEscalation — audit trail', () => {
  it('crea history entry inmutable', () => {
    const item = makeItem();
    const d = decideEscalation(item, CHAIN, NOW, { manualEscalation: true });
    const updated = applyEscalation(item, d, NOW);
    expect(updated.history).toHaveLength(1);
    expect(updated.history?.[0]?.fromLevel).toBe(1);
    expect(updated.history?.[0]?.toLevel).toBe(2);
    expect(updated.history?.[0]?.fromUid).toBe('sup-1');
    expect(updated.history?.[0]?.toUid).toBe('jefe-1');
    expect(updated.history?.[0]?.reason).toBe('manual_escalation');
  });

  it('preserva history previa', () => {
    const item = makeItem({
      currentLevel: 2,
      history: [
        {
          fromLevel: 1,
          toLevel: 2,
          fromUid: 'sup-1',
          toUid: 'jefe-1',
          at: '2026-05-13T10:00:00Z',
          reason: 'sla_breach',
        },
      ],
    });
    const d = decideEscalation(item, CHAIN, NOW, { manualEscalation: true });
    const updated = applyEscalation(item, d, NOW);
    expect(updated.history).toHaveLength(2);
  });

  it('no muta el item original (inmutable)', () => {
    const item = makeItem();
    const originalHistory = item.history;
    const d = decideEscalation(item, CHAIN, NOW, { manualEscalation: true });
    applyEscalation(item, d, NOW);
    expect(item.history).toBe(originalHistory);
  });

  it('decisión no aplicable → retorna item sin cambios', () => {
    const item = makeItem();
    const noopDecision = { shouldEscalate: false, detail: 'noop', chainExhausted: false };
    const result = applyEscalation(item, noopDecision, NOW);
    expect(result).toBe(item);
  });
});

describe('processBatchEscalations — daily cron', () => {
  it('procesa todos los items y agrega stats', () => {
    const items: WorkflowItem[] = [
      makeItem({ id: 'i1', createdAt: new Date(NOW.getTime() - 5000 * 60_000).toISOString() }),
      makeItem({ id: 'i2' }),
      makeItem({ id: 'i3', createdAt: new Date(NOW.getTime() - 50_000 * 60_000).toISOString() }),
    ];
    const result = processBatchEscalations(items, CHAIN, NOW);
    expect(result.evaluated).toBe(3);
    expect(result.escalated).toBeGreaterThanOrEqual(1);
    expect(result.permanentlyOverdueCount).toBeGreaterThanOrEqual(1);
  });

  it('decisions array tiene entry por cada item', () => {
    const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
    const result = processBatchEscalations(items, CHAIN, NOW);
    expect(result.decisions).toHaveLength(2);
    expect(result.decisions.map((d) => d.itemId).sort()).toEqual(['a', 'b']);
  });
});
