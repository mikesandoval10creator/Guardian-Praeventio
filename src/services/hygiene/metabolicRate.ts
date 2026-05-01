/**
 * Mifflin-St Jeor Basal Metabolic Rate calculator.
 *
 * Formula (1990, Mifflin et al.):
 *   • Male:   BMR = 10·weight(kg) + 6.25·height(cm) − 5·age(y) + 5
 *   • Female: BMR = 10·weight(kg) + 6.25·height(cm) − 5·age(y) − 161
 *
 * The function is intentionally pure: no Firestore, no clock. The
 * caller (`NutritionLog`) supplies the worker's profile fields and
 * decides what to render when fields are missing — we never make up a
 * "neutral" value behind their back. Round 17 (R4) replaces the
 * previous hard-coded `metabolicRate = 2400` constant which was the
 * same number for every worker, every age, every body composition.
 */

export type Sex = 'male' | 'female';

export interface MifflinInput {
  /** kilograms */
  weightKg: number;
  /** centimetres */
  heightCm: number;
  /** completed years */
  ageYears: number;
  sex: Sex;
}

/**
 * Returns BMR in kcal/day rounded to the nearest integer, or `null`
 * if any input is missing/invalid. Callers must surface a "complete
 * tu perfil" UI instead of substituting a fake number.
 */
export function calculateMifflinStJeor(input: Partial<MifflinInput> | null | undefined): number | null {
  if (!input) return null;
  const { weightKg, heightCm, ageYears, sex } = input;
  if (
    typeof weightKg !== 'number' ||
    typeof heightCm !== 'number' ||
    typeof ageYears !== 'number' ||
    !Number.isFinite(weightKg) ||
    !Number.isFinite(heightCm) ||
    !Number.isFinite(ageYears) ||
    weightKg <= 0 ||
    heightCm <= 0 ||
    ageYears <= 0
  ) {
    return null;
  }
  if (sex !== 'male' && sex !== 'female') return null;

  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  const bmr = sex === 'male' ? base + 5 : base - 161;
  return Math.round(bmr);
}

/**
 * Compute "current burn so far today" by linearly distributing the
 * daily BMR across 24 hours. Returns `null` if BMR cannot be computed.
 */
export function estimateCurrentBurn(
  bmr: number | null,
  hourOfDay: number,
): number | null {
  if (bmr == null || !Number.isFinite(hourOfDay) || hourOfDay < 0 || hourOfDay > 24) {
    return null;
  }
  return Math.floor((hourOfDay / 24) * bmr);
}
