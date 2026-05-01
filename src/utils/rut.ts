// Praeventio Guard — Chilean RUT (Rol Único Tributario) helpers.
//
// Round 14 — pure utility module. NO Firestore, NO clock, NO globals. Every
// caller (UI form validation, server payload guards, CSV import pipelines)
// goes through these four functions, so the SII modulo-11 algorithm only
// lives in one place.
//
// SII algorithm reference (canonical):
//
//   1. Take the body (digits only).
//   2. Walk RIGHT-to-LEFT, multiplying each digit by the next weight from
//      the cycle [2, 3, 4, 5, 6, 7], then back to 2 after 7.
//   3. Sum the products.
//   4. Compute sum mod 11. The verifier digit is 11 - (sum mod 11).
//      • If that yields 11 → DV = '0'
//      • If it yields 10 → DV = 'K'
//      • Otherwise stringify the digit ('1'..'9').

/** Strip whitespace, dots, and hyphens; uppercase the verifier digit. */
export function cleanRut(input: string): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[\s.\-]/g, '').toUpperCase();
}

/**
 * Modulo-11 verifier digit for a RUT body. Body must be all digits;
 * caller is responsible for stripping format characters first (or use
 * `cleanRut`). Returns '' for empty input — never throws.
 */
export function computeRutDv(rutBody: string): string {
  if (typeof rutBody !== 'string' || rutBody.length === 0) return '';
  if (!/^\d+$/.test(rutBody)) return '';
  const weights = [2, 3, 4, 5, 6, 7];
  let sum = 0;
  let i = 0;
  for (let pos = rutBody.length - 1; pos >= 0; pos--) {
    sum += Number(rutBody[pos]) * weights[i % weights.length];
    i++;
  }
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return String(remainder);
}

/**
 * Full SII validation. Accepts dotted/hyphenated/raw form. Body must be 1–8
 * digits (legal CL persons stay below 100,000,000); we allow up to 9 digits
 * to leave headroom for the rare large RUTs without being permissive about
 * arbitrary input lengths.
 */
export function isValidRut(input: string): boolean {
  const cleaned = cleanRut(input);
  if (cleaned.length < 2 || cleaned.length > 10) return false;
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  if (!/^\d+$/.test(body)) return false;
  if (body.length < 1 || body.length > 9) return false;
  if (!/^[\dK]$/.test(dv)) return false;
  return computeRutDv(body) === dv;
}

/**
 * Formats a RUT as `12.345.678-9` regardless of input shape. If input cannot
 * be parsed (no DV, all letters), returns the cleaned form unchanged so the
 * caller can choose how to render the broken value.
 */
export function formatRut(input: string): string {
  const cleaned = cleanRut(input);
  if (cleaned.length < 2) return cleaned;
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  // Insert thousands dots from the right.
  let dotted = '';
  for (let i = 0; i < body.length; i++) {
    if (i > 0 && (body.length - i) % 3 === 0) dotted += '.';
    dotted += body[i];
  }
  return `${dotted}-${dv}`;
}
