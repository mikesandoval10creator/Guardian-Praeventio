import { describe, it, expect } from 'vitest';
import {
  evaluateSplatQuality,
  buildCardinalPresets,
  buildEvacuationPathOverlay,
  buildMeetingPointOverlay,
  distance3d,
  pathLength,
  estimateEvacuationTimeSec,
  selectCanonicalCapture,
  type SplatCapture,
} from './gaussianSplatRegistry.js';

function capture(over: Partial<SplatCapture> & { id: string }): SplatCapture {
  return {
    id: over.id,
    projectId: 'p1',
    capturedAt: over.capturedAt ?? new Date().toISOString(),
    capturedByUid: 'u1',
    format: over.format ?? 'splat',
    storageUrl: 'gs://x/y.splat',
    sizeBytes: over.sizeBytes ?? 100 * 1024 * 1024, // 100MB
    splatCount: over.splatCount ?? 1_000_000,
    extentMeters: over.extentMeters ?? 100,
    centerCoords: { lat: -33.45, lng: -70.66 },
    isCanonical: over.isCanonical ?? false,
  };
}

describe('evaluateSplatQuality', () => {
  it('captura grande + reciente → excellent', () => {
    const r = evaluateSplatQuality(capture({ id: 'c1', splatCount: 3_000_000 }));
    expect(r.level).toBe('excellent');
    expect(r.isViewable).toBe(true);
  });

  it('captura muy dispersa <100k → low', () => {
    const r = evaluateSplatQuality(capture({ id: 'c1', splatCount: 50_000 }));
    expect(r.level).toBe('low');
    expect(r.issues.some((i) => /dispers/i.test(i))).toBe(true);
  });

  it('bundle >500MB → warning de móvil', () => {
    const r = evaluateSplatQuality(
      capture({ id: 'c1', sizeBytes: 700 * 1024 * 1024 }),
    );
    expect(r.issues.some((i) => /MB|móvil/i.test(i))).toBe(true);
  });

  it('extent >500m → warning baja densidad', () => {
    const r = evaluateSplatQuality(capture({ id: 'c1', extentMeters: 600 }));
    expect(r.issues.some((i) => /densidad/i.test(i))).toBe(true);
  });

  it('captura no viewable si <50k splats', () => {
    const r = evaluateSplatQuality(capture({ id: 'c1', splatCount: 30_000 }));
    expect(r.isViewable).toBe(false);
  });

  it('captura antigua >180d → warning', () => {
    const old = new Date(Date.now() - 200 * 86_400_000).toISOString();
    const r = evaluateSplatQuality(capture({ id: 'c1', capturedAt: old }));
    expect(r.issues.some((i) => /días|recapturar/i.test(i))).toBe(true);
  });
});

describe('buildCardinalPresets', () => {
  it('genera 5 presets (4 cardinales + cenital)', () => {
    const presets = buildCardinalPresets(100);
    expect(presets).toHaveLength(5);
    expect(presets.map((p) => p.id).sort()).toEqual(['east', 'north', 'south', 'top', 'west']);
  });

  it('preset cenital tiene altitud > extent', () => {
    const presets = buildCardinalPresets(100);
    const top = presets.find((p) => p.id === 'top')!;
    expect(top.position.y).toBeGreaterThan(100);
  });

  it('escala distancias según extent', () => {
    const small = buildCardinalPresets(10);
    const big = buildCardinalPresets(1000);
    const smallNorth = small.find((p) => p.id === 'north')!;
    const bigNorth = big.find((p) => p.id === 'north')!;
    expect(Math.abs(bigNorth.position.z)).toBeGreaterThan(Math.abs(smallNorth.position.z));
  });
});

describe('overlay builders', () => {
  it('buildEvacuationPathOverlay con color verde', () => {
    const o = buildEvacuationPathOverlay('ev1', [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ]);
    expect(o.kind).toBe('evacuation_path');
    expect(o.color).toBe('#10b981');
    expect(o.coords).toHaveLength(2);
  });

  it('buildMeetingPointOverlay con 1 coord', () => {
    const o = buildMeetingPointOverlay('mp1', { x: 5, y: 0, z: 5 }, 'Pto encuentro A');
    expect(o.kind).toBe('meeting_point');
    expect(o.coords).toHaveLength(1);
    expect(o.label).toBe('Pto encuentro A');
  });
});

describe('geometry helpers', () => {
  it('distance3d calcula correctamente', () => {
    expect(distance3d({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 })).toBe(5);
  });

  it('pathLength suma segmentos', () => {
    const path = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: 3, y: 0, z: 4 },
    ];
    expect(pathLength(path)).toBe(7);
  });

  it('estimateEvacuationTimeSec a 4.5 km/h', () => {
    // 100m / 1.25 m/s ≈ 80s
    expect(estimateEvacuationTimeSec(100)).toBe(80);
  });
});

describe('selectCanonicalCapture', () => {
  it('vacío → null + reason', () => {
    const r = selectCanonicalCapture([]);
    expect(r.capture).toBeNull();
    expect(r.reason).toMatch(/Sin capturas/i);
  });

  it('isCanonical flag tiene prioridad', () => {
    const r = selectCanonicalCapture([
      capture({ id: 'old', isCanonical: true, capturedAt: '2025-01-01T00:00:00Z' }),
      capture({ id: 'new', isCanonical: false }),
    ]);
    expect(r.capture?.id).toBe('old');
    expect(r.reason).toMatch(/canónica/i);
  });

  it('sin canonical → más reciente con quality good+', () => {
    const r = selectCanonicalCapture([
      capture({
        id: 'recent_excellent',
        capturedAt: new Date().toISOString(),
        splatCount: 3_000_000,
      }),
      capture({
        id: 'older_excellent',
        capturedAt: new Date(Date.now() - 100 * 86_400_000).toISOString(),
        splatCount: 2_500_000,
      }),
    ]);
    expect(r.capture?.id).toBe('recent_excellent');
  });

  it('todos baja calidad → último con explicación', () => {
    const r = selectCanonicalCapture([
      capture({
        id: 'poor',
        capturedAt: new Date().toISOString(),
        splatCount: 60_000,
      }),
    ]);
    expect(r.capture?.id).toBe('poor');
    expect(r.reason).toMatch(/calidad mínima|low/i);
  });
});
