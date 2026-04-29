// Praeventio Guard — MercadoPago IPN handler.
//
// MP delivers payment notifications to /api/billing/webhook/mercadopago.
// This module wraps the two pure entry points the route handler calls:
//
//   1. verifyMercadoPagoIpnSignature(body, signature, secret)
//      — HMAC-SHA256 over the *raw* body. Returns true iff the signature
//        header matches `sha256=<hex>` in constant-time.
//
//   2. processMercadoPagoIpn(body)
//      — Re-fetches the payment from MP (the IPN body itself only echoes
//        the `id` — never the trusted state), maps MP `status` to one of
//        our three invoice outcomes, updates `invoices/{id}`, and writes
//        an audit log row. Idempotent via the shared `withIdempotency`
//        helper on `processed_mp_ipn/{paymentId}`.
//
// Round 18 R6 (R6→R17 MEDIUM #2): the canonical-JSON fix for HMAC inputs
// landed here AND on /api/telemetry/ingest in the same round. The
// signature input is now the RFC 8785 canonical-JSON form of the parsed
// body (sorted keys, no whitespace, shortest numeric form), produced by
// `canonicalize` in src/server/middleware/canonicalBody.ts. Producers
// (us when emitting test fixtures, MP if/when they accept arbitrary
// payloads) MUST canonicalise before HMACing — JSON.stringify is no
// longer the contract.
//
// This is intentionally a breaking change for any client that signed the
// legacy `JSON.stringify(req.body)` shape. For an emergency rollback,
// the route handler may set `LEGACY_HMAC_FALLBACK=1` and re-attempt
// verification under the old contract on a primary mismatch — see the
// Express handler at /api/billing/webhook/mercadopago for the call site.
//
// MP's production manifest format (`ts=<ts>,v1=<hex>` over
// id+request-id+ts) remains deferred to a later round — this module
// ships the simpler raw-HMAC variant over canonical body to retire the
// TODO at the head of mercadoPagoAdapter.ts.

import crypto from 'crypto';
import admin from 'firebase-admin';

import { mercadoPagoAdapter } from './mercadoPagoAdapter.js';
import { withIdempotency } from './idempotency.js';
import { canonicalize } from '../../server/middleware/canonicalBody.js';
import { logger } from '../../utils/logger.js';

/** Outcome of processing a MercadoPago IPN — maps to invoice statuses. */
export type MpIpnOutcome = 'paid' | 'rejected' | 'pending';

export interface MercadoPagoIpnBody {
  /** MP notification type. We only care about 'payment'; other types are no-ops. */
  type?: string;
  data?: { id?: string };
}

export interface MercadoPagoIpnResult {
  outcome: MpIpnOutcome;
  /** Echoed `external_reference` from the MP payment, or '' for non-payment types. */
  invoiceId: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Signature verification
// ───────────────────────────────────────────────────────────────────────────

/**
 * Constant-time compare two hex strings. Returns false if lengths differ —
 * the timingSafeEqual call still runs over a padded buffer so we don't leak
 * the expected length via wall-clock branching.
 */
function constantTimeHexEqual(a: string, b: string): boolean {
  // Pre-validate: both inputs must be hex of equal length (after the prefix
  // strip). A different length forces a false return without ever reaching
  // timingSafeEqual.
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  const padded = Buffer.alloc(bBuf.length);
  aBuf.copy(padded);
  const lengthOk = aBuf.length === bBuf.length;
  const valueOk = crypto.timingSafeEqual(padded, bBuf);
  return lengthOk && valueOk;
}

/**
 * Verify a MercadoPago IPN signature against the raw body using HMAC-SHA256.
 * Expected `signature` format: `sha256=<lowercase-hex>`.
 *
 * Returns false on:
 *   • empty/missing signature
 *   • missing `sha256=` prefix
 *   • length mismatch
 *   • bytewise mismatch
 *
 * NOTE (Round 18 R6): for new call sites prefer
 * `verifyMercadoPagoIpnSignatureFromBody(parsedBody, sig, secret, opts)` —
 * it canonicalises the body per RFC 8785 internally, which is the only
 * signing input compatible with non-Node producers. This raw-string
 * variant is preserved for tests and for hand-rolled transports that
 * already hold the exact bytes signed.
 */
export function verifyMercadoPagoIpnSignature(
  body: string,
  signature: string,
  secret: string,
): boolean {
  if (!signature || typeof signature !== 'string') return false;
  if (!secret || typeof secret !== 'string') return false;
  // Require explicit prefix so a future migration to `ts=...,v1=...` is
  // distinguishable from this `sha256=` variant.
  if (!signature.startsWith('sha256=')) return false;
  const provided = signature.slice('sha256='.length);
  // Hex sanity — an SHA-256 hex digest is exactly 64 chars.
  if (provided.length !== 64 || !/^[0-9a-f]+$/i.test(provided)) return false;

  const expectedHex = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return constantTimeHexEqual(provided.toLowerCase(), expectedHex.toLowerCase());
}

/**
 * Round 18 R6 — verify an MP IPN signature given the *parsed* body (the
 * shape Express delivers in `req.body`). This is the call site preferred
 * by the route handler. The signing input is the RFC 8785 canonical-JSON
 * form of `parsedBody` (sorted keys, no whitespace, shortest numeric
 * form), which is the same input MP producers MUST use to compute their
 * `x-signature` header.
 *
 * `LEGACY_HMAC_FALLBACK=1` env flag (read at call time) opens a one-shot
 * second-chance verification under the old `JSON.stringify(parsedBody)`
 * contract for emergency rollback. A successful legacy match emits a
 * `mp_ipn_hmac_legacy_fallback` warn log so operators can see who is
 * still on the old path. Default off — turn back off ASAP.
 *
 * Returns false on the same conditions as the raw-string variant.
 */
export function verifyMercadoPagoIpnSignatureFromBody(
  parsedBody: unknown,
  signature: string,
  secret: string,
): boolean {
  const canonical = canonicalize(parsedBody ?? {});
  if (verifyMercadoPagoIpnSignature(canonical, signature, secret)) {
    return true;
  }
  if (process.env.LEGACY_HMAC_FALLBACK === '1') {
    const legacy = JSON.stringify(parsedBody ?? {});
    if (verifyMercadoPagoIpnSignature(legacy, signature, secret)) {
      logger.warn('mp_ipn_hmac_legacy_fallback', {
        // Don't log the body — it may carry PII. Just enough to alert.
        type: (parsedBody as { type?: unknown } | null | undefined)?.type ?? null,
      });
      return true;
    }
  }
  return false;
}

// ───────────────────────────────────────────────────────────────────────────
// IPN processing
// ───────────────────────────────────────────────────────────────────────────

/**
 * Map MercadoPago payment `status` onto our invoice outcome.
 *
 * Reference: https://www.mercadopago.com.ar/developers/en/docs/checkout-pro/test-integration/test-cards
 *   approved      → paid
 *   in_mediation  → pending  (chargeback dispute — leave invoice alone)
 *   pending       → pending
 *   in_process    → pending  (MP still scoring the card)
 *   authorized    → pending  (pre-auth, not yet captured)
 *   rejected      → rejected
 *   cancelled     → rejected (user/admin cancelled before capture)
 *   refunded      → rejected (treat as not-paid; refund mechanics live elsewhere)
 *   charged_back  → rejected
 *   anything else → pending  (defensive — never lose money to a typo)
 */
function mapMpStatusToOutcome(status: string): MpIpnOutcome {
  switch (status) {
    case 'approved':
      return 'paid';
    case 'rejected':
    case 'cancelled':
    case 'refunded':
    case 'charged_back':
      return 'rejected';
    case 'pending':
    case 'in_process':
    case 'in_mediation':
    case 'authorized':
    default:
      return 'pending';
  }
}

/**
 * Process a MercadoPago IPN notification. Idempotent on `paymentId` via
 * `processed_mp_ipn/{paymentId}` — a redelivered MP webhook will short-circuit
 * to the previously captured outcome instead of re-fetching/re-writing.
 *
 * Throws on:
 *   • MP API call failures (caller's route handler returns 5xx so MP retries)
 *
 * Returns `{outcome:'pending', invoiceId:''}` for non-payment notification
 * types (`merchant_order`, etc.) — those are still ACK 200 by the route
 * handler so MP doesn't queue retries we'll never act on.
 */
export async function processMercadoPagoIpn(
  body: MercadoPagoIpnBody,
): Promise<MercadoPagoIpnResult> {
  // Round 18: only `payment` notifications carry a payment id we can fetch.
  // Other types (merchant_order, plan, subscription, point integration…)
  // would either need their own MP endpoint or are reconciled out-of-band.
  if (body.type !== 'payment') {
    logger.info('mp_ipn_skipped_non_payment', { type: body.type ?? null });
    return { outcome: 'pending', invoiceId: '' };
  }

  const paymentId = body.data?.id;
  if (typeof paymentId !== 'string' || paymentId.length === 0 || paymentId.length > 128) {
    throw new Error('mp_ipn_missing_payment_id');
  }

  const db = admin.firestore();

  // Idempotency: if we've processed this paymentId before, replay the
  // captured outcome. This protects against MP retrying after a transient
  // 5xx and against double-deliveries.
  const idempotency = await withIdempotency<MercadoPagoIpnResult>(
    db as any,
    { collection: 'processed_mp_ipn', key: paymentId },
    async (): Promise<MercadoPagoIpnResult> => {
      const payment = await mercadoPagoAdapter.getPayment(paymentId);
      const invoiceId = payment.external_reference;
      if (!invoiceId || typeof invoiceId !== 'string') {
        // No external_reference means we can't tie the payment to one of our
        // invoices — log and return pending (the audit row will let humans
        // reconcile). This is rare in practice because we always set
        // external_reference at preference creation time.
        logger.warn('mp_ipn_no_external_reference', { paymentId });
        return { outcome: 'pending', invoiceId: '' };
      }

      const outcome = mapMpStatusToOutcome(payment.status);

      // Update the invoice doc. We only flip status on terminal outcomes;
      // pending leaves the existing 'pending-payment' status intact.
      const invoiceRef = db.collection('invoices').doc(invoiceId);
      if (outcome === 'paid') {
        await invoiceRef.set(
          {
            status: 'paid',
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            paymentSource: 'mercadopago',
            mercadoPagoPaymentId: paymentId,
            mercadoPagoStatusDetail: payment.status_detail ?? null,
          },
          { merge: true },
        );
      } else if (outcome === 'rejected') {
        await invoiceRef.set(
          {
            status: 'rejected',
            paymentSource: 'mercadopago',
            mercadoPagoPaymentId: paymentId,
            rejectionReason: payment.status_detail ?? payment.status,
          },
          { merge: true },
        );
      }

      // Audit row — same shape as the other billing.* audit rows so dashboards
      // can split the funnel by payment rail.
      await db.collection('audit_logs').add({
        action: 'billing.mercadopago.ipn.processed',
        module: 'billing',
        details: {
          paymentId,
          outcome,
          invoiceId,
          mpStatus: payment.status,
          mpStatusDetail: payment.status_detail ?? null,
        },
        userId: null,
        userEmail: null,
        projectId: null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { outcome, invoiceId };
    },
  );

  if (idempotency.kind === 'duplicate') {
    // Replay captured outcome from the previous run. The shape of
    // previousResult matches MercadoPagoIpnResult by construction.
    const prev = idempotency.previousResult as MercadoPagoIpnResult | undefined;
    if (prev && typeof prev === 'object' && typeof prev.outcome === 'string') {
      return prev;
    }
    // Defensive fallback: previous result missing/malformed → return pending.
    return { outcome: 'pending', invoiceId: '' };
  }

  if (idempotency.kind === 'in-flight') {
    // Another worker holds a fresh lock — treat as pending so the route
    // handler ACKs 200 without claiming any specific outcome.
    return { outcome: 'pending', invoiceId: '' };
  }

  // fresh-success or stale-retry
  return idempotency.result;
}
