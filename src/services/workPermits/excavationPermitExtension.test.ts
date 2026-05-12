import { describe, it, expect } from 'vitest';
import {
  validateExcavation,
  canAuthorizeExcavation,
  ExcavationValidationError,
  type ExcavationMetadata,
} from './excavationPermitExtension.js';

function meta(over: Partial<ExcavationMetadata> = {}): ExcavationMetadata {
  return {
    depthMeters: 1.0,
    slopeAngleDegrees: 60,
    hasShoring: false,
    soilType: 'tipoB',
    identifiedServices: [],
    accessKinds: ['escalera_portatil'],
    maxDistanceToAccessMeters: 5,
    ...over,
  };
}

describe('validateExcavation', () => {
  it('escenario normal poco profundo → autorizable', () => {
    const r = validateExcavation(meta());
    expect(canAuthorizeExcavation(r)).toBe(true);
  });

  it('profundidad >=1.5m sin entibación → block', () => {
    const r = validateExcavation(meta({ depthMeters: 2.0 }));
    expect(r.isShoringRequired).toBe(true);
    expect(canAuthorizeExcavation(r)).toBe(false);
    expect(r.issues.some((i) => i.code === 'BLOCK_NO_SHORING')).toBe(true);
  });

  it('profundidad >=1.5m con entibación → ok', () => {
    const r = validateExcavation(meta({ depthMeters: 2.0, hasShoring: true, atmosphereMeasurement: { o2Percent: 20.9, coPpm: 0, lel: 0 } }));
    expect(canAuthorizeExcavation(r)).toBe(true);
  });

  it('talud insuficiente sin entibación → block', () => {
    const r = validateExcavation(meta({ slopeAngleDegrees: 30, soilType: 'tipoB' }));
    expect(r.slopeIsCompliant).toBe(false);
    expect(canAuthorizeExcavation(r)).toBe(false);
  });

  it('profundidad >=1.2m sin medición atmosférica → block', () => {
    const r = validateExcavation(meta({ depthMeters: 1.3, hasShoring: true }));
    expect(r.isAtmosphereRequired).toBe(true);
    expect(r.isAtmosphereCompliant).toBe(false);
    expect(canAuthorizeExcavation(r)).toBe(false);
  });

  it('CO ppm alto → block', () => {
    const r = validateExcavation(
      meta({
        depthMeters: 1.5,
        hasShoring: true,
        atmosphereMeasurement: { o2Percent: 20.9, coPpm: 50, lel: 0 },
      }),
    );
    expect(canAuthorizeExcavation(r)).toBe(false);
    expect(r.issues.some((i) => i.code === 'BLOCK_CO_HIGH')).toBe(true);
  });

  it('servicios sin confirmar → warn', () => {
    const r = validateExcavation(
      meta({
        identifiedServices: [{ kind: 'electric', confirmed: false }],
      }),
    );
    expect(r.unconfirmedServicesCount).toBe(1);
    expect(r.issues.some((i) => i.code === 'WARN_UNCONFIRMED_SERVICES')).toBe(true);
    expect(canAuthorizeExcavation(r)).toBe(true); // warn no bloquea
  });

  it('lluvia >60% → warn soft block', () => {
    const r = validateExcavation(meta({ rainProbability24h: 80 }));
    expect(r.rainSoftBlock).toBe(true);
  });

  it('throws sin acceso', () => {
    expect(() => validateExcavation(meta({ accessKinds: [] }))).toThrow(ExcavationValidationError);
  });
});
