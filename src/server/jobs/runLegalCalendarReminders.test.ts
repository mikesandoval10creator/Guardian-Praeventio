import { describe, it, expect, vi } from 'vitest';
import { runLegalCalendarReminders } from './runLegalCalendarReminders.js';
import type { LegalObligation } from '../../services/legalCalendar/legalObligationsCalendar.js';

const NOW = () => new Date('2026-05-12T12:00:00Z');

function buildDb(opts: {
  obligations: Array<{ id: string; data: LegalObligation; existingReminderKey?: string }>;
  scanShouldFail?: boolean;
}) {
  const writes: Array<{ path: string; data: unknown }> = [];

  const obligationsCol = {
    async get() {
      if (opts.scanShouldFail) throw new Error('scan boom');
      return {
        size: opts.obligations.length,
        docs: opts.obligations.map((o) => ({
          id: o.id,
          data: () => o.data,
        })),
      };
    },
    doc(obligationId: string) {
      return {
        collection(name: string) {
          if (name !== 'reminders_sent') throw new Error('unexpected subcoll');
          return {
            doc(key: string) {
              const existing = opts.obligations.find(
                (o) => o.id === obligationId && o.existingReminderKey === key,
              );
              return {
                async get() {
                  return { exists: Boolean(existing) };
                },
                async set(data: unknown) {
                  writes.push({
                    path: `legal_obligations/${obligationId}/reminders_sent/${key}`,
                    data,
                  });
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    db: {
      collection(name: string) {
        if (name === 'legal_obligations') return obligationsCol;
        throw new Error(`unexpected collection ${name}`);
      },
    } as any,
    writes,
  };
}

function obligation(over: Partial<LegalObligation> = {}): LegalObligation {
  return {
    id: 'ob1',
    kind: 'cphs_meeting',
    label: 'Reunión CPHS mensual',
    legalCitation: 'DS 54 art. 24',
    recurrence: 'monthly',
    alertLeadDays: 7,
    nextDueAt: '2026-05-17T12:00:00Z',
    ...over,
  };
}

describe('runLegalCalendarReminders', () => {
  it('obligación due en 5 días con lead=7 → emite reminder', async () => {
    const { db, writes } = buildDb({
      obligations: [{ id: 'ob1', data: obligation() }],
    });
    const notify = vi.fn().mockResolvedValue(undefined);
    const r = await runLegalCalendarReminders({ db, now: NOW, notifyResponsible: notify });
    expect(r.remindersEmitted).toBe(1);
    expect(r.skippedNotDue).toBe(0);
    expect(notify).toHaveBeenCalled();
    expect(writes).toHaveLength(1);
  });

  it('obligación due en 30 días con lead=7 → skipped (no due)', async () => {
    const { db } = buildDb({
      obligations: [
        {
          id: 'ob1',
          data: obligation({ nextDueAt: '2026-06-15T12:00:00Z', alertLeadDays: 7 }),
        },
      ],
    });
    const r = await runLegalCalendarReminders({ db, now: NOW });
    expect(r.remindersEmitted).toBe(0);
    expect(r.skippedNotDue).toBe(1);
  });

  it('idempotente: si el key del día ya existe, no re-emite', async () => {
    const key = 'ob1_2026-05-17';
    const { db, writes } = buildDb({
      obligations: [
        {
          id: 'ob1',
          data: obligation(),
          existingReminderKey: key,
        },
      ],
    });
    const r = await runLegalCalendarReminders({ db, now: NOW });
    expect(r.remindersEmitted).toBe(0);
    expect(r.skippedIdempotent).toBe(1);
    expect(writes).toHaveLength(0);
  });

  it('obligación con nextDueAt malformado → errors', async () => {
    const { db } = buildDb({
      obligations: [{ id: 'ob1', data: obligation({ nextDueAt: 'not-a-date' }) }],
    });
    const r = await runLegalCalendarReminders({ db, now: NOW });
    expect(r.errors).toBe(1);
  });

  it('scan failure no rompe — devuelve error count', async () => {
    const { db } = buildDb({ obligations: [], scanShouldFail: true });
    const r = await runLegalCalendarReminders({ db, now: NOW });
    expect(r.errors).toBe(1);
    expect(r.remindersEmitted).toBe(0);
  });

  it('error de notify NO incrementa errors counter', async () => {
    const { db } = buildDb({
      obligations: [{ id: 'ob1', data: obligation() }],
    });
    const notify = vi.fn().mockRejectedValue(new Error('FCM down'));
    const r = await runLegalCalendarReminders({ db, now: NOW, notifyResponsible: notify });
    expect(r.remindersEmitted).toBe(1);
    expect(r.errors).toBe(0);
  });
});
