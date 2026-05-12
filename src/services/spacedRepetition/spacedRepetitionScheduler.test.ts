import { describe, it, expect } from 'vitest';
import {
  reviewCard,
  createInitialCard,
  selectDueCards,
  buildRetentionReport,
} from './spacedRepetitionScheduler.js';

describe('createInitialCard', () => {
  it('inicializa con intervalo 1 y easeFactor 2.5', () => {
    const c = createInitialCard('c1', 'w1', 'altura', '2026-05-11T10:00:00Z');
    expect(c.reviewCount).toBe(0);
    expect(c.easeFactor).toBe(2.5);
    expect(c.intervalDays).toBe(1);
  });

  it('nextReviewAt = initiallyLearnedAt + 1 día', () => {
    const c = createInitialCard('c1', 'w1', 't', '2026-05-11T10:00:00Z');
    expect(c.nextReviewAt).toBe('2026-05-12T10:00:00.000Z');
  });
});

describe('reviewCard', () => {
  it('quality 5 + primer review → intervalo = 1', () => {
    const c = createInitialCard('c1', 'w1', 't', '2026-05-11T10:00:00Z');
    const updated = reviewCard(c, 5, '2026-05-12T10:00:00Z');
    expect(updated.reviewCount).toBe(1);
    expect(updated.intervalDays).toBe(1);
  });

  it('quality 5 + segundo review → intervalo = 6', () => {
    let c = createInitialCard('c1', 'w1', 't', '2026-05-11T10:00:00Z');
    c = reviewCard(c, 5, '2026-05-12T10:00:00Z');
    const updated = reviewCard(c, 5, '2026-05-13T10:00:00Z');
    expect(updated.intervalDays).toBe(6);
  });

  it('quality < 3 → intervalo se reinicia a 1', () => {
    let c = createInitialCard('c1', 'w1', 't', '2026-05-11T10:00:00Z');
    c = reviewCard(c, 5, '2026-05-12T10:00:00Z');
    c = reviewCard(c, 5, '2026-05-13T10:00:00Z'); // intervalo=6
    const failed = reviewCard(c, 1, '2026-05-14T10:00:00Z');
    expect(failed.intervalDays).toBe(1);
  });

  it('easeFactor mínimo 1.3', () => {
    let c = createInitialCard('c1', 'w1', 't', '2026-05-11T10:00:00Z');
    // Múltiples fallos
    for (let i = 0; i < 5; i++) {
      c = reviewCard(c, 0, '2026-05-15T10:00:00Z');
    }
    expect(c.easeFactor).toBeGreaterThanOrEqual(1.3);
  });
});

describe('selectDueCards', () => {
  it('selecciona solo cards con nextReviewAt <= now', () => {
    const now = '2026-05-15T10:00:00Z';
    const cards = [
      { ...createInitialCard('due', 'w1', 't1', '2026-05-13T10:00:00Z'), nextReviewAt: '2026-05-14T10:00:00Z' },
      { ...createInitialCard('not-yet', 'w1', 't2', '2026-05-14T10:00:00Z'), nextReviewAt: '2026-05-20T10:00:00Z' },
    ];
    const due = selectDueCards(cards, now);
    expect(due.map((c) => c.id)).toEqual(['due']);
  });
});

describe('buildRetentionReport', () => {
  it('cuenta consolidated + weak topics', () => {
    const cards = [
      { ...createInitialCard('c1', 'w1', 'altura', '2026-05-01'), intervalDays: 60 },
      { ...createInitialCard('c2', 'w1', 'quimico', '2026-05-01'), intervalDays: 3 },
      { ...createInitialCard('c3', 'w1', 'electrico', '2026-05-01'), intervalDays: 50 },
    ];
    const r = buildRetentionReport(cards, 'w1');
    expect(r.totalCards).toBe(3);
    expect(r.consolidatedPercent).toBeGreaterThan(0);
    expect(r.weakTopics).toContain('quimico');
  });

  it('vacío → score 0', () => {
    const r = buildRetentionReport([], 'w1');
    expect(r.totalCards).toBe(0);
    expect(r.consolidatedPercent).toBe(0);
  });
});
