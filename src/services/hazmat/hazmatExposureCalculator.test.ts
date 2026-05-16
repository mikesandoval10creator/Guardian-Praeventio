import { describe, it, expect } from 'vitest';
import {
  computeExposureDistances,
  estimatePlumeConeDegrees,
  periodFromDate,
  type HazmatClass,
} from './hazmatExposureCalculator.js';

describe('computeExposureDistances', () => {
  it('Class 2.1 (flammable gas) small day usa Guide 115', () => {
    const r = computeExposureDistances('class_2_1', 'small', 'day');
    expect(r.initialIsolationRadiusM).toBe(30);
    expect(r.protectiveActionDistanceM).toBe(100);
    expect(r.reference).toContain('Guide 115');
  });

  it('Class 2.1 large NIGHT dobla la protective distance vs día', () => {
    const day = computeExposureDistances('class_2_1', 'large', 'day');
    const night = computeExposureDistances('class_2_1', 'large', 'night');
    expect(night.protectiveActionDistanceM).toBeGreaterThan(day.protectiveActionDistanceM);
  });

  it('Class 2.3 (TIH) tiene MUCHO mayor protective distance que Class 9', () => {
    const tih = computeExposureDistances('class_2_3', 'large', 'night');
    const misc = computeExposureDistances('class_9', 'large', 'night');
    expect(tih.protectiveActionDistanceM).toBeGreaterThan(misc.protectiveActionDistanceM * 10);
  });

  it('Class 8 (corrosive) large day → 50m isolation, 200m protección', () => {
    const r = computeExposureDistances('class_8', 'large', 'day');
    expect(r.initialIsolationRadiusM).toBe(50);
    expect(r.protectiveActionDistanceM).toBe(200);
    expect(r.reference).toContain('Guide 154');
  });

  it('unknown class fail-closed: usa conservador TIH-like', () => {
    const r = computeExposureDistances('unknown', 'large', 'night');
    expect(r.initialIsolationRadiusM).toBeGreaterThanOrEqual(800);
    expect(r.protectiveActionDistanceM).toBeGreaterThanOrEqual(8000);
    expect(r.reference).toContain('FALLBACK');
  });

  it('cada resultado incluye disclaimer GRE', () => {
    const classes: HazmatClass[] = ['class_1', 'class_3', 'class_6_1', 'class_7'];
    for (const c of classes) {
      const r = computeExposureDistances(c, 'small', 'day');
      expect(r.disclaimer).toContain('GRE 2024');
    }
  });

  it('night ≥ day para todas las clases con dispersión (excepto Class 1 explosivos = igual)', () => {
    const classesConDispersion: HazmatClass[] = [
      'class_2_1',
      'class_2_2',
      'class_2_3',
      'class_3',
      'class_4',
      'class_5',
      'class_6_1',
      'class_8',
    ];
    for (const c of classesConDispersion) {
      const day = computeExposureDistances(c, 'large', 'day');
      const night = computeExposureDistances(c, 'large', 'night');
      expect(night.protectiveActionDistanceM).toBeGreaterThanOrEqual(
        day.protectiveActionDistanceM,
      );
    }
  });
});

describe('estimatePlumeConeDegrees', () => {
  it('viento <5 km/h → cono ancho 30°', () => {
    expect(estimatePlumeConeDegrees(2)).toBe(30);
  });

  it('viento 5-15 km/h → cono 20°', () => {
    expect(estimatePlumeConeDegrees(10)).toBe(20);
  });

  it('viento 15-30 km/h → cono 12°', () => {
    expect(estimatePlumeConeDegrees(20)).toBe(12);
  });

  it('viento >30 km/h → cono estrecho 8°', () => {
    expect(estimatePlumeConeDegrees(40)).toBe(8);
  });

  it('viento 0 o inválido → cono ancho 30° (sin dirección clara)', () => {
    expect(estimatePlumeConeDegrees(0)).toBe(30);
    expect(estimatePlumeConeDegrees(NaN)).toBe(30);
    expect(estimatePlumeConeDegrees(-5)).toBe(30);
  });
});

describe('periodFromDate', () => {
  it('06:00 → night (hora local)', () => {
    expect(periodFromDate(new Date('2026-05-15T06:00:00'))).toBe('night');
  });

  it('07:00 → day', () => {
    expect(periodFromDate(new Date('2026-05-15T07:00:00'))).toBe('day');
  });

  it('14:00 → day', () => {
    expect(periodFromDate(new Date('2026-05-15T14:00:00'))).toBe('day');
  });

  it('18:59 → day', () => {
    expect(periodFromDate(new Date('2026-05-15T18:59:00'))).toBe('day');
  });

  it('19:00 → night', () => {
    expect(periodFromDate(new Date('2026-05-15T19:00:00'))).toBe('night');
  });

  it('23:30 → night', () => {
    expect(periodFromDate(new Date('2026-05-15T23:30:00'))).toBe('night');
  });
});
