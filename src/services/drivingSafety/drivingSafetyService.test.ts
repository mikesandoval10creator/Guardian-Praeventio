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
  };
}

describe('computeDriverScore', () => {
  it('conductor limpio + experiencia → excellent', () => {
    const r = computeDriverScore(driver({ workerUid: 'd1' }), '2026-05-11T00:00:00Z');
    expect(r.level).toBe('excellent');
    expect(r.canOperate).toBe(true);
  });

  it('licencia vencida → bloqueado', () => {
    const r = computeDriverScore(
      driver({ workerUid: 'd1', licenseExpiresAt: '2026-04-01T00:00:00Z' }),
      '2026-05-11T00:00:00Z',
    );
    expect(r.canOperate).toBe(false);
    expect(r.safetyScore).toBe(0);
  });

  it('muchos incidentes → critical', () => {
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
});
