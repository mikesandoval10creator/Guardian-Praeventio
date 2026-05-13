import { describe, it, expect } from 'vitest';
import {
  buildArScenePlan,
  haversineMeters,
  type ArRiskNode,
  type GeoPosition,
} from './arSceneOrchestrator.js';

// Santiago Centro
const USER: GeoPosition = { lat: -33.4489, lng: -70.6693, altMeters: 540 };

function risk(over: Partial<ArRiskNode> & { id: string; geo: GeoPosition }): ArRiskNode {
  return {
    severity: 'medium',
    label: 'Riesgo X',
    kind: 'fall',
    ...over,
  };
}

describe('haversineMeters', () => {
  it('0 cuando es el mismo punto', () => {
    expect(haversineMeters(USER, USER)).toBe(0);
  });

  it('~111km por grado de latitud', () => {
    const a: GeoPosition = { lat: 0, lng: 0 };
    const b: GeoPosition = { lat: 1, lng: 0 };
    const d = haversineMeters(a, b);
    // ~111195m (verdadero ~111319m)
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('buildArScenePlan', () => {
  it('filtra fuera de rango (>200m default)', () => {
    const farLat = USER.lat + 0.01; // ~1.1km
    const plan = buildArScenePlan(USER, 0, [
      risk({ id: 'a', geo: { lat: USER.lat + 0.0001, lng: USER.lng } }),
      risk({ id: 'b', geo: { lat: farLat, lng: USER.lng } }),
    ]);
    expect(plan.markers.map((m) => m.id)).toContain('a');
    expect(plan.markers.map((m) => m.id)).not.toContain('b');
    expect(plan.stats.skippedOutOfRange).toBe(1);
  });

  it('respeta maxMarkers cap', () => {
    // Spread risks dentro del rango 200m: 30 puntos cada 5m (lat offset ~0.00005)
    const risks = Array.from({ length: 30 }, (_, i) =>
      risk({
        id: `r-${i}`,
        geo: { lat: USER.lat + (i + 1) * 0.00005, lng: USER.lng },
      }),
    );
    const plan = buildArScenePlan(USER, 0, risks, { maxMarkers: 10 });
    expect(plan.markers).toHaveLength(10);
    expect(plan.stats.rendered).toBe(10);
    expect(plan.stats.skippedOverCap).toBeGreaterThan(0);
  });

  it('criticalOnly omite low/medium', () => {
    const plan = buildArScenePlan(
      USER,
      0,
      [
        risk({ id: 'lo', geo: USER, severity: 'low' }),
        risk({ id: 'md', geo: USER, severity: 'medium' }),
        risk({ id: 'hi', geo: USER, severity: 'high' }),
        risk({ id: 'cr', geo: USER, severity: 'critical' }),
      ],
      { criticalOnly: true },
    );
    expect(plan.markers.map((m) => m.id)).toEqual(['cr', 'hi']);
    expect(plan.stats.skippedSeverityFilter).toBe(2);
  });

  it('orden por severity desc + distance asc', () => {
    const plan = buildArScenePlan(USER, 0, [
      risk({ id: 'lo-close', geo: USER, severity: 'low' }),
      risk({ id: 'sif-far', geo: { lat: USER.lat + 0.0009, lng: USER.lng }, severity: 'sif' }),
      risk({ id: 'sif-close', geo: USER, severity: 'sif' }),
    ]);
    expect(plan.markers[0]!.id).toBe('sif-close');
    expect(plan.markers[1]!.id).toBe('sif-far');
    expect(plan.markers[2]!.id).toBe('lo-close');
  });

  it('color es severity-aware', () => {
    const plan = buildArScenePlan(USER, 0, [
      risk({ id: 'a', geo: USER, severity: 'critical' }),
      risk({ id: 'b', geo: USER, severity: 'low' }),
    ]);
    const crit = plan.markers.find((m) => m.id === 'a')!;
    const low = plan.markers.find((m) => m.id === 'b')!;
    expect(crit.color).not.toBe(low.color);
  });

  it('localOffset.east positivo cuando riesgo está al este', () => {
    const plan = buildArScenePlan(USER, 0, [
      risk({ id: 'east', geo: { lat: USER.lat, lng: USER.lng + 0.001 } }),
    ]);
    expect(plan.markers[0]!.localOffset.east).toBeGreaterThan(0);
  });

  it('localOffset.north positivo cuando riesgo está al norte', () => {
    const plan = buildArScenePlan(USER, 0, [
      risk({ id: 'north', geo: { lat: USER.lat + 0.001, lng: USER.lng } }),
    ]);
    expect(plan.markers[0]!.localOffset.north).toBeGreaterThan(0);
  });

  it('scale decrece con distancia', () => {
    const plan = buildArScenePlan(USER, 0, [
      risk({ id: 'close', geo: USER }),
      risk({ id: 'far', geo: { lat: USER.lat + 0.001, lng: USER.lng } }),
    ]);
    const close = plan.markers.find((m) => m.id === 'close')!;
    const far = plan.markers.find((m) => m.id === 'far')!;
    expect(close.scale).toBeGreaterThan(far.scale);
  });

  it('outOfFov true para riesgos detrás del usuario', () => {
    // Usuario mirando al norte (heading=0). Riesgo al sur (lat menor) → atrás.
    const plan = buildArScenePlan(USER, 0, [
      risk({ id: 'behind', geo: { lat: USER.lat - 0.001, lng: USER.lng } }),
    ]);
    expect(plan.markers[0]!.outOfFov).toBe(true);
  });

  it('outOfFov false para riesgos al frente del usuario', () => {
    const plan = buildArScenePlan(USER, 0, [
      risk({ id: 'ahead', geo: { lat: USER.lat + 0.001, lng: USER.lng } }),
    ]);
    expect(plan.markers[0]!.outOfFov).toBe(false);
  });

  it('lista vacía → markers vacíos', () => {
    const plan = buildArScenePlan(USER, 0, []);
    expect(plan.markers).toHaveLength(0);
    expect(plan.stats.inputCount).toBe(0);
  });
});
