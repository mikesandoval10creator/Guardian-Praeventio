/**
 * Smoke: REBA + RULA + IPER + TMERT + PREXOR sanity.
 *
 * We do NOT recompute the canonical worksheets here — the per-module test
 * suites already cover that. The point is to assert the public API of each
 * safety calculator stays exported and returns shaped output. If a refactor
 * accidentally ships a `default` export or removes `actionLevel`, this
 * smoke fails before the unit suite even runs (because the smoke runs
 * first in CI).
 */
import { describe, expect, it } from 'vitest';

import { calculateReba } from '../services/ergonomics/reba';
import { calculateRula } from '../services/ergonomics/rula';
import { calculateIper } from '../services/protocols/iper';
import { calculatePrexor } from '../services/protocols/prexor';
import { evaluateTmert } from '../services/protocols/tmert';

import { EMPTY_TMERT, NEUTRAL_REBA, NEUTRAL_RULA } from './setup';

describe('smoke: safety calculators export shape', () => {
  it('every calculator is a function (not undefined)', () => {
    expect(typeof calculateReba).toBe('function');
    expect(typeof calculateRula).toBe('function');
    expect(typeof calculateIper).toBe('function');
    expect(typeof evaluateTmert).toBe('function');
    expect(typeof calculatePrexor).toBe('function');
  });

  it('REBA: neutral input → finalScore in [1,15], actionLevel "negligible"', () => {
    const r = calculateReba(NEUTRAL_REBA);
    expect(r.finalScore).toBeGreaterThanOrEqual(1);
    expect(r.finalScore).toBeLessThanOrEqual(15);
    expect(r.actionLevel).toBe('negligible');
  });

  it('RULA: neutral input → finalScore in [1,7], actionLevel 1 or 2', () => {
    const r = calculateRula(NEUTRAL_RULA);
    expect(r.finalScore).toBeGreaterThanOrEqual(1);
    expect(r.finalScore).toBeLessThanOrEqual(7);
    expect([1, 2]).toContain(r.actionLevel);
  });

  it('IPER: { probability: 1, severity: 1 } → trivial / #22c55e', () => {
    const r = calculateIper({ probability: 1, severity: 1 });
    expect(r.level).toBe('trivial');
    expect(r.color).toBe('#22c55e');
  });

  it('TMERT: empty conditions → overallRisk "bajo"', () => {
    const r = evaluateTmert(EMPTY_TMERT);
    expect(r.overallRisk).toBe('bajo');
    expect(r.factorsAtRisk).toEqual([]);
    expect(r.requiresMedicalEvaluation).toBe(false);
  });

  it('PREXOR: empty measurements → dose 0, riskLevel "bajo"', () => {
    const r = calculatePrexor([]);
    expect(r.dosePercent).toBe(0);
    expect(r.riskLevel).toBe('bajo');
    expect(r.exceedsLegalLimit).toBe(false);
  });
});
