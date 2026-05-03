// SPDX-License-Identifier: MIT
import { describe, it, expect } from 'vitest';
import { buildLocalSummary } from './wisdomCapsule';

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
