import { describe, it, expect } from 'vitest';
import {
  buildRouteRiskProfile,
  clampHazardToRoute,
  hazardContribution,
  totalRouteKm,
  HAZARD_KIND_WEIGHT,
  SEVERITY_MULTIPLIER,
  type RoutePoint,
  type RouteSegmentHazard,
} from './criticalRouteScoring.js';

function points(totalKm: number): RoutePoint[] {
  return [
    { lat: -33.45, lng: -70.65, kmFromStart: 0 },
    { lat: -33.50, lng: -70.60, kmFromStart: totalKm / 2 },
    { lat: -33.55, lng: -70.55, kmFromStart: totalKm },
  ];
}

describe('totalRouteKm', () => {
  it('returns 0 for empty input', () => {
    expect(totalRouteKm([])).toBe(0);
  });

  it('returns the max kmFromStart across points', () => {
    expect(totalRouteKm(points(42))).toBe(42);
  });

  it('handles unsorted points by taking the max', () => {
    const unsorted: RoutePoint[] = [
      { lat: 0, lng: 0, kmFromStart: 10 },
      { lat: 0, lng: 0, kmFromStart: 3 },
      { lat: 0, lng: 0, kmFromStart: 7 },
    ];
    expect(totalRouteKm(unsorted)).toBe(10);
  });
});

describe('clampHazardToRoute', () => {
  it('returns null for zero-length route', () => {
    const h: RouteSegmentHazard = { fromKm: 0, toKm: 5, kind: 'sharp_curve', severity: 'minor' };
    expect(clampHazardToRoute(h, 0)).toBeNull();
  });

  it('clamps a hazard that overruns the route end', () => {
    const h: RouteSegmentHazard = { fromKm: 18, toKm: 25, kind: 'steep_grade', severity: 'major' };
    const c = clampHazardToRoute(h, 20);
    expect(c).not.toBeNull();
    expect(c!.fromKm).toBe(18);
    expect(c!.toKm).toBe(20);
  });

  it('drops a hazard fully outside the route', () => {
    const h: RouteSegmentHazard = { fromKm: 25, toKm: 30, kind: 'blind_spot', severity: 'minor' };
    expect(clampHazardToRoute(h, 20)).toBeNull();
  });

  it('normalizes a reversed (toKm < fromKm) hazard', () => {
    const h: RouteSegmentHazard = { fromKm: 10, toKm: 4, kind: 'high_traffic', severity: 'minor' };
    const c = clampHazardToRoute(h, 20);
    expect(c).not.toBeNull();
    expect(c!.fromKm).toBe(4);
    expect(c!.toKm).toBe(10);
  });
});

describe('hazardContribution', () => {
  it('scales with severity multiplier', () => {
    const base: RouteSegmentHazard = { fromKm: 0, toKm: 1, kind: 'sharp_curve', severity: 'minor' };
    const major: RouteSegmentHazard = { ...base, severity: 'major' };
    expect(hazardContribution(major)).toBeGreaterThan(hazardContribution(base));
  });

  it('scales with segment length but sub-linearly', () => {
    const short: RouteSegmentHazard = { fromKm: 0, toKm: 1, kind: 'steep_grade', severity: 'moderate' };
    const long: RouteSegmentHazard = { fromKm: 0, toKm: 100, kind: 'steep_grade', severity: 'moderate' };
    const shortC = hazardContribution(short);
    const longC = hazardContribution(long);
    expect(longC).toBeGreaterThan(shortC);
    // sub-linear: 100x length should NOT yield 100x score.
    expect(longC).toBeLessThan(shortC * 100);
  });

  it('respects the kind weight ordering', () => {
    const school: RouteSegmentHazard = { fromKm: 0, toKm: 1, kind: 'school_zone', severity: 'moderate' };
    const traffic: RouteSegmentHazard = { fromKm: 0, toKm: 1, kind: 'high_traffic', severity: 'moderate' };
    expect(HAZARD_KIND_WEIGHT.school_zone).toBeGreaterThan(HAZARD_KIND_WEIGHT.high_traffic);
    expect(hazardContribution(school)).toBeGreaterThan(hazardContribution(traffic));
  });

  it('SEVERITY_MULTIPLIER is monotonic', () => {
    expect(SEVERITY_MULTIPLIER.minor).toBeLessThan(SEVERITY_MULTIPLIER.moderate);
    expect(SEVERITY_MULTIPLIER.moderate).toBeLessThan(SEVERITY_MULTIPLIER.major);
    expect(SEVERITY_MULTIPLIER.major).toBeLessThan(SEVERITY_MULTIPLIER.critical);
  });
});

describe('buildRouteRiskProfile', () => {
  it('empty hazards → low category, no recommendations beyond defaults', () => {
    const profile = buildRouteRiskProfile('r1', points(50), []);
    expect(profile.category).toBe('low');
    expect(profile.riskScore).toBe(0);
    expect(profile.hazardsCount).toBe(0);
    expect(profile.recommendedDriverExperience).toBe('novice');
  });

  it('a single critical hazard pushes score into moderate or higher', () => {
    const profile = buildRouteRiskProfile('r1', points(50), [
      { fromKm: 5, toKm: 15, kind: 'blind_spot', severity: 'critical' },
    ]);
    expect(profile.riskScore).toBeGreaterThanOrEqual(25);
    expect(['moderate', 'high', 'extreme']).toContain(profile.category);
    expect(profile.hazardsCount).toBe(1);
  });

  it('aggregates breakdown by kind', () => {
    const profile = buildRouteRiskProfile('r1', points(60), [
      { fromKm: 0, toKm: 5, kind: 'sharp_curve', severity: 'minor' },
      { fromKm: 5, toKm: 10, kind: 'sharp_curve', severity: 'moderate' },
      { fromKm: 10, toKm: 20, kind: 'school_zone', severity: 'major' },
    ]);
    expect(profile.hazardBreakdown.sharp_curve).toBe(2);
    expect(profile.hazardBreakdown.school_zone).toBe(1);
    expect(profile.hazardBreakdown.steep_grade).toBe(0);
  });

  it('drops hazards outside the route from breakdown and count', () => {
    const profile = buildRouteRiskProfile('r1', points(20), [
      { fromKm: 0, toKm: 5, kind: 'sharp_curve', severity: 'minor' },
      { fromKm: 100, toKm: 110, kind: 'blind_spot', severity: 'critical' },
    ]);
    expect(profile.hazardsCount).toBe(1);
    expect(profile.hazardBreakdown.blind_spot).toBe(0);
  });

  it('extreme routes recommend expert drivers', () => {
    const hazards: RouteSegmentHazard[] = [
      { fromKm: 0, toKm: 30, kind: 'blind_spot', severity: 'critical' },
      { fromKm: 30, toKm: 60, kind: 'steep_grade', severity: 'critical' },
      { fromKm: 60, toKm: 90, kind: 'no_signal_zone', severity: 'major' },
    ];
    const profile = buildRouteRiskProfile('r-extreme', points(100), hazards);
    expect(profile.category).toBe('extreme');
    expect(profile.recommendedDriverExperience).toBe('expert');
    expect(profile.recommendations.length).toBeGreaterThan(0);
    expect(profile.recommendations.some((r) => /convoy/i.test(r))).toBe(true);
  });

  it('school zones add a school-specific recommendation', () => {
    const profile = buildRouteRiskProfile('r-school', points(10), [
      { fromKm: 2, toKm: 4, kind: 'school_zone', severity: 'major' },
    ]);
    expect(profile.recommendations.some((r) => /escolar/i.test(r))).toBe(true);
  });

  it('no_signal_zone triggers radio-recommendation', () => {
    const profile = buildRouteRiskProfile('r-nosig', points(30), [
      { fromKm: 10, toKm: 20, kind: 'no_signal_zone', severity: 'major' },
    ]);
    expect(profile.recommendations.some((r) => /satelital|HF|VHF/i.test(r))).toBe(true);
  });

  it('long routes trigger fatigue/relevo recommendation', () => {
    const profile = buildRouteRiskProfile('r-long', points(250), [
      { fromKm: 0, toKm: 10, kind: 'high_traffic', severity: 'minor' },
    ]);
    expect(profile.recommendations.some((r) => /relevo/i.test(r))).toBe(true);
  });

  it('riskScore is bounded to 0-100', () => {
    // Construct an absurd set of hazards to force the bound.
    const hazards: RouteSegmentHazard[] = Array.from({ length: 20 }, (_, i) => ({
      fromKm: i * 5,
      toKm: i * 5 + 5,
      kind: 'blind_spot',
      severity: 'critical' as const,
    }));
    const profile = buildRouteRiskProfile('r-saturate', points(100), hazards);
    expect(profile.riskScore).toBeLessThanOrEqual(100);
    expect(profile.riskScore).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic — same inputs produce same outputs', () => {
    const hazards: RouteSegmentHazard[] = [
      { fromKm: 0, toKm: 5, kind: 'sharp_curve', severity: 'moderate' },
      { fromKm: 10, toKm: 15, kind: 'fatigue_zone', severity: 'major' },
    ];
    const a = buildRouteRiskProfile('r-det', points(40), hazards);
    const b = buildRouteRiskProfile('r-det', points(40), hazards);
    expect(a).toEqual(b);
  });

  it('preserves routeId in the output', () => {
    const profile = buildRouteRiskProfile('ruta-X', points(10), []);
    expect(profile.routeId).toBe('ruta-X');
  });

  it('reports totalKm from the points', () => {
    const profile = buildRouteRiskProfile('r1', points(73), []);
    expect(profile.totalKm).toBe(73);
  });
});
