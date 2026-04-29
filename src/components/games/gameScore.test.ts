// Round 15 / I4 — gameScore pure-helpers contract.

import { describe, expect, it } from 'vitest';
import { mergeScoreDoc, gameScoreDocId } from './gameScore';

describe('mergeScoreDoc', () => {
  const base = {
    userId: 'u1',
    gameId: 'clawmachine',
    updatedBy: 'u1@example.com',
    now: () => '2026-04-28T00:00:00.000Z',
  };

  it('first play: bestScore = newScore, plays = 1', () => {
    const r = mergeScoreDoc({ ...base, newScore: 100, existing: null });
    expect(r.bestScore).toBe(100);
    expect(r.lastScore).toBe(100);
    expect(r.plays).toBe(1);
    expect(r.bestTimeSeconds).toBeUndefined();
  });

  it('subsequent play with lower score keeps existing best', () => {
    const r = mergeScoreDoc({
      ...base, newScore: 50,
      existing: { bestScore: 200, plays: 5 },
    });
    expect(r.bestScore).toBe(200);
    expect(r.lastScore).toBe(50);
    expect(r.plays).toBe(6);
  });

  it('subsequent play with higher score updates best', () => {
    const r = mergeScoreDoc({
      ...base, newScore: 300,
      existing: { bestScore: 200, plays: 5 },
    });
    expect(r.bestScore).toBe(300);
  });

  it('bestTimeSeconds: lower-is-better, picks min', () => {
    const r = mergeScoreDoc({
      ...base, newScore: 100, newTimeSeconds: 12,
      existing: { bestScore: 100, bestTimeSeconds: 15, plays: 1 },
    });
    expect(r.bestTimeSeconds).toBe(12);
  });

  it('bestTimeSeconds: keeps existing when new is slower', () => {
    const r = mergeScoreDoc({
      ...base, newScore: 100, newTimeSeconds: 30,
      existing: { bestScore: 100, bestTimeSeconds: 15, plays: 1 },
    });
    expect(r.bestTimeSeconds).toBe(15);
  });

  it('bestTimeSeconds: first run sets the time', () => {
    const r = mergeScoreDoc({
      ...base, newScore: 100, newTimeSeconds: 25,
      existing: null,
    });
    expect(r.bestTimeSeconds).toBe(25);
  });

  it('handles missing existing.plays gracefully', () => {
    const r = mergeScoreDoc({ ...base, newScore: 10, existing: { bestScore: 5 } });
    expect(r.plays).toBe(1);
  });

  it('uses injected now() for updatedAt', () => {
    const r = mergeScoreDoc({ ...base, newScore: 1, existing: null });
    expect(r.updatedAt).toBe('2026-04-28T00:00:00.000Z');
  });
});

describe('gameScoreDocId', () => {
  it('joins userId and gameId with underscore', () => {
    expect(gameScoreDocId('abc123', 'poolgame')).toBe('abc123_poolgame');
  });
});
