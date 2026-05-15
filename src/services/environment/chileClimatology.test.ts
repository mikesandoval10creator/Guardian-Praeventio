// Tests para climatología chilena (Regla #3 — funciona REAL).

import { describe, it, expect } from 'vitest';
import {
  classifyClimateZone,
  getClimatologyForecast,
} from './chileClimatology';

describe('classifyClimateZone', () => {
  it('Antofagasta → norte_arido', () => {
    expect(classifyClimateZone(-23.65, -70.4)).toBe('norte_arido');
  });

  it('La Serena → norte_chico', () => {
    expect(classifyClimateZone(-29.9, -71.25)).toBe('norte_chico');
  });

  it('Santiago → central', () => {
    expect(classifyClimateZone(-33.45, -70.65)).toBe('central');
  });

  it('Temuco → sur', () => {
    expect(classifyClimateZone(-38.74, -72.59)).toBe('sur');
  });

  it('Torres del Paine → austral', () => {
    expect(classifyClimateZone(-51.0, -73.0)).toBe('austral');
  });

  it('Isla de Pascua → isla_pascua', () => {
    expect(classifyClimateZone(-27.1, -109.4)).toBe('isla_pascua');
  });

  it('Altiplano (San Pedro de Atacama altura) → altiplano', () => {
    expect(classifyClimateZone(-23.0, -68.0)).toBe('altiplano');
  });
});

describe('getClimatologyForecast', () => {
  it('devuelve N días determinísticos para Torres del Paine en julio (frío)', () => {
    const forecast = getClimatologyForecast(
      -51.0,
      -73.0,
      3,
      new Date('2026-07-15T00:00:00Z'),
    );
    expect(forecast).toHaveLength(3);
    // Torres del Paine en julio (invierno): tempMean ~0°C, viento fuerte
    expect(forecast[0].tempMinC).toBeLessThan(5);
    expect(forecast[0].tempMaxC).toBeLessThan(10);
    expect(forecast[0].windKmh).toBeGreaterThan(20); // Patagonia ventosa siempre
  });

  it('devuelve días determinísticos para Atacama en enero (caluroso seco)', () => {
    const forecast = getClimatologyForecast(
      -24.0,
      -70.0,
      3,
      new Date('2026-01-15T00:00:00Z'),
    );
    expect(forecast).toHaveLength(3);
    expect(forecast[0].tempMaxC).toBeGreaterThan(25);
    expect(forecast[0].precipMm).toBe(0); // desierto absoluto
  });

  it('mismo input produce mismo output (determinístico)', () => {
    const a = getClimatologyForecast(-33.45, -70.65, 5, new Date('2026-04-10T00:00:00Z'));
    const b = getClimatologyForecast(-33.45, -70.65, 5, new Date('2026-04-10T00:00:00Z'));
    expect(a).toEqual(b);
  });

  it('marca source: climatology para que el caller distinga del feed real', () => {
    const f = getClimatologyForecast(-33.45, -70.65, 1);
    expect(f[0].source).toBe('climatology');
  });

  it('clamp days a [1, 7]', () => {
    expect(getClimatologyForecast(-33, -71, 0)).toHaveLength(0);
    expect(getClimatologyForecast(-33, -71, 100)).toHaveLength(7);
  });

  it('Tmax > Tmin siempre', () => {
    const f = getClimatologyForecast(-33.45, -70.65, 5);
    for (const day of f) {
      expect(day.tempMaxC).toBeGreaterThan(day.tempMinC);
    }
  });

  it('Magallanes en invierno → snow', () => {
    const f = getClimatologyForecast(
      -53.0,
      -71.0,
      1,
      new Date('2026-07-01T00:00:00Z'),
    );
    expect(f[0].condition).toBe('snow');
  });

  it('Norte árido → siempre sunny', () => {
    for (let month = 0; month < 12; month++) {
      const date = new Date(2026, month, 15);
      const f = getClimatologyForecast(-23.65, -70.4, 1, date);
      expect(f[0].condition).toBe('sunny');
    }
  });

  it('Sur lluvioso en invierno → precipMm > 5', () => {
    const f = getClimatologyForecast(
      -41.5,
      -73.0,
      1,
      new Date('2026-06-15T00:00:00Z'),
    );
    expect(f[0].precipMm).toBeGreaterThan(5);
  });
});
