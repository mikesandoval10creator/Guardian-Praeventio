// Praeventio Guard — SII pre-flight checks. Sprint 50, E.5 P2 H5.
//
// Pure engine that validates the runtime environment + caller payload BEFORE
// invoking an intermediate PSE provider (Bsale / OpenFactura / LibreDTE /
// SimpleAPI). Catches the boring class of failures (missing token, wrong
// ambiente, bad RUT check digit, factura without receiver, zero/oversized
// monto) so the PSE never sees a request it would only reject later.
//
// Directiva 3 reminder — Praeventio NEVER pushes DTE straight to SII. The
// PSE intermedio holds the digital certificate and talks to the SII. The
// pre-flight only verifies that we are ready to call the PSE.
//
// This module is pure and side-effect-free: it reads from the `env` object
// passed in (not `process.env` directly), so tests can inject custom
// environments without monkey-patching globals.

import { validateChileanRut as validateChileanRutFull } from '../identity/rutValidators';

// ─── Public types ───────────────────────────────────────────────────────────

/**
 * Document kind being prepared for emission.
 *
 * Mirrors the subset of `DteType` (33/39/41/56/61) the rest of the SII
 * module uses, but keeps the string-keyed enum so callers reading this from
 * UI state / Firestore docs don't have to remember the SII numeric codes.
 */
export type SiiDocumentKind =
  | 'boleta_electronica'
  | 'factura_electronica'
  | 'nota_credito'
  | 'guia_despacho';

/** Item being billed — controls a soft warning around honorarios threshold. */
export type SiiItemKind = 'service' | 'product';

/** Recognised SII environments. Anything else is a blocking failure. */
export type SiiAmbiente = 'certificacion' | 'produccion';

/**
 * Inputs to the pre-flight check.
 *
 * The `env` is passed in (not pulled from `process.env` inside the function)
 * so tests stay deterministic and callers from edge runtimes can supply a
 * different bag of strings.
 */
export interface SiiPreflightInput {
  /** Snapshot of env vars. Usually `process.env`. */
  env: NodeJS.ProcessEnv;
  /** Tipo de DTE a emitir. */
  documentKind: SiiDocumentKind;
  /** RUT empresa emisora (con o sin puntos, con guión y DV). */
  issuerTaxId: string;
  /** RUT receptor — requerido para factura_electronica y nota_credito. */
  receiverTaxId?: string;
  /** Monto neto en CLP (whole pesos, no decimals). */
  amountNetClp: number;
  /** Indica si el ítem es servicio (gatilla warning honorarios) o producto. */
  itemKind: SiiItemKind;
}

/**
 * Single failure / warning record. `code` is machine-readable for routing,
 * `detail` is the human-readable explanation surfaced in logs/UI.
 */
export interface SiiPreflightFinding {
  code: string;
  detail: string;
}

/**
 * Pre-flight result. `ok` is `true` only when there are zero blocking
 * failures; warnings DO NOT flip `ok` to `false`. `computedTax` is always
 * filled, so callers can still preview totals even on a failed preflight.
 */
export interface SiiPreflightResult {
  ok: boolean;
  blockingFailures: SiiPreflightFinding[];
  warnings: SiiPreflightFinding[];
  computedTax: {
    netClp: number;
    ivaClp: number;
    totalClp: number;
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** IVA rate Chile (19%). Mirrors `CHILE_IVA_RATE` in `./types.ts`. */
export const CHILE_IVA_RATE_PREFLIGHT = 0.19;

/**
 * Upper legal limit for a single factura nacional in CLP. Above this the
 * SII requires the operation to be split (or routed as factura de
 * exportación, which is out of scope here).
 */
export const SII_FACTURA_MAX_NET_CLP = 9_999_999_999;

/**
 * Honorarios soft threshold. When a `service` line exceeds this, the
 * caller probably needs to issue a "boleta de honorarios" via the SII
 * portal directly instead of going through the PSE — we surface a warning
 * rather than blocking, because the rules depend on the giro of the
 * issuer.
 */
export const SII_HONORARIOS_WARNING_THRESHOLD_CLP = 5_000_000;

/** Accepted SII ambiente values. Anything else trips a blocking failure. */
const VALID_AMBIENTES: ReadonlySet<string> = new Set(['certificacion', 'produccion']);

/**
 * Document kinds that REQUIRE a receiverTaxId (factura + nota de crédito
 * always; boleta nunca; guía de despacho sí porque va a un destinatario).
 */
const KINDS_REQUIRING_RECEIVER: ReadonlySet<SiiDocumentKind> = new Set<SiiDocumentKind>([
  'factura_electronica',
  'nota_credito',
  'guia_despacho',
]);

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Thin boolean wrapper around the canonical
 * `identity/rutValidators.validateChileanRut`. Kept here so callers that
 * only need a yes/no answer don't have to destructure `.valid`. Re-exported
 * from this module's public surface so tests + integrations can reuse it.
 *
 * Accepts inputs with or without dots, with optional dash before DV.
 * Returns `true` only when the body is 7-8 digits and the mod-11 check
 * digit matches.
 */
export function validateChileanRut(rut: string): boolean {
  return validateChileanRutFull(rut).valid;
}

/** Normalize an env var to a trimmed string. Treat empty as missing. */
function getEnvVar(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Strip dots/spaces and uppercase the DV so two RUTs compare consistently. */
function normalizeRutForCompare(rut: string): string {
  return rut.replace(/\./g, '').replace(/\s+/g, '').toUpperCase();
}

/** Round IVA up to the nearest whole peso (matches `withIVA` in pricing). */
function computeIvaClp(netClp: number): number {
  if (!Number.isFinite(netClp) || netClp <= 0) return 0;
  return Math.ceil(netClp * CHILE_IVA_RATE_PREFLIGHT);
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Run the SII pre-flight check.
 *
 * Pure function — never throws, never touches `process.env` directly, never
 * makes network calls. Builds up two lists of findings (blocking +
 * warnings) and returns them alongside computed tax totals so the caller
 * can render a preview even when the preflight failed.
 */
export function runSiiPreflight(input: SiiPreflightInput): SiiPreflightResult {
  const blockingFailures: SiiPreflightFinding[] = [];
  const warnings: SiiPreflightFinding[] = [];

  // ── 1. PSE token presence ────────────────────────────────────────────────
  // Accept any of the supported PSE-specific tokens, OR a generic
  // PSE_API_TOKEN fallback. The pre-flight does not care WHICH PSE is
  // configured — that's `getSiiAdapter()`'s job — only that at least one
  // credential string is set, so we know the call won't fail with a 401.
  const bsaleToken = getEnvVar(input.env, 'BSALE_API_TOKEN');
  const pseToken = getEnvVar(input.env, 'PSE_API_TOKEN');
  const openfacturaKey = getEnvVar(input.env, 'OPENFACTURA_API_KEY');
  const simpleApiKey = getEnvVar(input.env, 'SIMPLEAPI_API_KEY');
  const libredteToken = getEnvVar(input.env, 'LIBREDTE_API_TOKEN');
  const hasAnyPseCredential = Boolean(
    bsaleToken || pseToken || openfacturaKey || simpleApiKey || libredteToken,
  );
  if (!hasAnyPseCredential) {
    blockingFailures.push({
      code: 'PSE_TOKEN_MISSING',
      detail:
        'No PSE credential is set. Configure one of BSALE_API_TOKEN, ' +
        'PSE_API_TOKEN, OPENFACTURA_API_KEY, SIMPLEAPI_API_KEY, or ' +
        'LIBREDTE_API_TOKEN before emitting a DTE.',
    });
  }

  // ── 2. SII_RUT_EMPRESA presence + anti-tampering match ──────────────────
  const envIssuerRut = getEnvVar(input.env, 'SII_RUT_EMPRESA');
  if (!envIssuerRut) {
    blockingFailures.push({
      code: 'SII_RUT_EMPRESA_MISSING',
      detail:
        'SII_RUT_EMPRESA is not set. Pre-flight cannot verify the caller is ' +
        'not impersonating another emisor.',
    });
  } else if (
    normalizeRutForCompare(envIssuerRut) !== normalizeRutForCompare(input.issuerTaxId)
  ) {
    blockingFailures.push({
      code: 'ISSUER_RUT_MISMATCH',
      detail:
        `issuerTaxId "${input.issuerTaxId}" does not match SII_RUT_EMPRESA ` +
        `"${envIssuerRut}". Refusing to issue under a foreign RUT.`,
    });
  }

  // ── 3. SII_AMBIENTE must be cert or prod ────────────────────────────────
  const ambiente = getEnvVar(input.env, 'SII_AMBIENTE');
  if (!ambiente) {
    blockingFailures.push({
      code: 'SII_AMBIENTE_MISSING',
      detail: 'SII_AMBIENTE must be set to "certificacion" or "produccion".',
    });
  } else if (!VALID_AMBIENTES.has(ambiente.toLowerCase())) {
    blockingFailures.push({
      code: 'SII_AMBIENTE_INVALID',
      detail:
        `SII_AMBIENTE="${ambiente}" is not a valid SII environment. ` +
        'Use "certificacion" or "produccion".',
    });
  }

  // ── 4. Issuer RUT check digit ───────────────────────────────────────────
  if (!validateChileanRut(input.issuerTaxId)) {
    blockingFailures.push({
      code: 'ISSUER_RUT_INVALID',
      detail:
        `issuerTaxId "${input.issuerTaxId}" failed Chilean RUT mod-11 check. ` +
        'Verify the digit verificador.',
    });
  }

  // ── 5. Receiver RUT — required + valid for certain kinds ────────────────
  const receiverRequired = KINDS_REQUIRING_RECEIVER.has(input.documentKind);
  if (receiverRequired) {
    if (!input.receiverTaxId || input.receiverTaxId.trim().length === 0) {
      blockingFailures.push({
        code: 'RECEIVER_RUT_MISSING',
        detail:
          `documentKind="${input.documentKind}" requires a receiverTaxId. ` +
          'Only boleta_electronica may omit the receiver.',
      });
    } else if (!validateChileanRut(input.receiverTaxId)) {
      blockingFailures.push({
        code: 'RECEIVER_RUT_INVALID',
        detail:
          `receiverTaxId "${input.receiverTaxId}" failed Chilean RUT mod-11 ` +
          'check. Verify the digit verificador.',
      });
    }
  } else if (input.receiverTaxId && !validateChileanRut(input.receiverTaxId)) {
    // For boleta_electronica the receiver is optional, but if supplied it
    // should still validate. Surface as a warning rather than a blocker
    // because the PSE will strip it from the boleta anyway.
    warnings.push({
      code: 'RECEIVER_RUT_INVALID_OPTIONAL',
      detail:
        `receiverTaxId "${input.receiverTaxId}" is malformed but optional ` +
        'for boleta_electronica. The PSE will likely ignore it.',
    });
  }

  // ── 6. Amount validation ────────────────────────────────────────────────
  if (!Number.isFinite(input.amountNetClp)) {
    blockingFailures.push({
      code: 'AMOUNT_NOT_FINITE',
      detail: 'amountNetClp must be a finite number.',
    });
  } else if (!Number.isInteger(input.amountNetClp)) {
    blockingFailures.push({
      code: 'AMOUNT_FRACTIONAL',
      detail: 'amountNetClp must be a whole peso amount (no decimals).',
    });
  } else if (input.amountNetClp <= 0) {
    blockingFailures.push({
      code: 'AMOUNT_NON_POSITIVE',
      detail:
        `amountNetClp must be > 0 (received ${input.amountNetClp}). ` +
        'Use nota_credito for refunds; never emit a 0 or negative DTE.',
    });
  } else if (input.amountNetClp > SII_FACTURA_MAX_NET_CLP) {
    blockingFailures.push({
      code: 'AMOUNT_EXCEEDS_LIMIT',
      detail:
        `amountNetClp ${input.amountNetClp} exceeds SII limit of ` +
        `${SII_FACTURA_MAX_NET_CLP} for a single factura nacional.`,
    });
  }

  // ── 7. Honorarios soft warning ──────────────────────────────────────────
  if (
    input.itemKind === 'service' &&
    Number.isFinite(input.amountNetClp) &&
    input.amountNetClp > SII_HONORARIOS_WARNING_THRESHOLD_CLP
  ) {
    warnings.push({
      code: 'HONORARIOS_THRESHOLD',
      detail:
        `Service line over ${SII_HONORARIOS_WARNING_THRESHOLD_CLP} CLP — ` +
        'verify whether a boleta de honorarios is required instead of a ' +
        'standard DTE. Depends on the giro of the issuer.',
    });
  }

  // ── 8. Compute tax for preview ──────────────────────────────────────────
  const netClp =
    Number.isFinite(input.amountNetClp) && input.amountNetClp > 0
      ? Math.floor(input.amountNetClp)
      : 0;
  const ivaClp = computeIvaClp(netClp);
  const totalClp = netClp + ivaClp;

  return {
    ok: blockingFailures.length === 0,
    blockingFailures,
    warnings,
    computedTax: { netClp, ivaClp, totalClp },
  };
}
