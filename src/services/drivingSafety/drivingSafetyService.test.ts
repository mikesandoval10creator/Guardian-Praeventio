import { describe, it, expect } from 'vitest';
import {
  computeDriverScore,
  scoreRouteRisk,
  canAssignDriverToRoute,
  type DriverProfile,
  type CriticalRoute,
} from './drivingSafetyService.js';

function driver(over: Partial<DriverProfile> & { workerUid: string }): DriverProfile {
  return {
    workerUid: over.workerUid,
    licenseClass: over.licenseClass ?? 'A4',
    licenseExpiresAt: over.licenseExpiresAt ?? '2027-01-01T00:00:00Z',
    yearsExperience: over.yearsExperience ?? 5,
    incidents12m: over.incidents12m ?? 0,
    speedingEvents30d: over.speedingEvents30d ?? 0,
    fatigueScore: over.fatigueScore ?? 0,
  };
}

describe('computeDriverScore', () => {
  it('conductor limpio + experiencia → excellent', async () => {
    const r = computeDriverScore(driver({ workerUid: 'd1' }), '2026-05-11T00:00:00Z');
    expect(r.level).toBe('excellent');
    expect(r.canOperate).toBe(true);
  });

  it('licencia vencida → bloqueado', async () => {
    const r = computeDriverScore(
      driver({ workerUid: 'd1', licenseExpiresAt: '2026-04-01T00:00:00Z' }),
      '2026-05-11T00:00:00Z',
    );
    expect(r.canOperate).toBe(false);
    expect(r.safetyScore).toBe(0);
  });

  it('muchos incidentes → critical', async () => {
    const r = computeDriverScore(
      driver({ workerUid: 'd1', incidents12m: 5 }),
      '2026-05-11T00:00:00Z',
    );
    expect(r.level).toBe('critical');
    expect(r.canOperate).toBe(false);
  });

  it('licencia próxima a vencer → blocker pero puede operar', () => {
    const r = computeDriverScore(
      driver({ workerUid: 'd1', licenseExpiresAt: '2026-05-25T00:00:00Z' }),
      '2026-05-11T00:00:00Z',
    );
    expect(r.blockers.some((b) => /vence/.test(b))).toBe(true);
  });
});

describe('scoreRouteRisk', () => {
  function route(over: Partial<CriticalRoute> & { id: string }): CriticalRoute {
    return {
      id: over.id,
      name: 'R',
      distanceKm: over.distanceKm ?? 50,
      hazards: over.hazards ?? [],
      recommendedMaxSpeedKmh: over.recommendedMaxSpeedKmh ?? 80,
    };
  }

  it('ruta sin hazards corta → low', () => {
    expect(scoreRouteRisk(route({ id: 'r1' })).level).toBe('low');
  });

  it('ruta con cliff + rockfall → high/extreme', () => {
    const r = scoreRouteRisk(route({ id: 'r1', hazards: ['cliff', 'rockfall'] }));
    expect(['high', 'extreme']).toContain(r.level);
  });

  it('distancia >200km añade riesgo', () => {
    const noLong = scoreRouteRisk(route({ id: 'a', distanceKm: 50, hazards: ['wildlife'] }));
    const long = scoreRouteRisk(route({ id: 'b', distanceKm: 250, hazards: ['wildlife'] }));
    expect(long.riskScore).toBeGreaterThan(noLong.riskScore);
  });
});

describe('canAssignDriverToRoute', () => {
  it('conductor excellent + ruta extreme → permitido', () => {
    const driverR = computeDriverScore(driver({ workerUid: 'd1' }), '2026-05-11T00:00:00Z');
    const routeR = scoreRouteRisk({
      id: 'r1',
      name: 'R',
      distanceKm: 250,
      hazards: ['cliff', 'rockfall', 'flood_zone'],
      recommendedMaxSpeedKmh: 40,
    });
    const a = canAssignDriverToRoute(driverR, routeR);
    expect(a.allowed).toBe(true);
  });

  it('conductor poor + ruta extreme → bloqueado', () => {
    const driverR = computeDriverScore(
      driver({ workerUid: 'd1', incidents12m: 3, speedingEvents30d: 8 }),
      '2026-05-11T00:00:00Z',
    );
    const routeR = scoreRouteRisk({
      id: 'r1',
      name: 'R',
      distanceKm: 50,
      hazards: ['cliff', 'rockfall'],
      recommendedMaxSpeedKmh: 30,
    });
    const a = canAssignDriverToRoute(driverR, routeR);
    expect(a.allowed).toBe(false);
  });

  it('conductor sin licencia → bloqueado siempre', () => {
    const driverR = computeDriverScore(
      driver({ workerUid: 'd1', licenseExpiresAt: '2026-01-01' }),
      '2026-05-11T00:00:00Z',
    );
    const routeR = scoreRouteRisk({
      id: 'r1',
      name: 'R',
      distanceKm: 10,
      hazards: [],
      recommendedMaxSpeedKmh: 50,
    });
    expect(canAssignDriverToRoute(driverR, routeR).allowed).toBe(false);
  });

  // [Hy3-audit] Adversarial probes — driver scoring with corrupt inputs.
  it('license expiry of INVALID STRING → score=0, blockers include "inválida", canOperate=false', () => {
    const r = computeDriverScore(
      driver({ workerUid: 'd1', licenseExpiresAt: 'not-a-date' }),
      '2026-05-11T00:00:00Z',
    );
    expect(r.safetyScore).toBe(0);
    expect(r.level).toBe('critical');
    expect(r.canOperate).toBe(false);
    expect(r.blockers.some((b) => /inválida|ausente/i.test(b))).toBe(true);
  });

  it('license expiry of EMPTY STRING → score=0, blocker present', () => {
    const r = computeDriverScore(
      driver({ workerUid: 'd1', licenseExpiresAt: '' }),
      '2026-05-11T00:00:00Z',
    );
    expect(r.safetyScore).toBe(0);
    expect(r.canOperate).toBe(false);
  });

  it('route with UNKNOWN hazard code → level=extreme (not low), riskScore=100', () => {
    // The legacy code indexed HAZARD_WEIGHT[h] for every h. An unknown
    // hazard returned undefined, made riskScore NaN, and the route fell
    // through to level='low'. The fix forces level=extreme.
    const r = scoreRouteRisk({
      id: 'r-unknown',
      name: 'R-Unknown',
      distanceKm: 5,
      hazards: ['lava_flow' as never], // not in HAZARD_WEIGHT
      recommendedMaxSpeedKmh: 30,
    });
    expect(r.level).toBe('extreme');
    expect(r.riskScore).toBe(100);
  });

  it('route with KNOWN + UNKNOWN hazards → still extreme (unknown dominates)', () => {
    const r = scoreRouteRisk({
      id: 'r-mixed',
      name: 'R-Mixed',
      distanceKm: 5,
      hazards: ['wildlife', 'lava_flow' as never],
      recommendedMaxSpeedKmh: 30,
    });
    expect(r.level).toBe('extreme');
  });
});

// [Hy3-audit] Fatigue-score adversarial probes. Resolves
// [Audit-2026-08-31] Driver score — fatigueScore se muestra pero no
// participa en safetyScore/canOperate. Before this fix, the StoredDrivingDriver
// had a fatigueScore field that the UI displayed and the route layer
// returned, but computeDriverScore ignored it. A driver with fatigueScore=80
// (very fatigued) would score the same as a driver with fatigueScore=0
// (well-rested) — a safety hazard for night-shift or post-incident dispatch.
describe('computeDriverScore — fatigueScore', () => {
  it('fatigueScore 0 (well-rested) → no penalty; score stays high', async () => {
    const r = computeDriverScore(
      driver({ workerUid: 'd1', fatigueScore: 0 }),
      '2026-05-11T00:00:00Z',
    );
    expect(r.safetyScore).toBeGreaterThanOrEqual(100); // capped at 100
    expect(r.canOperate).toBe(true);
  });

  it('fatigueScore 50 (moderate) → safetyScore drops below 100', async () => {
    const r = computeDriverScore(
      driver({ workerUid: 'd1', fatigueScore: 50 }),
      '2026-05-11T00:00:00Z',
    );
    // Without the fix this assertion would fail: safetyScore would be 110
    // (cap to 100), but the documented contract says fatigue must count.
    expect(r.safetyScore).toBeLessThan(100);
    expect(r.canOperate).toBe(true); // still operable but penalized
  });

  it('fatigueScore 90 (severe) → canOperate=false (BLOCKED — safety override)', async () => {
    const r = computeDriverScore(
      driver({ workerUid: 'd1', fatigueScore: 90 }),
      '2026-05-11T00:00:00Z',
    );
    expect(r.canOperate).toBe(false);
    expect(r.blockers.some((b) => /fatig|fatigue/i.test(b))).toBe(true);
  });

  it('fatigueScore out-of-range (negative or >100) → treated as 0 / 100 with a warn (NOT a 500)', async () => {
    // Defensive: a corrupt fatigue field must not crash the dispatcher.
    const r1 = computeDriverScore(
      driver({ workerUid: 'd1', fatigueScore: -50 }),
      '2026-05-11T00:00:00Z',
    );
    const r2 = computeDriverScore(
      driver({ workerUid: 'd1', fatigueScore: 9999 }),
      '2026-05-11T00:00:00Z',
    );
    expect(r1.canOperate).toBe(true); // -50 → 0 (well-rested)
    expect(r2.canOperate).toBe(false); // 9999 → 100 (severe = blocked)
  });

  it('fatigueScore 100 (max) combined with otherwise perfect profile → still blocked', async () => {
    const r = computeDriverScore(
      driver({ workerUid: 'd1', fatigueScore: 100, yearsExperience: 10 }),
      '2026-05-11T00:00:00Z',
    );
    // A perfectly experienced driver who is critically fatigued MUST be
    // blocked — the override has to override the experience bonus.
    expect(r.canOperate).toBe(false);
    expect(r.safetyScore).toBe(0);
  });
});
