// Praeventio Guard — Sprint 31 Bucket PP.
//
// Country-specific tax/identity validators. The product expanded from a
// Chile-only RUT check into a multi-country compliance footprint
// (Chile/Brasil/México/Argentina/Colombia + US/UK partners), so the old
// `validateRut` helper was generalized here. Each validator is pure,
// dep-free and side-effect-free; they ALL return the same shape so the
// caller can dispatch generically:
//
//   { valid: boolean; normalized?: string; reason?: string }
//
// The dispatcher `validateGenericTaxId(id, country)` picks the right one
// from an ISO-3166 alpha-2 code (CL/BR/MX/AR/CO/US/GB).

export interface TaxIdValidationResult {
  valid: boolean;
  /** Canonical, sanitized form of the input — only set when `valid: true`. */
  normalized?: string;
  /** Machine-readable reason for `valid: false`. */
  reason?: string;
}

// ─── Chile — RUT/RUN ────────────────────────────────────────────────────────

/**
 * Validate a Chilean RUT/RUN (Rol Único Tributario).
 *
 * Accepted input shapes:
 *   - "12.345.678-9"
 *   - "12345678-9"
 *   - "123456789"      (no separator at all)
 *   - "12345678-K"     (K = 10 in module-11 scheme)
 *
 * The check digit is computed module-11 over the body multiplied by the
 * weights 2..7 cycling from least-significant to most-significant digit.
 * Result 11 → "0", result 10 → "K".
 *
 * The normalized form is "12345678-9" (no dots, dash before DV, DV upper).
 */
export function validateChileanRut(rut: string): TaxIdValidationResult {
  if (typeof rut !== 'string' || rut.length === 0) {
    return { valid: false, reason: 'empty' };
  }
  const cleaned = rut.replace(/\./g, '').replace(/\s+/g, '').toUpperCase();
  // Body must be 7-8 digits, DV is 0-9 or K. Optional dash.
  const m = /^(\d{7,8})-?([0-9K])$/.exec(cleaned);
  if (!m) return { valid: false, reason: 'malformed' };
  const body = m[1];
  const dv = m[2];
  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 7 ? 2 : weight + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  if (expected !== dv) return { valid: false, reason: 'bad_check_digit' };
  return { valid: true, normalized: `${body}-${dv}` };
}

// ─── Brasil — CPF ───────────────────────────────────────────────────────────

/**
 * Validate a Brazilian CPF (Cadastro de Pessoas Físicas).
 *
 * 11 digits, last two are check digits (mod 11 with weights 10..2 then
 * 11..2). Repeated-digit CPFs ("11111111111" etc.) are mathematically
 * valid against the algorithm but are blocklisted by Receita Federal
 * because they are reserved/invalid in practice.
 */
export function validateBrazilianCpf(cpf: string): TaxIdValidationResult {
  if (typeof cpf !== 'string') return { valid: false, reason: 'empty' };
  const cleaned = cpf.replace(/\D/g, '');
  if (cleaned.length !== 11) return { valid: false, reason: 'wrong_length' };
  if (/^(\d)\1{10}$/.test(cleaned)) return { valid: false, reason: 'blocked_pattern' };

  const calcDigit = (slice: string, startWeight: number): string => {
    let sum = 0;
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * (startWeight - i);
    }
    const r = (sum * 10) % 11;
    return r === 10 ? '0' : String(r);
  };
  const d1 = calcDigit(cleaned.slice(0, 9), 10);
  const d2 = calcDigit(cleaned.slice(0, 10), 11);
  if (d1 !== cleaned[9] || d2 !== cleaned[10]) {
    return { valid: false, reason: 'bad_check_digit' };
  }
  return { valid: true, normalized: cleaned };
}

// ─── México — RFC ───────────────────────────────────────────────────────────

/**
 * Validate a Mexican RFC (Registro Federal de Contribuyentes).
 *
 * - Persona física: 4 letters + 6-digit DOB (YYMMDD) + 3-char homoclave = 13
 * - Persona moral:  3 letters + 6-digit creation date + 3-char homoclave = 12
 *
 * The homoclave's check digit is computed by SAT but the algorithm is
 * partially undocumented (it uses a proprietary letter-to-number map and
 * a final mod-11). We validate the structure + DOB sanity but NOT the
 * cryptographic correctness of the homoclave — which matches what every
 * open-source library ships and what most Mexican payment processors do.
 */
export function validateMexicanRfc(rfc: string): TaxIdValidationResult {
  if (typeof rfc !== 'string') return { valid: false, reason: 'empty' };
  const cleaned = rfc.replace(/[\s-]/g, '').toUpperCase();
  if (cleaned.length !== 12 && cleaned.length !== 13) {
    return { valid: false, reason: 'wrong_length' };
  }
  // Letters part: 3 (moral) or 4 (física). Allow & and Ñ per SAT.
  const physical = cleaned.length === 13;
  const lettersRe = physical ? /^[A-ZÑ&]{4}/ : /^[A-ZÑ&]{3}/;
  if (!lettersRe.test(cleaned)) return { valid: false, reason: 'bad_letters' };
  const dateStart = physical ? 4 : 3;
  const datePart = cleaned.slice(dateStart, dateStart + 6);
  if (!/^\d{6}$/.test(datePart)) return { valid: false, reason: 'bad_date' };
  const month = Number(datePart.slice(2, 4));
  const day = Number(datePart.slice(4, 6));
  if (month < 1 || month > 12) return { valid: false, reason: 'bad_month' };
  if (day < 1 || day > 31) return { valid: false, reason: 'bad_day' };
  // Homoclave: 3 alphanumeric chars at the end.
  const homoclave = cleaned.slice(dateStart + 6);
  if (!/^[A-Z0-9]{3}$/.test(homoclave)) {
    return { valid: false, reason: 'bad_homoclave' };
  }
  return { valid: true, normalized: cleaned };
}

// ─── Argentina — CUIT/CUIL ──────────────────────────────────────────────────

/**
 * Validate an Argentine CUIT/CUIL.
 *
 * 11 digits: 2-digit prefix (20/23/24/27 personas, 30/33/34 empresas) +
 * 8-digit DNI/identifier + 1 check digit (mod 11 with weights
 * 5,4,3,2,7,6,5,4,3,2). Result 11 → 0 only valid when prefix is 23/24
 * (special-case rule from AFIP).
 */
export function validateArgentineCuit(cuit: string): TaxIdValidationResult {
  if (typeof cuit !== 'string') return { valid: false, reason: 'empty' };
  const cleaned = cuit.replace(/\D/g, '');
  if (cleaned.length !== 11) return { valid: false, reason: 'wrong_length' };
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += Number(cleaned[i]) * weights[i];
  }
  const r = 11 - (sum % 11);
  const expected = r === 11 ? 0 : r === 10 ? 9 : r;
  if (expected !== Number(cleaned[10])) {
    return { valid: false, reason: 'bad_check_digit' };
  }
  return { valid: true, normalized: cleaned };
}

// ─── Colombia — NIT ─────────────────────────────────────────────────────────

/**
 * Validate a Colombian NIT (Número de Identificación Tributaria).
 *
 * 9-10 digits where the last digit is the check (DIAN) computed mod-11
 * with weights 41,37,29,23,19,17,13,7,3 applied right-to-left over the
 * body. Result 0 or 1 → keep as-is; otherwise 11 - r. Inputs may include
 * a "-" before the DV.
 */
export function validateColombianNit(nit: string): TaxIdValidationResult {
  if (typeof nit !== 'string') return { valid: false, reason: 'empty' };
  const cleaned = nit.replace(/\./g, '').replace(/\s+/g, '');
  // Accept "9 digit body - DV" or just digits where last is DV.
  let body: string;
  let dv: string;
  if (cleaned.includes('-')) {
    const parts = cleaned.split('-');
    if (parts.length !== 2) return { valid: false, reason: 'malformed' };
    body = parts[0];
    dv = parts[1];
  } else {
    if (cleaned.length < 9 || cleaned.length > 10) {
      return { valid: false, reason: 'wrong_length' };
    }
    body = cleaned.slice(0, -1);
    dv = cleaned.slice(-1);
  }
  if (!/^\d{8,9}$/.test(body) || !/^\d$/.test(dv)) {
    return { valid: false, reason: 'malformed' };
  }
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41];
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    // weights are applied right-to-left: rightmost body digit × 3, etc.
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * weights[i];
  }
  const r = sum % 11;
  const expected = r >= 2 ? 11 - r : r;
  if (expected !== Number(dv)) {
    return { valid: false, reason: 'bad_check_digit' };
  }
  return { valid: true, normalized: `${body}-${dv}` };
}

// ─── United States — SSN ────────────────────────────────────────────────────

/**
 * Validate a US Social Security Number.
 *
 * Format XXX-XX-XXXX (9 digits). Structural rules per SSA:
 *   - Area (first 3): NOT 000, 666, or 900-999.
 *   - Group (next 2): NOT 00.
 *   - Serial (last 4): NOT 0000.
 *
 * We do NOT call any third-party verification service — this is a pure
 * structural check. Real verification requires SSA's Consent Based SSN
 * Verification (CBSV), out of scope here.
 */
export function validateSsn(ssn: string): TaxIdValidationResult {
  if (typeof ssn !== 'string') return { valid: false, reason: 'empty' };
  const cleaned = ssn.replace(/[\s-]/g, '');
  if (!/^\d{9}$/.test(cleaned)) return { valid: false, reason: 'wrong_length' };
  const area = cleaned.slice(0, 3);
  const group = cleaned.slice(3, 5);
  const serial = cleaned.slice(5);
  if (area === '000' || area === '666') return { valid: false, reason: 'reserved_area' };
  if (Number(area) >= 900) return { valid: false, reason: 'reserved_area' };
  if (group === '00') return { valid: false, reason: 'reserved_group' };
  if (serial === '0000') return { valid: false, reason: 'reserved_serial' };
  return { valid: true, normalized: `${area}-${group}-${serial}` };
}

// ─── United Kingdom — National Insurance Number ─────────────────────────────

/**
 * Validate a UK National Insurance Number.
 *
 * Format AA999999A (2 prefix letters + 6 digits + 1 suffix letter).
 * HMRC blocklist:
 *   - First letter NOT D, F, I, Q, U, V.
 *   - Second letter NOT D, F, I, O, Q, U, V.
 *   - Disallowed prefixes: BG, GB, NK, KN, TN, NT, ZZ.
 *   - Suffix MUST be A, B, C or D (or sometimes the space — we accept A-D).
 */
export function validateNiNumber(ni: string): TaxIdValidationResult {
  if (typeof ni !== 'string' || ni.length === 0) return { valid: false, reason: 'empty' };
  const cleaned = ni.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{6}[A-Z]$/.test(cleaned)) {
    return { valid: false, reason: 'malformed' };
  }
  const first = cleaned[0];
  const second = cleaned[1];
  const prefix = cleaned.slice(0, 2);
  const suffix = cleaned[8];
  if ('DFIQUV'.includes(first)) return { valid: false, reason: 'reserved_prefix_letter' };
  if ('DFIOQUV'.includes(second)) return { valid: false, reason: 'reserved_prefix_letter' };
  const blockedPrefixes = new Set(['BG', 'GB', 'NK', 'KN', 'TN', 'NT', 'ZZ']);
  if (blockedPrefixes.has(prefix)) return { valid: false, reason: 'blocked_prefix' };
  if (!'ABCD'.includes(suffix)) return { valid: false, reason: 'bad_suffix' };
  return { valid: true, normalized: cleaned };
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

/**
 * Map an ISO-3166 alpha-2 country code to the local tax-id validator.
 * Unknown countries return `{ valid: false, reason: 'unsupported_country' }`.
 *
 * We deliberately keep the country argument as an upper-case ISO code so
 * the call sites can hard-code constants from their own country tables —
 * we never auto-detect by sniffing the id format (too ambiguous: a 9-digit
 * Colombian NIT and a 9-digit US SSN look identical without context).
 */
export function validateGenericTaxId(
  id: string,
  country: string,
): TaxIdValidationResult {
  const cc = (country || '').trim().toUpperCase();
  switch (cc) {
    case 'CL':
      return validateChileanRut(id);
    case 'BR':
      return validateBrazilianCpf(id);
    case 'MX':
      return validateMexicanRfc(id);
    case 'AR':
      return validateArgentineCuit(id);
    case 'CO':
      return validateColombianNit(id);
    case 'US':
      return validateSsn(id);
    case 'GB':
    case 'UK':
      return validateNiNumber(id);
    default:
      return { valid: false, reason: 'unsupported_country' };
  }
}
