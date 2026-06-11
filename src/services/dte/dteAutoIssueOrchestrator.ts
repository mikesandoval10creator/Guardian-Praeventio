// Praeventio Guard — Sprint 49 D.8.b: DTE Auto-Issue Orchestrator (pure).
//
// PURPOSE
//   Decide whether (and what kind of) DTE to auto-issue after a payment is
//   confirmed. Pure, sync, side-effect-free: it returns a decision the caller
//   wires to the queue / persistence layer. No I/O, no Firestore, no fetch.
//
// PRODUCT DIRECTIVE (inviolable — memoria product_signing_no_blocking_directives_2026-05-06)
//   Praeventio NUNCA hace push directo a SII. La emisión real (cuando esta
//   decisión termina en 'should_issue=true') siempre va por un PSE intermedio
//   (Bsale / OpenFactura / SimpleAPI / LibreDTE) o por el documento generado
//   localmente con firma biométrica que la empresa firma+entrega. Esta capa
//   solo DECIDE, no emite.
//
// SCOPE
//   • B2B con RUT empresa válido (`X.XXX.XXX-X` con DV correcto) → factura 33.
//   • Persona natural con email/nombre, sin taxId → boleta 39.
//   • `amountClp ≤ 0` o `paymentGateway` no soportado → non_billable.
//   • RUT con formato inválido → invalid_tax_id (la caller debe escalar a
//     human review; NO genera factura con RUT roto).
//
//   Idempotency: key estable = sha256(paymentId|tenantId). La caller usa esta
//   clave para deduplicar contra su queue/store antes de invocar el adapter.

import crypto from 'node:crypto';

// ─── Public types ─────────────────────────────────────────────────────────

export type DtePaymentGateway = 'webpay' | 'mercadopago' | 'khipu' | 'manual';

export interface DtePayerInfo {
  /** Chilean RUT in `X.XXX.XXX-X` or `XXXXXXXX-X` format. Optional. */
  taxId?: string;
  legalName?: string;
  address?: string;
  email?: string;
}

export interface DteIssueRequest {
  /** Idempotent gateway-side payment id (Webpay token, MP payment.id, manual invoiceId). */
  paymentId: string;
  /** Praeventio tenant / customer id (Firestore uid or org id). */
  tenantId: string;
  payerInfo: DtePayerInfo;
  /** Whole CLP — fractional pesos break SII validation. */
  amountClp: number;
  /** Plan code from `src/services/pricing/tiers.ts` (e.g. `pro`, `enterprise`). */
  planCode: string;
  paymentGateway: DtePaymentGateway;
  /** ISO 8601 timestamp when the payment was confirmed. */
  paidAt: string;
}

export type DteDocumentKind =
  | 'boleta_electronica'
  | 'factura_electronica'
  | 'none';

export type DteDecisionReason =
  | 'has_company_tax_id'
  | 'individual_consumer'
  | 'already_issued'
  | 'non_billable'
  | 'invalid_tax_id'
  | 'missing_payer_contact'
  | 'unsupported_gateway';

export interface DteIssueDecision {
  shouldIssue: boolean;
  documentKind: DteDocumentKind;
  reason: DteDecisionReason;
  /** sha256(paymentId|tenantId) — stable across retries. */
  idempotencyKey: string;
  /** Convenience: amount the DTE should reflect (CLP whole pesos). */
  amountClp: number;
  /** Echoed back so audit-logs / queue persistence can stamp the source. */
  paymentGateway: DtePaymentGateway;
}

export interface DecideDteIssueOptions {
  /**
   * If the caller has already detected a successful prior issuance for this
   * idempotencyKey, pass `true` to short-circuit to `already_issued`.
   * Default: `false` — caller is responsible for the lookup.
   */
  alreadyIssued?: boolean;
}

// ─── RUT helpers ─────────────────────────────────────────────────────────

/**
 * Compute the Chilean RUT "digito verificador" (DV) using modulo 11.
 * Returns '0'..'9' or 'K'.
 */
function computeRutDv(rutBody: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = rutBody.length - 1; i >= 0; i--) {
    const digit = rutBody.charCodeAt(i) - 48;
    if (digit < 0 || digit > 9) return '?';
    sum += digit * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const mod = 11 - (sum % 11);
  if (mod === 11) return '0';
  if (mod === 10) return 'K';
  return String(mod);
}

/**
 * Strip dots/dashes and uppercase the DV — returns `{ body, dv }` or `null`.
 *
 * Accepts:
 *   • `76.123.456-7`
 *   • `76123456-7`
 *   • `761234567`  ← DV adjacent, no dash
 */
function parseRut(raw: string): { body: string; dv: string } | null {
  const clean = raw.replace(/[.\s]/g, '').toUpperCase();
  const dashMatch = clean.match(/^([0-9]+)-([0-9K])$/);
  if (dashMatch) {
    return { body: dashMatch[1], dv: dashMatch[2] };
  }
  // Allow `76123456 7` style? No — require dash to avoid ambiguity with
  // huge integers; manual entry typically uses a dash.
  const noDashMatch = clean.match(/^([0-9]+)([0-9K])$/);
  if (noDashMatch && clean.length >= 8 && clean.length <= 10) {
    return { body: noDashMatch[1], dv: noDashMatch[2] };
  }
  return null;
}

/**
 * Public: validates a Chilean RUT shape AND check digit.
 *
 * NOTE: A valid RUT alone does not prove the holder is a company —
 * Chilean RUTs use a "8 million" heuristic (RUT body ≥ 50.000.000 → empresa,
 * < 50.000.000 → persona natural). We apply that rule here to avoid issuing
 * a factura 33 to an individual who happened to type their personal RUT.
 */
export function classifyChileanTaxId(raw: string): {
  kind: 'company' | 'individual' | 'invalid';
  normalized?: string;
} {
  const parsed = parseRut(raw);
  if (!parsed) return { kind: 'invalid' };
  const expectedDv = computeRutDv(parsed.body);
  if (expectedDv !== parsed.dv) return { kind: 'invalid' };
  const bodyNum = Number(parsed.body);
  if (!Number.isFinite(bodyNum) || bodyNum <= 0) return { kind: 'invalid' };
  const normalized = `${parsed.body}-${parsed.dv}`;
  // Chilean SII convention: RUT body ≥ 50.000.000 corresponds to companies
  // (personas jurídicas). Below that range is reserved for individuals.
  if (bodyNum >= 50_000_000) return { kind: 'company', normalized };
  return { kind: 'individual', normalized };
}

// ─── Idempotency key ─────────────────────────────────────────────────────

/**
 * Stable idempotency key for the (paymentId, tenantId) pair.
 *
 * Two retries of the same payment from the same tenant produce the same key,
 * which lets the queue dedupe and lets audit-logs cross-reference.
 *
 * sha256 hex digest, full 64 chars — collisions are not a realistic concern
 * for this load, and the longer key reads cleanly in logs.
 */
export function buildIdempotencyKey(
  paymentId: string,
  tenantId: string,
): string {
  return crypto
    .createHash('sha256')
    .update(`${paymentId}|${tenantId}`)
    .digest('hex');
}

// ─── Decision engine ─────────────────────────────────────────────────────

const SUPPORTED_GATEWAYS: ReadonlySet<DtePaymentGateway> = new Set<DtePaymentGateway>([
  'webpay',
  'mercadopago',
  // 2026-06-11 (khipu cableado): Khipu is the third automated rail — paid
  // bank-transfer payments emit DTE exactly like Webpay/MercadoPago.
  'khipu',
  'manual',
]);

/**
 * Decide whether to issue a DTE for this payment, and which kind.
 *
 * Order matters — earlier branches win:
 *   1. `alreadyIssued` short-circuit (caller-supplied).
 *   2. Gateway support gate.
 *   3. Amount gate (≤ 0 → non_billable).
 *   4. taxId present? → validate → company → factura; individual → boleta.
 *   5. taxId absent → email + legalName → boleta.
 *   6. Else → missing_payer_contact (queue should escalate to human review).
 */
export function decideDteIssue(
  req: DteIssueRequest,
  options: DecideDteIssueOptions = {},
): DteIssueDecision {
  const idempotencyKey = buildIdempotencyKey(req.paymentId, req.tenantId);
  const base = {
    idempotencyKey,
    amountClp: req.amountClp,
    paymentGateway: req.paymentGateway,
  };

  if (options.alreadyIssued) {
    return {
      ...base,
      shouldIssue: false,
      documentKind: 'none',
      reason: 'already_issued',
    };
  }

  if (!SUPPORTED_GATEWAYS.has(req.paymentGateway)) {
    return {
      ...base,
      shouldIssue: false,
      documentKind: 'none',
      reason: 'unsupported_gateway',
    };
  }

  if (!Number.isFinite(req.amountClp) || req.amountClp <= 0) {
    return {
      ...base,
      shouldIssue: false,
      documentKind: 'none',
      reason: 'non_billable',
    };
  }

  const trimmedTaxId = (req.payerInfo.taxId ?? '').trim();
  if (trimmedTaxId.length > 0) {
    const classification = classifyChileanTaxId(trimmedTaxId);
    if (classification.kind === 'invalid') {
      return {
        ...base,
        shouldIssue: false,
        documentKind: 'none',
        reason: 'invalid_tax_id',
      };
    }
    if (classification.kind === 'company') {
      return {
        ...base,
        shouldIssue: true,
        documentKind: 'factura_electronica',
        reason: 'has_company_tax_id',
      };
    }
    // Individual RUT — treat same as boleta consumer path (still need email).
    // Fall through to the email check below.
  }

  const email = (req.payerInfo.email ?? '').trim();
  const legalName = (req.payerInfo.legalName ?? '').trim();
  if (email.length > 0 && legalName.length > 0) {
    return {
      ...base,
      shouldIssue: true,
      documentKind: 'boleta_electronica',
      reason: 'individual_consumer',
    };
  }

  return {
    ...base,
    shouldIssue: false,
    documentKind: 'none',
    reason: 'missing_payer_contact',
  };
}
