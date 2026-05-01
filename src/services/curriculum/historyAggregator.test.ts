// Praeventio Guard — Round 17 (R5 agent): historyAggregator tests.
//
// Pure-function aggregator that turns raw `audit_logs` + `gamification_scores`
// rows into a curriculum-page-ready shape:
//
//   { events: CurriculumHistoryEvent[],
//     stats: { level, xp, completedTrainings, criticalAssessments } }
//
// The audit-log filter the page uses is:
//   action ∈ /^(safety|training|curriculum|gamification)\.[^.]+(\.[^.]+)*$/
//   ordered by timestamp desc, limited to 20 events.
//
// XP and level are derived as follows (matches the existing
// gamificationBackend convention used in awardPoints):
//   xp = sum of `points` across all gamification_scores rows for the user.
//   level = floor(xp / 1000) + 1, min 1, max 99.
//
// completedTrainings = count of audit_logs whose action matches
//   /^training\..+\.completed$/.
// criticalAssessments = count of audit_logs whose action matches
//   /^safety\.(iper|ergonomic)\..+/ AND whose details.level === 'CRITICO'
//   (or details.score >= 11 — REBA "muy alto"). Either signal counts.
//
// The aggregator itself is purely synchronous + side-effect-free; the
// Firestore reads happen at the page boundary.

import { describe, it, expect } from 'vitest';
import { aggregateUserHistory } from './historyAggregator.js';

describe('aggregateUserHistory', () => {
  it('returns an empty shape when both inputs are empty', () => {
    const out = aggregateUserHistory([], []);
    expect(out.events).toEqual([]);
    expect(out.stats).toEqual({
      level: 1,
      xp: 0,
      completedTrainings: 0,
      criticalAssessments: 0,
      safeHours: 0,
    });
  });

  it('filters audit logs to only the curriculum-relevant action prefixes', () => {
    const logs = [
      { action: 'safety.report.created', module: 'safety', timestamp: '2026-04-01T10:00:00Z', details: {} },
      { action: 'admin.role.set', module: 'admin', timestamp: '2026-04-02T10:00:00Z', details: {} },
      { action: 'training.height.completed', module: 'training', timestamp: '2026-04-03T10:00:00Z', details: {} },
      { action: 'curriculum.claim.created', module: 'curriculum', timestamp: '2026-04-04T10:00:00Z', details: {} },
      { action: 'gamification.medal.earned', module: 'gamification', timestamp: '2026-04-05T10:00:00Z', details: {} },
      { action: 'auth.login', module: 'auth', timestamp: '2026-04-06T10:00:00Z', details: {} },
    ];
    const out = aggregateUserHistory(logs, []);
    const actions = out.events.map((e) => e.action);
    expect(actions).toEqual([
      'gamification.medal.earned',
      'curriculum.claim.created',
      'training.height.completed',
      'safety.report.created',
    ]);
  });

  it('orders events by timestamp descending (newest first)', () => {
    const logs = [
      { action: 'safety.a', timestamp: '2026-01-01T00:00:00Z', details: {} },
      { action: 'safety.b', timestamp: '2026-04-01T00:00:00Z', details: {} },
      { action: 'safety.c', timestamp: '2026-02-01T00:00:00Z', details: {} },
    ];
    const out = aggregateUserHistory(logs, []);
    expect(out.events.map((e) => e.action)).toEqual(['safety.b', 'safety.c', 'safety.a']);
  });

  it('limits the events list to the 20 most recent rows', () => {
    const logs = Array.from({ length: 25 }, (_, i) => ({
      action: 'safety.report.created',
      timestamp: new Date(2026, 0, i + 1).toISOString(),
      details: { i },
    }));
    const out = aggregateUserHistory(logs, []);
    expect(out.events).toHaveLength(20);
    // Newest 20 = indices 24..5
    expect(out.events[0].details).toMatchObject({ i: 24 });
    expect(out.events[19].details).toMatchObject({ i: 5 });
  });

  it('counts completed trainings via /^training\\..+\\.completed$/', () => {
    const logs = [
      { action: 'training.height.completed', timestamp: '2026-01-01T00:00:00Z' },
      { action: 'training.confined-space.completed', timestamp: '2026-01-02T00:00:00Z' },
      { action: 'training.height.started', timestamp: '2026-01-03T00:00:00Z' },
      { action: 'training.module.section.completed', timestamp: '2026-01-04T00:00:00Z' },
      { action: 'safety.training.completed', timestamp: '2026-01-05T00:00:00Z' }, // wrong prefix
    ];
    const out = aggregateUserHistory(logs, []);
    expect(out.stats.completedTrainings).toBe(3);
  });

  it('counts critical assessments by details.level === CRITICO or score >= 11', () => {
    const logs = [
      { action: 'safety.iper.created', details: { level: 'CRITICO' }, timestamp: '2026-01-01T00:00:00Z' },
      { action: 'safety.iper.created', details: { level: 'BAJO' }, timestamp: '2026-01-02T00:00:00Z' },
      { action: 'safety.ergonomic.created', details: { score: 12 }, timestamp: '2026-01-03T00:00:00Z' },
      { action: 'safety.ergonomic.created', details: { score: 5 }, timestamp: '2026-01-04T00:00:00Z' },
      { action: 'safety.report.created', details: { level: 'CRITICO' }, timestamp: '2026-01-05T00:00:00Z' }, // not iper/ergonomic
    ];
    const out = aggregateUserHistory(logs, []);
    expect(out.stats.criticalAssessments).toBe(2);
  });

  it('aggregates xp = sum of points across all gamification_scores rows', () => {
    const scores = [
      { gameId: 'claw', points: 100 },
      { gameId: 'pool', points: 250 },
      { gameId: 'simulator', points: 150 },
    ];
    const out = aggregateUserHistory([], scores);
    expect(out.stats.xp).toBe(500);
  });

  it('uses bestScore when points is missing (gamification_scores legacy schema)', () => {
    // Older gamification_scores docs lack `points` and use `bestScore`. The
    // aggregator falls back to `bestScore` rather than treating the row as 0.
    const scores = [
      { gameId: 'claw', bestScore: 80 },
      { gameId: 'pool', points: 120, bestScore: 60 }, // points wins when present
    ];
    const out = aggregateUserHistory([], scores);
    expect(out.stats.xp).toBe(200);
  });

  it('derives level = floor(xp / 1000) + 1', () => {
    const cases: Array<[number, number]> = [
      [0, 1],
      [999, 1],
      [1000, 2],
      [2500, 3],
      [9999, 10],
    ];
    for (const [xp, expectedLevel] of cases) {
      const out = aggregateUserHistory([], [{ gameId: 'sum', points: xp }]);
      expect(out.stats.level).toBe(expectedLevel);
    }
  });

  it('caps level at 99 even with absurd xp', () => {
    const out = aggregateUserHistory([], [{ gameId: 'sum', points: 999_999_999 }]);
    expect(out.stats.level).toBe(99);
  });

  it('floors level at 1 even with negative or NaN xp inputs (defensive)', () => {
    const out = aggregateUserHistory(
      [],
      [
        { gameId: 'a', points: -50 },
        { gameId: 'b', points: Number.NaN as any },
      ],
    );
    expect(out.stats.level).toBe(1);
    expect(out.stats.xp).toBe(0);
  });

  it('preserves all original audit_log fields in the events output', () => {
    const logs = [
      {
        action: 'training.height.completed',
        module: 'training',
        timestamp: '2026-04-01T10:00:00Z',
        userId: 'uid-1',
        details: { score: 95, durationMin: 120 },
      },
    ];
    const out = aggregateUserHistory(logs, []);
    expect(out.events[0]).toMatchObject({
      action: 'training.height.completed',
      module: 'training',
      timestamp: '2026-04-01T10:00:00Z',
      details: { score: 95, durationMin: 120 },
    });
  });

  it('tolerates rows with missing/invalid timestamps by sorting them last', () => {
    const logs = [
      { action: 'safety.a', timestamp: '2026-04-01T00:00:00Z' },
      { action: 'safety.b' }, // missing timestamp
      { action: 'safety.c', timestamp: 'not-a-date' },
      { action: 'safety.d', timestamp: '2026-05-01T00:00:00Z' },
    ];
    const out = aggregateUserHistory(logs, []);
    expect(out.events.map((e) => e.action).slice(0, 2)).toEqual(['safety.d', 'safety.a']);
    expect(out.events).toHaveLength(4);
  });

  // Round 18 (R5) — `stats.safeHours` propagation. The aggregator sums
  // `details.durationMin` across `safety.*` actions and divides by 60.
  // Training/curriculum/gamification rows MUST NOT inflate the metric;
  // missing/non-finite/non-positive durationMin MUST be skipped silently.

  it('sums details.durationMin across safety.* events into stats.safeHours', () => {
    const logs = [
      { action: 'safety.iper.matrix.classified', details: { durationMin: 45 }, timestamp: '2026-04-01T00:00:00Z' },
      { action: 'safety.reba.completed',         details: { durationMin: 30 }, timestamp: '2026-04-02T00:00:00Z' },
      { action: 'safety.rula.completed',         details: { durationMin: 15 }, timestamp: '2026-04-03T00:00:00Z' },
    ];
    const out = aggregateUserHistory(logs, []);
    // 45 + 30 + 15 = 90 min ÷ 60 = 1.5 h
    expect(out.stats.safeHours).toBe(1.5);
  });

  it('does NOT count durationMin from non-safety actions toward safeHours', () => {
    const logs = [
      { action: 'training.webxr.completed',   details: { durationMin: 60 }, timestamp: '2026-04-01T00:00:00Z' },
      { action: 'curriculum.claim.created',   details: { durationMin: 90 }, timestamp: '2026-04-02T00:00:00Z' },
      { action: 'gamification.medal.earned',  details: { durationMin: 30 }, timestamp: '2026-04-03T00:00:00Z' },
      { action: 'safety.iper.matrix.signed',  details: { durationMin: 30 }, timestamp: '2026-04-04T00:00:00Z' },
    ];
    const out = aggregateUserHistory(logs, []);
    // Only the safety.* row contributes — 30 min ÷ 60 = 0.5 h.
    expect(out.stats.safeHours).toBe(0.5);
  });

  it('skips rows whose durationMin is missing, NaN, negative, zero, or non-numeric', () => {
    const logs = [
      { action: 'safety.reba.completed', details: {},                          timestamp: '2026-04-01T00:00:00Z' },
      { action: 'safety.reba.completed', details: { durationMin: -10 },        timestamp: '2026-04-02T00:00:00Z' },
      { action: 'safety.reba.completed', details: { durationMin: 0 },          timestamp: '2026-04-03T00:00:00Z' },
      { action: 'safety.reba.completed', details: { durationMin: Number.NaN }, timestamp: '2026-04-04T00:00:00Z' },
      { action: 'safety.reba.completed', details: { durationMin: 'two hours' as any }, timestamp: '2026-04-05T00:00:00Z' },
      { action: 'safety.reba.completed', details: { durationMin: 90 },         timestamp: '2026-04-06T00:00:00Z' },
    ];
    const out = aggregateUserHistory(logs, []);
    // Only the last row counts: 90 min ÷ 60 = 1.5 h
    expect(out.stats.safeHours).toBe(1.5);
  });

  it('aggregates safeHours across more than 20 safety events (full set, not just the events slice)', () => {
    // 25 safety rows of 60 min each — the events array is capped at 20, but
    // safeHours must reflect ALL the worker's safety time so they don't lose
    // credit when they cross the 20-event cap.
    const logs = Array.from({ length: 25 }, (_, i) => ({
      action: 'safety.reba.completed',
      timestamp: new Date(2026, 0, i + 1).toISOString(),
      details: { durationMin: 60 },
    }));
    const out = aggregateUserHistory(logs, []);
    expect(out.events).toHaveLength(20);
    // 25 × 60 = 1500 min ÷ 60 = 25 h
    expect(out.stats.safeHours).toBe(25);
  });
});
