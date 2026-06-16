// SPDX-License-Identifier: MIT
//
// ADR 0012 conformance — VitalityMonitor must emit NON-diagnostic safety
// recommendations, never a diagnosis or clinical code. Before the reconversion
// this logic mapped vitals to CIE-10 codes (T67.5, T67.0, R00.0) with diagnostic
// language ("agotamiento por calor probable", "taquicardia sinusal"). This suite
// pins that the new output describes a SIGNAL + recommends an ACTION only.

import { describe, it, expect } from 'vitest';
import {
  evaluateSafetyRecommendations,
  computeVitalityIndex,
  type SafetyRecommendation,
} from './vitalitySignals';

// A CIE-10 code looks like `T67.5` / `R00.0` — a letter, two digits, optional `.d`.
const CIE10 = /\b[A-Z]\d{2}(?:\.\d)?\b/;
// Diagnosis-shaped disease language that must NOT appear.
const DIAGNOSTIC_WORDS = /diagn[oó]stic|patolog|taquicardia|s[ií]ndrome|enfermedad|CIE-?10/i;

function allText(recs: SafetyRecommendation[]): string {
  return recs.map((r) => `${r.signal} ${r.recommendation}`).join(' || ');
}

describe('evaluateSafetyRecommendations — ADR 0012 (no diagnosis)', () => {
  it('sustained high HR + manual load → a high-severity pause/hydrate recommendation', () => {
    const recs = evaluateSafetyRecommendations({
      hrSustainedHigh: true, hrIrregular: false, stepsLowAfterShift: false, temperature: 22, toolWeight: 8,
    });
    expect(recs).toHaveLength(1);
    expect(recs[0].severity).toBe('high');
    expect(recs[0].recommendation.toLowerCase()).toMatch(/pausa|hidrat/);
  });

  it('low activity + heat → recommends shade/hydration', () => {
    const recs = evaluateSafetyRecommendations({
      hrSustainedHigh: false, hrIrregular: false, stepsLowAfterShift: true, temperature: 33, toolWeight: 0,
    });
    expect(recs).toHaveLength(1);
    expect(recs[0].recommendation.toLowerCase()).toMatch(/sombra|hidrat/);
  });

  it('irregular HR → a medium recommendation that may suggest seeking medical evaluation', () => {
    const recs = evaluateSafetyRecommendations({
      hrSustainedHigh: false, hrIrregular: true, stepsLowAfterShift: false, temperature: 20, toolWeight: 0,
    });
    expect(recs).toHaveLength(1);
    expect(recs[0].severity).toBe('medium');
  });

  it('no signals → no recommendations', () => {
    const recs = evaluateSafetyRecommendations({
      hrSustainedHigh: false, hrIrregular: false, stepsLowAfterShift: false, temperature: 20, toolWeight: 3,
    });
    expect(recs).toEqual([]);
  });

  it('NEVER emits a `cieCode` field (no clinical code is assigned)', () => {
    const recs = evaluateSafetyRecommendations({
      hrSustainedHigh: true, hrIrregular: true, stepsLowAfterShift: true, temperature: 35, toolWeight: 12,
    });
    expect(recs.length).toBeGreaterThan(0);
    for (const r of recs) {
      expect(r).not.toHaveProperty('cieCode');
      expect(Object.keys(r).sort()).toEqual(['recommendation', 'severity', 'signal']);
    }
  });

  it('NEVER renders a CIE-10 code or diagnosis-shaped language in any text', () => {
    // Fire every branch at once.
    const recs = evaluateSafetyRecommendations({
      hrSustainedHigh: true, hrIrregular: true, stepsLowAfterShift: true, temperature: 40, toolWeight: 20,
    });
    const text = allText(recs);
    expect(text).not.toMatch(CIE10);
    expect(text).not.toMatch(DIAGNOSTIC_WORDS);
  });
});

describe('computeVitalityIndex — deterministic real index (no simulated drain)', () => {
  const benign = {
    temperature: 25,
    altitude: 1000,
    toolWeight: 5,
    hrSustainedHigh: false,
    hrIrregular: false,
    stepsLowAfterShift: false,
  };

  it('is 100 under benign conditions with no adverse telemetry', () => {
    expect(computeVitalityIndex(benign)).toBe(100);
  });

  it('is deterministic — same inputs always yield the same value (no time decay)', () => {
    const a = computeVitalityIndex({ ...benign, temperature: 36 });
    const b = computeVitalityIndex({ ...benign, temperature: 36 });
    expect(a).toBe(b);
    expect(a).toBeLessThan(100); // heat above 30 lowers headroom
  });

  it('subtracts for each real adverse signal and stays within 0–100', () => {
    const heat = computeVitalityIndex({ ...benign, temperature: 35 }); // -15
    expect(heat).toBe(85);
    const hr = computeVitalityIndex({ ...benign, hrSustainedHigh: true }); // -25
    expect(hr).toBe(75);

    const worst = computeVitalityIndex({
      temperature: 50,
      altitude: 5000,
      toolWeight: 40,
      hrSustainedHigh: true,
      hrIrregular: true,
      stepsLowAfterShift: true,
    });
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(worst).toBeLessThan(50);
  });

  it('ignores HR penalties when no real telemetry flags are set', () => {
    // With HR flags false (e.g. no wearable), only ambient load applies.
    expect(computeVitalityIndex({ ...benign, temperature: 25 })).toBe(100);
  });
});
