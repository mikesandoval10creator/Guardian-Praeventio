import { describe, it, expect } from 'vitest';
import { calculateMifflinStJeor, estimateCurrentBurn } from './metabolicRate';

describe('calculateMifflinStJeor (Mifflin-St Jeor BMR)', () => {
  it('matches the canonical male example (Mifflin 1990): 80 kg, 180 cm, 30 y → 1780 kcal', () => {
    // 10*80 + 6.25*180 − 5*30 + 5 = 800 + 1125 − 150 + 5 = 1780
    expect(calculateMifflinStJeor({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' })).toBe(1780);
  });

  it('matches the canonical female example: 60 kg, 165 cm, 30 y → 1320 kcal (rounded)', () => {
    // 10*60 + 6.25*165 − 5*30 − 161 = 600 + 1031.25 − 150 − 161 = 1320.25 → 1320
    expect(calculateMifflinStJeor({ weightKg: 60, heightCm: 165, ageYears: 30, sex: 'female' })).toBe(1320);
  });

  it('returns null when input is null or undefined', () => {
    expect(calculateMifflinStJeor(null)).toBeNull();
    expect(calculateMifflinStJeor(undefined)).toBeNull();
  });

  it('returns null when any required field is missing', () => {
    expect(calculateMifflinStJeor({ weightKg: 80, heightCm: 180, ageYears: 30 })).toBeNull();
    expect(calculateMifflinStJeor({ weightKg: 80, heightCm: 180, sex: 'male' })).toBeNull();
    expect(calculateMifflinStJeor({ weightKg: 80, ageYears: 30, sex: 'male' })).toBeNull();
    expect(calculateMifflinStJeor({ heightCm: 180, ageYears: 30, sex: 'male' })).toBeNull();
  });

  it('returns null for non-positive measurements', () => {
    expect(calculateMifflinStJeor({ weightKg: 0, heightCm: 180, ageYears: 30, sex: 'male' })).toBeNull();
    expect(calculateMifflinStJeor({ weightKg: -5, heightCm: 180, ageYears: 30, sex: 'male' })).toBeNull();
    expect(calculateMifflinStJeor({ weightKg: 80, heightCm: 180, ageYears: 0, sex: 'male' })).toBeNull();
  });

  it('returns null when sex is not male/female', () => {
    expect(
      calculateMifflinStJeor({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'other' as never }),
    ).toBeNull();
  });

  it('rounds the result to the nearest integer', () => {
    // Pick numbers that produce a non-integer BMR
    // 10*70.3 + 6.25*172 − 5*28 + 5 = 703 + 1075 − 140 + 5 = 1643
    expect(
      calculateMifflinStJeor({ weightKg: 70.3, heightCm: 172, ageYears: 28, sex: 'male' }),
    ).toBe(1643);
  });
});

describe('estimateCurrentBurn', () => {
  it('returns null when BMR is null', () => {
    expect(estimateCurrentBurn(null, 12)).toBeNull();
  });

  it('returns 0 at hour 0', () => {
    expect(estimateCurrentBurn(2400, 0)).toBe(0);
  });

  it('returns the full BMR at hour 24', () => {
    expect(estimateCurrentBurn(2400, 24)).toBe(2400);
  });

  it('linearly interpolates at noon (hour 12)', () => {
    expect(estimateCurrentBurn(2400, 12)).toBe(1200);
  });

  it('rejects out-of-range hours', () => {
    expect(estimateCurrentBurn(2400, -1)).toBeNull();
    expect(estimateCurrentBurn(2400, 25)).toBeNull();
    expect(estimateCurrentBurn(2400, Number.NaN)).toBeNull();
  });
});
