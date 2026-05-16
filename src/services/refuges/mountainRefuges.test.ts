import { describe, it, expect } from 'vitest';
import {
  findNearestRefuges,
  haversineKm,
  refugeAvailability,
  MOUNTAIN_REFUGES_CHILE,
} from './mountainRefuges.js';

describe('haversineKm', () => {
  it('Santiago a Concepción ≈ 410-440 km (Haversine sin ajuste elipsoide)', () => {
    const d = haversineKm(-33.45, -70.6667, -36.8201, -73.0444);
    expect(d).toBeGreaterThan(400);
    expect(d).toBeLessThan(500);
  });

  it('mismo punto → 0 km', () => {
    expect(haversineKm(-33.45, -70.66, -33.45, -70.66)).toBe(0);
  });

  it('distancia razonable entre Santiago y Pucón (~600 km)', () => {
    const d = haversineKm(-33.45, -70.6667, -39.27, -71.95);
    expect(d).toBeGreaterThan(550);
    expect(d).toBeLessThan(750);
  });
});

describe('findNearestRefuges', () => {
  it('desde Santiago retorna refugios centrales primero', () => {
    const list = findNearestRefuges(-33.45, -70.6667, { count: 3 });
    expect(list.length).toBe(3);
    // El primero debería ser uno de los refugios centrales
    expect(list[0]?.region).toBe('central');
  });

  it('respeta el count solicitado', () => {
    const list = findNearestRefuges(-33.45, -70.6667, { count: 5 });
    expect(list.length).toBe(5);
  });

  it('filtra por región', () => {
    const list = findNearestRefuges(-33.45, -70.6667, {
      count: 10,
      region: 'austral',
    });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((r) => r.region === 'austral')).toBe(true);
  });

  it('filtra por requireYearRound', () => {
    const list = findNearestRefuges(-33.45, -70.6667, {
      count: 10,
      requireYearRound: true,
    });
    expect(list.every((r) => r.season === 'year_round')).toBe(true);
  });

  it('ordena por distancia ascendente', () => {
    const list = findNearestRefuges(-33.45, -70.6667, { count: 5 });
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1]!.distanceKm;
      const curr = list[i]!.distanceKm;
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it('cada resultado incluye distanceKm computado', () => {
    const list = findNearestRefuges(-33.45, -70.6667, { count: 3 });
    for (const r of list) {
      expect(r.distanceKm).toBeGreaterThan(0);
      expect(Number.isFinite(r.distanceKm)).toBe(true);
    }
  });
});

describe('refugeAvailability', () => {
  it('year_round siempre open', () => {
    const enero = new Date('2026-01-15');
    const julio = new Date('2026-07-15');
    expect(refugeAvailability({ season: 'year_round' }, enero)).toBe('open');
    expect(refugeAvailability({ season: 'year_round' }, julio)).toBe('open');
  });

  it('closed siempre cerrado', () => {
    expect(refugeAvailability({ season: 'closed' }, new Date())).toBe('closed');
  });

  it('summer_only abierto en verano austral (dic-feb)', () => {
    expect(refugeAvailability({ season: 'summer_only' }, new Date('2026-01-15'))).toBe('open');
    expect(refugeAvailability({ season: 'summer_only' }, new Date('2026-12-15'))).toBe('open');
  });

  it('summer_only cerrado en invierno austral (jun-ago)', () => {
    expect(refugeAvailability({ season: 'summer_only' }, new Date('2026-07-15'))).toBe('closed');
  });

  it('spring_summer_autumn cerrado solo en invierno', () => {
    expect(refugeAvailability({ season: 'spring_summer_autumn' }, new Date('2026-01-15'))).toBe('open');
    expect(refugeAvailability({ season: 'spring_summer_autumn' }, new Date('2026-07-15'))).toBe('closed');
    expect(refugeAvailability({ season: 'spring_summer_autumn' }, new Date('2026-10-15'))).toBe('open');
  });

  it('winter_only abierto solo en invierno', () => {
    expect(refugeAvailability({ season: 'winter_only' }, new Date('2026-07-15'))).toBe('open');
    expect(refugeAvailability({ season: 'winter_only' }, new Date('2026-01-15'))).toBe('closed');
  });
});

describe('MOUNTAIN_REFUGES_CHILE catálogo', () => {
  it('tiene al menos 8 refugios documentados', () => {
    expect(MOUNTAIN_REFUGES_CHILE.length).toBeGreaterThanOrEqual(8);
  });

  it('todos tienen coordenadas válidas (Chile: -56 a -17 lat, -76 a -66 lng)', () => {
    for (const r of MOUNTAIN_REFUGES_CHILE) {
      expect(r.lat).toBeGreaterThan(-56);
      expect(r.lat).toBeLessThan(-17);
      expect(r.lng).toBeGreaterThan(-76);
      expect(r.lng).toBeLessThan(-66);
    }
  });

  it('todos tienen capacidad > 0 y elevation > 0', () => {
    for (const r of MOUNTAIN_REFUGES_CHILE) {
      expect(r.capacity).toBeGreaterThan(0);
      expect(r.elevationM).toBeGreaterThanOrEqual(0);
    }
  });

  it('cubre múltiples regiones', () => {
    const regions = new Set(MOUNTAIN_REFUGES_CHILE.map((r) => r.region));
    expect(regions.size).toBeGreaterThanOrEqual(4);
  });
});
