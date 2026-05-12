import { describe, it, expect } from 'vitest';
import {
  validateLifting,
  canAuthorizeLifting,
  LiftingValidationError,
  type LiftingMetadata,
} from './liftingPermitExtension.js';

function meta(over: Partial<LiftingMetadata> = {}): LiftingMetadata {
  return {
    loadWeightKg: 5000,
    operationRadiusMeters: 10,
    craneRatedCapacityKg: 10000,
    craneId: 'g1',
    operatorUid: 'op',
    riggerUid: 'rg',
    signalerUid: 'sg',
    windSpeedMs: 5,
    reducedVisibility: false,
    exclusionZoneRadiusMeters: 15,
    ...over,
  };
}

describe('validateLifting', () => {
  it('escenario normal — autorizable', () => {
    const r = validateLifting(meta());
    expect(r.capacityUseRatio).toBeCloseTo(0.5);
    expect(canAuthorizeLifting(r)).toBe(true);
  });

  it('carga > capacidad nominal → block', () => {
    const r = validateLifting(meta({ loadWeightKg: 11000 }));
    expect(r.isOverCapacity).toBe(true);
    expect(canAuthorizeLifting(r)).toBe(false);
    expect(r.issues.some((i) => i.code === 'BLOCK_OVER_CAPACITY')).toBe(true);
  });

  it('carga 95% capacidad → warn cerca del límite', () => {
    const r = validateLifting(meta({ loadWeightKg: 9500 }));
    expect(r.isNearLimit).toBe(true);
    expect(canAuthorizeLifting(r)).toBe(true);
    expect(r.issues.some((i) => i.code === 'WARN_NEAR_LIMIT')).toBe(true);
  });

  it('viento >= 11 m/s → block', () => {
    const r = validateLifting(meta({ windSpeedMs: 12 }));
    expect(r.windExceedsLimit).toBe(true);
    expect(canAuthorizeLifting(r)).toBe(false);
  });

  it('señalero = operador → warn', () => {
    const r = validateLifting(meta({ signalerUid: 'op' }));
    expect(r.hasIndependentSignaler).toBe(false);
    expect(canAuthorizeLifting(r)).toBe(true); // warn no bloquea
    expect(r.issues.some((i) => i.code === 'WARN_SIGNALER_NOT_INDEPENDENT')).toBe(true);
  });

  it('zona exclusión < 120% radio → warn', () => {
    const r = validateLifting(meta({ exclusionZoneRadiusMeters: 10 }));
    expect(r.issues.some((i) => i.code === 'WARN_EXCLUSION_ZONE_SMALL')).toBe(true);
  });

  it('throws con datos inválidos', () => {
    expect(() => validateLifting(meta({ craneRatedCapacityKg: 0 }))).toThrow(LiftingValidationError);
    expect(() => validateLifting(meta({ loadWeightKg: 0 }))).toThrow(LiftingValidationError);
  });
});
