// SPDX-License-Identifier: MIT
//
// Official compliance forms (SUSESO DIAT/DIEP, DTE, etc.) are signed by the
// employer and submitted to a regulator. They must NEVER display a fabricated
// legal value: a plausible-looking fake RUT (e.g. "12.345.678-9") rendered on a
// submitted injury report identifies the WRONG worker — a real data-integrity
// and legal hazard. When a required identifier is absent we render an HONEST
// "missing" marker instead: visible, never fabricated.
// (Directive: exigir el dato real, no fabricar.)

export const MISSING_LEGAL_VALUE = 'No especificado';

export interface LegalFormValue {
  /** Display text: the real (trimmed) value, or the honest missing marker. Never fake. */
  text: string;
  /** True when the underlying value was absent/blank — callers may flag it visually. */
  missing: boolean;
}

/**
 * Resolve a value for an official-form field WITHOUT fabricating data. Returns
 * the trimmed real value, or `{ text: MISSING_LEGAL_VALUE, missing: true }` when
 * the value is absent/blank. It will never return a plausible-but-fake legal
 * value (the form used to fall back to a valid-format fake RUT).
 */
export function legalFormValue(value: string | null | undefined): LegalFormValue {
  const trimmed = value?.trim();
  return trimmed
    ? { text: trimmed, missing: false }
    : { text: MISSING_LEGAL_VALUE, missing: true };
}
