import { describe, it, expect } from 'vitest';
import {
  STANDARD_OBLIGATIONS,
  bootstrapCalendar,
  computeCalendar,
  advanceObligation,
  summarizeCalendar,
  type LegalObligation,
} from './legalObligationsCalendar.js';

const NOW = new Date('2026-05-11T12:00:00Z');

describe('STANDARD_OBLIGATIONS', () => {
  it('incluye CPHS mensual, simulacros, mediciones, auditoría ISO', () => {
    const labels = STANDARD_OBLIGATIONS.map((o) => o.label.toLowerCase());
    expect(labels.some((l) => l.includes('cphs'))).toBe(true);
    expect(labels.some((l) => l.includes('simulacro'))).toBe(true);
    expect(labels.some((l) => l.includes('iso 45001'))).toBe(true);
    expect(labels.some((l) => l.includes('silice') || l.includes('sílice'))).toBe(true);
  });

  it('cada template cita norma', () => {
    for (const o of STANDARD_OBLIGATIONS) {
      expect(o.legalCitation.length).toBeGreaterThan(5);
    }
  });
});

describe('bootstrapCalendar', () => {
  it('genera obligations con primera fecha futura', () => {
    const obs = bootstrapCalendar(STANDARD_OBLIGATIONS, NOW);
    expect(obs.length).toBe(STANDARD_OBLIGATIONS.length);
    for (const o of obs) {
      expect(new Date(o.nextDueAt).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  it('monthly se programa a 30 días', () => {
    const obs = bootstrapCalendar(
      [STANDARD_OBLIGATIONS.find((o) => o.recurrence === 'monthly')!],
      NOW,
    );
    const due = new Date(obs[0].nextDueAt);
    expect(Math.floor((due.getTime() - NOW.getTime()) / 86_400_000)).toBe(30);
  });
});

describe('computeCalendar', () => {
  function makeObligation(dueInDays: number, alert = 30): LegalObligation {
    return {
      id: 'o1',
      kind: 'cphs_meeting',
      label: 'Test',
      legalCitation: 'DS X',
      recurrence: 'monthly',
      alertLeadDays: alert,
      nextDueAt: new Date(NOW.getTime() + dueInDays * 86_400_000).toISOString(),
    };
  }

  it('calcula daysUntilDue', () => {
    const e = computeCalendar([makeObligation(15)], NOW)[0];
    expect(e.daysUntilDue).toBe(15);
  });

  it('marca isInAlertWindow para items dentro de ventana', () => {
    const e1 = computeCalendar([makeObligation(20, 30)], NOW)[0];
    const e2 = computeCalendar([makeObligation(50, 30)], NOW)[0];
    expect(e1.isInAlertWindow).toBe(true);
    expect(e2.isInAlertWindow).toBe(false);
  });

  it('marca isOverdue para fechas pasadas', () => {
    const e = computeCalendar([makeObligation(-3)], NOW)[0];
    expect(e.isOverdue).toBe(true);
    expect(e.isInAlertWindow).toBe(false);
  });

  it('ordena por daysUntilDue ascendente', () => {
    const entries = computeCalendar(
      [makeObligation(50), makeObligation(-5), makeObligation(10)],
      NOW,
    );
    expect(entries[0].daysUntilDue).toBe(-5);
    expect(entries[1].daysUntilDue).toBe(10);
    expect(entries[2].daysUntilDue).toBe(50);
  });
});

describe('advanceObligation', () => {
  it('monthly avanza 30 días', () => {
    const obs = bootstrapCalendar([STANDARD_OBLIGATIONS[0]], NOW)[0];
    const advanced = advanceObligation(obs);
    const diff = (Date.parse(advanced.nextDueAt) - Date.parse(obs.nextDueAt)) / 86_400_000;
    expect(diff).toBe(30);
  });

  it('annual avanza 365 días', () => {
    const annual = STANDARD_OBLIGATIONS.find((o) => o.recurrence === 'annual')!;
    const obs = bootstrapCalendar([annual], NOW)[0];
    const advanced = advanceObligation(obs);
    const diff = (Date.parse(advanced.nextDueAt) - Date.parse(obs.nextDueAt)) / 86_400_000;
    expect(diff).toBe(365);
  });
});

describe('summarizeCalendar', () => {
  it('cuenta overdue + alert window + nextUpcoming', () => {
    const obs = [
      {
        id: 'a',
        kind: 'cphs_meeting' as const,
        label: '',
        legalCitation: '',
        recurrence: 'monthly' as const,
        alertLeadDays: 7,
        nextDueAt: new Date(NOW.getTime() - 5 * 86_400_000).toISOString(),
      },
      {
        id: 'b',
        kind: 'audit' as const,
        label: '',
        legalCitation: '',
        recurrence: 'annual' as const,
        alertLeadDays: 60,
        nextDueAt: new Date(NOW.getTime() + 20 * 86_400_000).toISOString(),
      },
    ];
    const entries = computeCalendar(obs, NOW);
    const summary = summarizeCalendar(entries);
    expect(summary.totalObligations).toBe(2);
    expect(summary.overdue).toBe(1);
    expect(summary.inAlertWindow).toBe(1);
    expect(summary.byKind.cphs_meeting).toBe(1);
    expect(summary.byKind.audit).toBe(1);
    expect(summary.nextUpcoming?.id).toBe('b');
  });
});
