/**
 * Tests for GPS-based country detection helpers.
 *
 * Pure-function TDD: bounding-box approximations from public country bbox data
 * (see src/services/normativa/locationNormativa.ts header for source citation).
 */
import { describe, expect, it } from 'vitest';
import {
  countryFromCoords,
  countryFromLanguage,
} from './locationNormativa';

describe('countryFromCoords — capital-city sanity checks', () => {
  it('Santiago de Chile → CL', () => {
    expect(countryFromCoords(-33.45, -70.66)).toBe('CL');
  });

  it('Lima → PE', () => {
    expect(countryFromCoords(-12.05, -77.04)).toBe('PE');
  });

  it('Bogotá → CO', () => {
    expect(countryFromCoords(4.71, -74.07)).toBe('CO');
  });

  it('CDMX → MX', () => {
    expect(countryFromCoords(19.43, -99.13)).toBe('MX');
  });

  it('Buenos Aires → AR', () => {
    expect(countryFromCoords(-34.61, -58.38)).toBe('AR');
  });

  it('São Paulo → BR', () => {
    expect(countryFromCoords(-23.55, -46.63)).toBe('BR');
  });

  it('Paris (out of LATAM bbox) → null', () => {
    expect(countryFromCoords(48.86, 2.35)).toBeNull();
  });

  it('NaN coordinates → null (documented behavior)', () => {
    expect(countryFromCoords(NaN, NaN)).toBeNull();
  });
});

describe('countryFromLanguage — navigator.language fallback', () => {
  it('es-CL → CL', () => {
    expect(countryFromLanguage('es-CL')).toBe('CL');
  });

  it('pt-BR → BR', () => {
    expect(countryFromLanguage('pt-BR')).toBe('BR');
  });

  it('en-US → ISO (fallback)', () => {
    expect(countryFromLanguage('en-US')).toBe('ISO');
  });

  it('undefined locale → ISO', () => {
    expect(countryFromLanguage(undefined as unknown as string)).toBe('ISO');
  });
});
