/**
 * Format CLP (Chilean peso) amounts for display.
 *
 * [Hy3-audit 3c4aa66d-73fe-8104-bf91-fac11385c028 2026-08-25]
 * Six near-identical implementations of the same CLP formatting rule
 * had drifted across the codebase. This module is the canonical
 * version. The original implementation lives in
 * `src/services/compliance/ds67Simulator.ts:241` and is re-exported
 * here for callers outside the compliance module; the DS67 simulator
 * still uses its own copy to avoid a circular import. Migration of
 * the other 5 sites (CostScenarioCard, CostSimulator,
 * ROICalculatorWidget, TierComparatorWidget, src/services/email/templates.ts)
 * is tracked as a follow-up — each is a one-line import swap that can
 * land in its own PR.
 *
 * Rule (CLP es-CL):
 *   - Group thousands with `.` (period)
 *   - Sign (negative) goes BEFORE the `$` currency mark
 *   - Reject non-finite inputs with a validation error (drift in any
 *     of the 6 copies here would silently render "NaN" or "Infinity")
 *
 * Examples:
 *   formatClp(1234)         === '$1.234'
 *   formatClp(-1234567)     === '-$1.234.567'
 *   formatClp(0)            === '$0'
 */
export class ClpFormatError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ClpFormatError';
  }
}

export function formatClp(amount: number): string {
  if (!Number.isFinite(amount)) {
    throw new ClpFormatError(
      'invalid_clp_amount',
      `CLP amount must be finite, got ${amount}`,
    );
  }
  const rounded = Math.round(amount);
  const sign = rounded < 0 ? '-' : '';
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}$${grouped}`;
}