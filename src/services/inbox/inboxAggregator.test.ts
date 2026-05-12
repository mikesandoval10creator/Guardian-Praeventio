import { describe, it, expect } from 'vitest';
import {
  aggregateInbox,
  summarizeInbox,
  type FeedInputs,
} from './inboxAggregator.js';

function emptyFeeds(responsibleUid = 'prev-1'): FeedInputs {
  return {
    documentsPending: [],
    incidentsPending: [],
    correctiveActionsOpen: [],
    eppPendingValidation: [],
    workersPendingOnboarding: [],
    repeatingRiskAlerts: [],
    dataQualityGaps: [],
    sifPrecursorsPending: [],
    legalObligationsDueSoon: [],
    exceptionsExpiringSoon: [],
    responsibleUid,
  };
}

const NOW = new Date('2026-05-12T22:00:00Z');

describe('aggregateInbox', () => {
  it('empty feeds → empty result', () => {
    const r = aggregateInbox(emptyFeeds(), { now: NOW });
    expect(r).toEqual([]);
  });

  it('mapea documentsPending a InboxItem con quickActions correctas', () => {
    const feeds = emptyFeeds();
    feeds.documentsPending = [
      { id: 'd1', title: 'RIOHS borrador', createdAt: '2026-05-10T00:00:00Z', submittedByUid: 'u1' },
    ];
    const r = aggregateInbox(feeds, { now: NOW });
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe('document_pending_approval');
    expect(r[0].id).toBe('doc_d1');
    expect(r[0].quickActions.map((a) => a.kind)).toEqual(['approve', 'reject', 'postpone']);
  });

  it('incident critical → urgency urgent', () => {
    const feeds = emptyFeeds();
    feeds.incidentsPending = [
      { id: 'i1', summary: 'Caída altura', severity: 'critical', occurredAt: '2026-05-12T08:00:00Z' },
    ];
    const r = aggregateInbox(feeds, { now: NOW });
    expect(r[0].urgency).toBe('urgent');
  });

  it('corrective action overdue 8 días → urgency urgent', () => {
    const feeds = emptyFeeds();
    feeds.correctiveActionsOpen = [
      { id: 'a1', label: 'Reparar baranda', dueDate: '2026-05-01T00:00:00Z', daysOverdue: 8 },
    ];
    const r = aggregateInbox(feeds, { now: NOW });
    expect(r[0].urgency).toBe('urgent');
    expect(r[0].description).toMatch(/Vencida hace 8 días/);
  });

  it('SIF precursor siempre urgent', () => {
    const feeds = emptyFeeds();
    feeds.sifPrecursorsPending = [
      {
        id: 's1',
        kind: 'altura_sin_lesion',
        summary: 'casi cae sin arnés',
        createdAt: '2026-05-11T00:00:00Z',
      },
    ];
    const r = aggregateInbox(feeds, { now: NOW });
    expect(r[0].urgency).toBe('urgent');
    expect(r[0].kind).toBe('sif_precursor_pending');
  });

  it('exception expirando <2h → urgent', () => {
    const feeds = emptyFeeds();
    feeds.exceptionsExpiringSoon = [
      { id: 'e1', subjectRef: 'WORKER:w1', validUntil: '2026-05-12T23:30:00Z', hoursLeft: 1 },
    ];
    const r = aggregateInbox(feeds, { now: NOW });
    expect(r[0].urgency).toBe('urgent');
  });

  it('legal obligation dueSoon 0 días → urgent', () => {
    const feeds = emptyFeeds();
    feeds.legalObligationsDueSoon = [
      {
        id: 'l1',
        label: 'Reunión CPHS mensual',
        nextDueAt: '2026-05-12T18:00:00Z',
        daysUntil: 0,
      },
    ];
    const r = aggregateInbox(feeds, { now: NOW });
    expect(r[0].urgency).toBe('urgent');
  });

  it('ordena urgent → high → medium → low', () => {
    const feeds = emptyFeeds();
    feeds.documentsPending = [
      { id: 'd1', title: 'doc', createdAt: NOW.toISOString(), submittedByUid: 'u1' },
    ];
    feeds.incidentsPending = [
      { id: 'i1', summary: 'crit', severity: 'critical', occurredAt: NOW.toISOString() },
    ];
    feeds.dataQualityGaps = [{ id: 'g1', description: 'gap' }];
    const r = aggregateInbox(feeds, { now: NOW });
    expect(r[0].urgency).toBe('urgent');
    expect(r[r.length - 1].urgency).toBe('low');
  });

  it('mismo urgency: dueAt asc (más cercano primero)', () => {
    const feeds = emptyFeeds();
    feeds.correctiveActionsOpen = [
      { id: 'a1', label: 'tarde', dueDate: '2026-06-01T00:00:00Z', daysOverdue: 0 },
      { id: 'a2', label: 'temprano', dueDate: '2026-05-20T00:00:00Z', daysOverdue: 0 },
    ];
    const r = aggregateInbox(feeds, { now: NOW });
    expect(r[0].title).toBe('temprano');
  });

  it('hideDismissed filtra los dismissed', () => {
    const feeds = emptyFeeds();
    feeds.documentsPending = [
      { id: 'd1', title: 'a', createdAt: NOW.toISOString(), submittedByUid: 'u1' },
    ];
    const result = aggregateInbox(feeds, { now: NOW, hideDismissed: true });
    // No items have dismissedAt en este flujo, así que todos pasan
    expect(result).toHaveLength(1);
  });

  it('minUrgency=high filtra low/medium', () => {
    const feeds = emptyFeeds();
    feeds.documentsPending = [
      { id: 'd1', title: 'medium', createdAt: NOW.toISOString(), submittedByUid: 'u1' },
    ];
    feeds.incidentsPending = [
      { id: 'i1', summary: 'critical', severity: 'critical', occurredAt: NOW.toISOString() },
    ];
    const r = aggregateInbox(feeds, { now: NOW, minUrgency: 'high' });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('inc_i1');
  });

  it('quickActions específicas por kind', () => {
    const feeds = emptyFeeds();
    feeds.sifPrecursorsPending = [
      { id: 's1', kind: 'x', summary: 'y', createdAt: NOW.toISOString() },
    ];
    const r = aggregateInbox(feeds, { now: NOW });
    const actions = r[0].quickActions.map((a) => a.kind);
    expect(actions).toContain('open_detail');
    expect(actions).toContain('assign');
  });

  it('assignedToUid es el responsableUid del feed', () => {
    const feeds = emptyFeeds('prev-custom');
    feeds.documentsPending = [
      { id: 'd1', title: 'x', createdAt: NOW.toISOString(), submittedByUid: 'u1' },
    ];
    const r = aggregateInbox(feeds, { now: NOW });
    expect(r[0].assignedToUid).toBe('prev-custom');
  });
});

describe('Codex P2 PR #97 fixes', () => {
  it('daysOverdue derivado de dueDate cuando se omite (urgent si >7d)', () => {
    const feeds = emptyFeeds();
    feeds.correctiveActionsOpen = [
      { id: 'a1', label: 'old', dueDate: '2026-04-01T00:00:00Z' },
    ];
    const r = aggregateInbox(feeds, { now: NOW });
    expect(r[0].urgency).toBe('urgent');
  });

  it('quickActions clonadas — mutar uno no afecta otro', () => {
    const feeds = emptyFeeds();
    feeds.documentsPending = [
      { id: 'd1', title: 'A', createdAt: NOW.toISOString(), submittedByUid: 'u1' },
      { id: 'd2', title: 'B', createdAt: NOW.toISOString(), submittedByUid: 'u2' },
    ];
    const r = aggregateInbox(feeds, { now: NOW });
    r[0].quickActions[0].label = 'MUTATED';
    expect(r[1].quickActions[0].label).not.toBe('MUTATED');
  });

  it('dismissals persistidos via feeds.dismissals + hideDismissed filtra', () => {
    const feeds = emptyFeeds();
    feeds.documentsPending = [
      { id: 'd1', title: 'A', createdAt: NOW.toISOString(), submittedByUid: 'u1' },
      { id: 'd2', title: 'B', createdAt: NOW.toISOString(), submittedByUid: 'u2' },
    ];
    feeds.dismissals = { doc_d1: '2026-05-12T10:00:00Z' };
    const visible = aggregateInbox(feeds, { now: NOW, hideDismissed: true });
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('doc_d2');
    const all = aggregateInbox(feeds, { now: NOW });
    expect(all.find((i) => i.id === 'doc_d1')?.dismissedAt).toBe('2026-05-12T10:00:00Z');
  });
});

describe('summarizeInbox', () => {
  it('cuenta total y by-urgency', () => {
    const feeds = emptyFeeds();
    feeds.incidentsPending = [
      { id: 'i1', summary: 'a', severity: 'critical', occurredAt: NOW.toISOString() },
      { id: 'i2', summary: 'b', severity: 'high', occurredAt: NOW.toISOString() },
      { id: 'i3', summary: 'c', severity: 'low', occurredAt: NOW.toISOString() },
    ];
    const items = aggregateInbox(feeds, { now: NOW });
    const s = summarizeInbox(items, NOW.toISOString());
    expect(s.total).toBe(3);
    expect(s.byUrgency.urgent).toBe(1);
    expect(s.byUrgency.high).toBe(1);
    expect(s.byUrgency.low).toBe(1);
  });

  it('overdueCount cuenta dueAt < now', () => {
    const feeds = emptyFeeds();
    feeds.correctiveActionsOpen = [
      { id: 'a1', label: 'x', dueDate: '2026-05-01T00:00:00Z', daysOverdue: 11 }, // overdue
      { id: 'a2', label: 'y', dueDate: '2026-06-01T00:00:00Z', daysOverdue: 0 }, // future
    ];
    const items = aggregateInbox(feeds, { now: NOW });
    const s = summarizeInbox(items, NOW.toISOString());
    expect(s.overdueCount).toBe(1);
  });
});
