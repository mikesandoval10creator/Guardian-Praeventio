// Praeventio Guard \u2014 Numeric boundary guards for Bernoulli generators.
//
// The legacy `<= 0` checks scattered across `structuralWindLoad.ts`,
// `hidranteFireNetwork.ts`, and `scaffoldWindSuction.ts` only filter
// values that compare strictly less-or-equal to zero. They FAIL to
// reject `NaN`, `+Infinity`, and `-Infinity` because IEEE 754 NaN
// comparisons are always false, and `Infinity <= 0` is `false` for
// `+Infinity`. A non-finite input used to slip past the gate, propagate
// `NaN` through the math, and produce a `riskNode` with `severity: 'high'`
// or `'critical'` carrying `metadata: { forceN: NaN, ratio: NaN, ... }`
// \u2014 a fake prevention signal that is actually nonsense.
//
// These helpers are the single source of truth for "is this numeric input
// usable?" checks across all Bernoulli generators. Keep them pure, free
// of side-effects, and cheap.

/**
 * Returns `true` if `value` is a real, finite number usable in physics
 * formulas. `NaN`, `+Infinity`, and `-Infinity` are NOT considered finite
 * even though they pass the `typeof === 'number'` check.
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Throws a `RangeError` if `value` is not a finite number. Used by the
 * generator entry points to fail fast on corrupt upstream data BEFORE
 * computing anything (so the math never touches NaN / Infinity).
 *
 * The thrown error is caught by the route-level handler and surfaces as
 * a 422 to the caller \u2014 do NOT swallow it inside the generator
 * because that would silently downgrade a malformed input to "no node".
 */
export function assertFinite(value: unknown, label: string): asserts value is number {
  if (!isFiniteNumber(value)) {
    throw new RangeError(
      `${label} must be a finite number (got ${describeNonFinite(value)})`,
    );
  }
}

function describeNonFinite(value: unknown): string {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (value === Infinity) return '+Infinity';
    if (value === -Infinity) return '-Infinity';
  }
  return `${typeof value} (${String(value)})`;
}
