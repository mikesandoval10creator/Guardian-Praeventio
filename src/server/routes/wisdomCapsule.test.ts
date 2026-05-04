// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { buildLocalSummary, aggregateCapsuleStats } from './wisdomCapsule';

describe('buildLocalSummary', () => {
  it('mentions cuadrillas without naming individuals', () => {
    const c = buildLocalSummary({
      date: '2026-05-02',
      hallazgosCount: 3,
      alertasAtendidas: 2,
      crewNames: ['Alfa'],
    });
    expect(c.body).toContain('Alfa');
    expect(c.body).not.toMatch(/uid|usuario\s+\w/i);
    expect(c.xpReward).toBe(5);
    expect(c.title).toContain('2026-05-02');
  });

  it('falls back to a calm message on a quiet day', () => {
    const c = buildLocalSummary({
      date: '2026-05-02',
      hallazgosCount: 0,
      alertasAtendidas: 0,
      crewNames: [],
    });
    expect(c.body.toLowerCase()).toContain('día tranquilo');
  });

  it('duration is bounded to 30-60 seconds', () => {
    const c = buildLocalSummary({
      date: '2026-05-02',
      hallazgosCount: 50,
      alertasAtendidas: 50,
      crewNames: ['Alfa', 'Beta', 'Gamma'],
    });
    expect(c.durationSeconds).toBeGreaterThanOrEqual(30);
    expect(c.durationSeconds).toBeLessThanOrEqual(60);
  });
});

describe('aggregateCapsuleStats (Sprint 17a engagement dashboard feed)', () => {
  it('computes per-day ack rate sorted by date ascending', () => {
    const out = aggregateCapsuleStats(
      [
        { date: '2026-05-02', ackedBy: ['u1', 'u2'] },
        { date: '2026-05-01', ackedBy: ['u1'] },
      ],
      4,
      []
    );
    expect(out.byDate.map((r) => r.date)).toEqual(['2026-05-01', '2026-05-02']);
    expect(out.byDate[0].ackRate).toBeCloseTo(0.25);
    expect(out.byDate[1].ackRate).toBeCloseTo(0.5);
  });

  it('picks the crew whose members account for the most acks', () => {
    const out = aggregateCapsuleStats(
      [
        { date: '2026-05-01', ackedBy: ['a1', 'a2', 'b1'] },
        { date: '2026-05-02', ackedBy: ['a1'] },
      ],
      10,
      [
        { crewName: 'Cuadrilla Alfa', uids: ['a1', 'a2'] },
        { crewName: 'Cuadrilla Beta', uids: ['b1'] },
      ]
    );
    expect(out.topCrew).toBe('Cuadrilla Alfa');
  });

  it('returns null topCrew when there are zero acks', () => {
    const out = aggregateCapsuleStats(
      [{ date: '2026-05-01', ackedBy: [] }],
      5,
      [{ crewName: 'Alfa', uids: ['x1'] }]
    );
    expect(out.topCrew).toBeNull();
    expect(out.byDate[0].ackRate).toBe(0);
  });
});
