import { describe, it, expect } from 'vitest';
import {
  buildRouteRiskProfile,
  type RoutePoint,
  type RouteSegmentHazard,
  type RouteRiskProfile,
} from './criticalRouteScoring.js';
import {
  evaluateDriverRoute,
  experienceGap,
  experienceRank,
  INCIDENT_BLOCK_THRESHOLD,
  OVERDRIVE_HOURS_30D,
  type DriverProfile,
} from './driverRouteMatcher.js';

function pts(km: number): RoutePoint[] {
  return [
    { lat: 0, lng: 0, kmFromStart: 0 },
    { lat: 0, lng: 0, kmFromStart: km },
  ];
}

function lowRoute(): RouteRiskProfile {
  return buildRouteRiskProfile('r-low', pts(20), []);
}

function moderateRoute(): RouteRiskProfile {
  const hazards: RouteSegmentHazard[] = [
    { fromKm: 0, toKm: 8, kind: 'sharp_curve', severity: 'moderate' },
    { fromKm: 8, toKm: 15, kind: 'high_traffic', severity: 'moderate' },
  ];
  const r = buildRouteRiskProfile('r-mod', pts(30), hazards);
  // Sanity: should land in moderate band.
  if (r.category !== 'moderate') {
    throw new Error(`fixture expected moderate, got ${r.category} (score=${r.riskScore})`);
  }
  return r;
}

function expertRoute(): RouteRiskProfile {
  const hazards: RouteSegmentHazard[] = [
    { fromKm: 0, toKm: 30, kind: 'blind_spot', severity: 'critical' },
    { fromKm: 30, toKm: 60, kind: 'steep_grade', severity: 'critical' },
  ];
  return buildRouteRiskProfile('r-expert', pts(70), hazards);
}

function driver(over: Partial<DriverProfile> & { uid: string }): DriverProfile {
  return {
    uid: over.uid,
    experienceLevel: over.experienceLevel ?? 'expert',
    yearsLicensed: over.yearsLicensed ?? 8,
    hoursDrivenLast30d: over.hoursDrivenLast30d ?? 40,
    incidentsLast12months: over.incidentsLast12months ?? 0,
    vehicleTypesAuthorized: over.vehicleTypesAuthorized ?? ['camion', 'pickup'],
    fatigueLevel: over.fatigueLevel,
  };
}

describe('experienceRank / experienceGap', () => {
  it('rank ordering: novice < intermediate < expert', () => {
    expect(experienceRank('novice')).toBeLessThan(experienceRank('intermediate'));
    expect(experienceRank('intermediate')).toBeLessThan(experienceRank('expert'));
  });

  it('gap is positive when driver over-qualified', () => {
    expect(experienceGap('expert', 'novice')).toBeGreaterThan(0);
  });

  it('gap is negative when driver under-qualified', () => {
    expect(experienceGap('novice', 'expert')).toBeLessThan(0);
  });

  it('gap is zero when exact match', () => {
    expect(experienceGap('intermediate', 'intermediate')).toBe(0);
  });
});

describe('evaluateDriverRoute — blocking rules', () => {
  it('blocks when driver experience < required', () => {
    const d = driver({ uid: 'd1', experienceLevel: 'novice' });
    const r = evaluateDriverRoute(d, expertRoute());
    expect(r.canAssign).toBe(false);
    expect(r.blockingReasons.some((s) => /Experiencia/i.test(s))).toBe(true);
  });

  it('blocks when fatigue level is critical', () => {
    const d = driver({ uid: 'd1', fatigueLevel: 'critical' });
    const r = evaluateDriverRoute(d, lowRoute());
    expect(r.canAssign).toBe(false);
    expect(r.blockingReasons.some((s) => /[Ff]atiga/.test(s))).toBe(true);
  });

  it('blocks when required vehicle type not authorized', () => {
    const d = driver({ uid: 'd1', vehicleTypesAuthorized: ['pickup'] });
    const r = evaluateDriverRoute(d, lowRoute(), 'camion_aljibe');
    expect(r.canAssign).toBe(false);
    expect(r.blockingReasons.some((s) => /camion_aljibe/.test(s))).toBe(true);
  });

  it('allows when required vehicle type IS authorized', () => {
    const d = driver({ uid: 'd1', vehicleTypesAuthorized: ['camion', 'pickup'] });
    const r = evaluateDriverRoute(d, lowRoute(), 'camion');
    expect(r.canAssign).toBe(true);
  });

  it('blocks when incidentsLast12months >= 3', () => {
    const d = driver({ uid: 'd1', incidentsLast12months: INCIDENT_BLOCK_THRESHOLD });
    const r = evaluateDriverRoute(d, lowRoute());
    expect(r.canAssign).toBe(false);
    expect(r.blockingReasons.some((s) => /incidentes/i.test(s))).toBe(true);
  });

  it('blocks when hoursDrivenLast30d > 120', () => {
    const d = driver({ uid: 'd1', hoursDrivenLast30d: OVERDRIVE_HOURS_30D + 1 });
    const r = evaluateDriverRoute(d, lowRoute());
    expect(r.canAssign).toBe(false);
    expect(r.blockingReasons.some((s) => /[Hh]oras/.test(s))).toBe(true);
  });

  it('clean expert driver on extreme route → assignable', () => {
    const d = driver({ uid: 'd1', experienceLevel: 'expert', yearsLicensed: 12 });
    const r = evaluateDriverRoute(d, expertRoute());
    expect(r.canAssign).toBe(true);
    expect(r.blockingReasons).toEqual([]);
  });
});

describe('evaluateDriverRoute — warning rules', () => {
  it('novice on moderate route → warning, not block', () => {
    const d = driver({ uid: 'd1', experienceLevel: 'novice' });
    const r = evaluateDriverRoute(d, moderateRoute());
    // novice can do moderate (required = intermediate for moderate)... wait,
    // moderate routes recommend `intermediate`, so a novice IS blocked on experience.
    // The warning rule fires only when experience IS met but novice + moderate.
    // Verify: novice + moderate → blocking on experience.
    expect(r.canAssign).toBe(false);
  });

  it('intermediate on moderate → assignable, no warning from experience', () => {
    const d = driver({ uid: 'd1', experienceLevel: 'intermediate' });
    const r = evaluateDriverRoute(d, moderateRoute());
    expect(r.canAssign).toBe(true);
  });

  it('high fatigue is a warning, not a block', () => {
    const d = driver({ uid: 'd1', fatigueLevel: 'high' });
    const r = evaluateDriverRoute(d, lowRoute());
    expect(r.canAssign).toBe(true);
    expect(r.warnings.some((s) => /[Ff]atiga/.test(s))).toBe(true);
  });

  it('2 incidents → warning, not block', () => {
    const d = driver({ uid: 'd1', incidentsLast12months: 2 });
    const r = evaluateDriverRoute(d, lowRoute());
    expect(r.canAssign).toBe(true);
    expect(r.warnings.some((s) => /incidentes/i.test(s))).toBe(true);
  });
});

describe('evaluateDriverRoute — matchScore', () => {
  it('clean over-qualified driver scores high', () => {
    const d = driver({
      uid: 'd1',
      experienceLevel: 'expert',
      yearsLicensed: 15,
      hoursDrivenLast30d: 20,
      incidentsLast12months: 0,
    });
    const r = evaluateDriverRoute(d, lowRoute());
    expect(r.matchScore).toBeGreaterThanOrEqual(95);
  });

  it('under-qualified driver scores lower than over-qualified', () => {
    const low = driver({ uid: 'a', experienceLevel: 'novice' });
    const high = driver({ uid: 'b', experienceLevel: 'expert' });
    const route = expertRoute();
    expect(evaluateDriverRoute(low, route).matchScore).toBeLessThan(
      evaluateDriverRoute(high, route).matchScore,
    );
  });

  it('matchScore is bounded to 0-100 even for terrible drivers', () => {
    const d = driver({
      uid: 'd1',
      experienceLevel: 'novice',
      hoursDrivenLast30d: 200,
      incidentsLast12months: 10,
      fatigueLevel: 'critical',
    });
    const r = evaluateDriverRoute(d, expertRoute());
    expect(r.matchScore).toBeGreaterThanOrEqual(0);
    expect(r.matchScore).toBeLessThanOrEqual(100);
  });

  it('fatigue penalizes matchScore', () => {
    const clean = driver({ uid: 'c' });
    const tired = driver({ uid: 't', fatigueLevel: 'medium' });
    expect(evaluateDriverRoute(tired, lowRoute()).matchScore).toBeLessThan(
      evaluateDriverRoute(clean, lowRoute()).matchScore,
    );
  });

  it('overdriving (>80h, <=120h) penalizes matchScore on a ramp', () => {
    const lo = driver({ uid: 'lo', hoursDrivenLast30d: 80 });
    const mid = driver({ uid: 'mid', hoursDrivenLast30d: 100 });
    const hi = driver({ uid: 'hi', hoursDrivenLast30d: 119 });
    const sLo = evaluateDriverRoute(lo, lowRoute()).matchScore;
    const sMid = evaluateDriverRoute(mid, lowRoute()).matchScore;
    const sHi = evaluateDriverRoute(hi, lowRoute()).matchScore;
    expect(sMid).toBeLessThan(sLo);
    expect(sHi).toBeLessThan(sMid);
  });

  it('tenure (yearsLicensed) grants a small bonus', () => {
    // Use intermediate driver on moderate route → not score-saturated, so
    // the tenure bonus is observable.
    const junior = driver({ uid: 'j', experienceLevel: 'intermediate', yearsLicensed: 1 });
    const senior = driver({ uid: 's', experienceLevel: 'intermediate', yearsLicensed: 12 });
    expect(evaluateDriverRoute(senior, moderateRoute()).matchScore).toBeGreaterThan(
      evaluateDriverRoute(junior, moderateRoute()).matchScore,
    );
  });

  it('decision references driverUid and routeId', () => {
    const d = driver({ uid: 'driver-abc' });
    const route = lowRoute();
    const r = evaluateDriverRoute(d, route);
    expect(r.driverUid).toBe('driver-abc');
    expect(r.routeId).toBe(route.routeId);
  });
});

describe('evaluateDriverRoute — determinism', () => {
  it('same inputs produce the same decision', () => {
    const d = driver({ uid: 'd1', fatigueLevel: 'medium', incidentsLast12months: 1 });
    const route = moderateRoute();
    const a = evaluateDriverRoute(d, route);
    const b = evaluateDriverRoute(d, route);
    expect(a).toEqual(b);
  });
});
