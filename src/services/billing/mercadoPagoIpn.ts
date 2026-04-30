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
import { jwtVerify, importJWK, errors as joseErrors, type JWTPayload } from 'jose';

import { mercadoPagoAdapter } from './mercadoPagoAdapter.js';
import { withIdempotency } from './idempotency.js';
import { canonicalize } from '../../server/middleware/canonicalBody.js';
import { logger } from '../../utils/logger.js';
import {
  getJwks,
  type JsonWebKey as MpJsonWebKey,
} from './mpJwksCache.js';

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
// Round 19 (A9) → Round 20 (A5) — OIDC JWT verification.
//
// MercadoPago is migrating IPN authentication from `x-signature` HMAC over
// the canonical body (Round 18 R6) to an OIDC scheme: each delivery carries
// `Authorization: Bearer <jwt>` where the JWT is RS256-signed by an MP key
// published at MP's JWKS endpoint. The HMAC mode is preserved as a fallback
// (see route handler — precedence: OIDC > HMAC > LEGACY_HMAC_FALLBACK).
//
// R19 A9 shipped a ~120 LOC in-house RS256 verifier (split compact JWS →
// decode header/payload → crypto.createPublicKey + crypto.verify) explicitly
// to avoid a transitive coupling to an undeclared `jose` package.
//
// R20 A5 declares `jose` as a direct dependency in package.json and swaps
// the in-house verifier for `jose.jwtVerify` + `jose.importJWK`. Rationale:
//   • Library-grade timing-safe verification, audited surface for alg/exp/aud.
//   • Removes ~120 LOC of crypto plumbing we own and must maintain.
//   • Smaller attack surface — no risk of subtle bugs in our base64url
//     padding or JWK→PEM coercion.
//
// Pattern A is preserved (we still call `getJwks()` from `mpJwksCache.ts`
// then import the matching JWK into a CryptoKey via `importJWK`). This is
// intentional: the cache exposes test seams (`_setJwksFetcherForTests`,
// `_resetMpJwksCacheForTests`) the existing test suite relies on. jose's
// `createRemoteJWKSet` would be one line shorter but would re-fetch over
// the network on every test run, removing those seams.
// ───────────────────────────────────────────────────────────────────────────

/** Outcome of an MP OIDC JWT verification. */
export interface MpOidcVerifyResult {
  /** True iff every check (signature, iss, aud, exp) passed. */
  valid: boolean;
  /** Echoed `payer.email` / `email` claim if present, for audit. */
  payerEmail?: string;
  /** JWT `exp` claim (seconds since epoch) if present. */
  expiresAt?: number;
  /** Short-form reason on failure — for logs/audit, never user-facing. */
  reason?: string;
}

/** Default MP OIDC issuer. Override with MP_OIDC_ISSUER env var. */
const DEFAULT_MP_ISSUER = 'https://api.mercadopago.com';

/**
 * Decode a base64url string (JWT segments use base64url, not base64).
 * Used only to peek at the protected header so we can resolve `kid` from
 * `mpJwksCache` before handing the full token to `jose.jwtVerify`.
 * jose itself exposes `decodeProtectedHeader`, but inlining a 3-line
 * decoder here keeps the per-failure `reason` codes (`malformed_jwt`)
 * stable for callers that already log them.
 */
function decodeBase64Url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

/**
 * Pick the matching signing key from a JWKS by `kid`. If the JWT advertises
 * no `kid`, fall back to the first RSA signing key — same shape as before
 * the jose swap so MP-signed tokens without a `kid` continue to verify.
 */
function findKey(
  keys: MpJsonWebKey[],
  kid: string | undefined,
): MpJsonWebKey | undefined {
  if (!kid) {
    return keys.find((k) => k.kty === 'RSA');
  }
  return keys.find((k) => k.kid === kid);
}

/**
 * Map a `jose` error onto our short-form reason vocabulary so callers
 * logging `reason` see no behaviour drift on the swap from the in-house
 * verifier. Anything we don't recognise collapses to `verify_failed:<msg>`.
 */
function joseErrorToReason(err: unknown): string {
  if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
    return 'signature_mismatch';
  }
  if (err instanceof joseErrors.JWTExpired) {
    return 'expired';
  }
  if (err instanceof joseErrors.JWTClaimValidationFailed) {
    const claim = (err as { claim?: string }).claim;
    if (claim === 'iss') return 'issuer_mismatch';
    if (claim === 'aud') return 'audience_mismatch';
    if (claim === 'exp') return 'expired';
    return 'claim_invalid';
  }
  if (err instanceof joseErrors.JOSEAlgNotAllowed) {
    return 'unsupported_alg';
  }
  if (err instanceof joseErrors.JWSInvalid || err instanceof joseErrors.JWTInvalid) {
    return 'malformed_jwt';
  }
  return `verify_failed:${err instanceof Error ? err.message : String(err)}`;
}

/**
 * Verify a MercadoPago IPN OIDC JWT.
 *
 * Inputs:
 *   • authHeader — the raw `Authorization` header value (e.g.
 *                  `Bearer eyJhbGc...`). Empty/missing returns valid=false.
 *
 * Returns `{valid, payerEmail?, expiresAt?, reason?}`. The route handler
 * inspects `valid` only; the extra fields are exposed for audit logging
 * and future routing decisions.
 *
 * Env knobs:
 *   • MP_OIDC_ISSUER  — override the expected `iss` claim.
 *                       Default: https://api.mercadopago.com
 *   • MP_OIDC_AUDIENCE — REQUIRED. Our app's MP client id; used to check
 *                       the `aud` claim. If unset, every JWT is rejected
 *                       (fail-closed) so a misconfigured deploy can't
 *                       silently accept everything.
 *   • MP_OIDC_CLOCK_TOLERANCE_SEC — optional clock-skew tolerance in
 *                       seconds passed through to `jose.jwtVerify`.
 *                       Default: 0 (strict).
 *
 * R20 A5: implemented via `jose.jwtVerify` + `jose.importJWK`. The JWKS
 * cache (`mpJwksCache.getJwks`) is preserved so test seams keep working;
 * jose only handles signature + claim validation against the resolved key,
 * not network fetch.
 *
 * NOT exported as a default — the route handler imports it by name and
 * gates the OIDC path on `Authorization: Bearer ...` being present.
 */
export async function verifyMercadoPagoIpnOidc(
  authHeader: string | undefined | null,
): Promise<MpOidcVerifyResult> {
  if (typeof authHeader !== 'string' || authHeader.length === 0) {
    return { valid: false, reason: 'missing_auth_header' };
  }
  if (!authHeader.startsWith('Bearer ')) {
    return { valid: false, reason: 'not_bearer_scheme' };
  }
  const token = authHeader.slice('Bearer '.length).trim();
  // Defensive caps: a JWT > 8 KB is almost certainly garbage / abuse.
  if (token.length === 0 || token.length > 8192) {
    return { valid: false, reason: 'malformed_jwt' };
  }

  // Peek at the header so we can resolve `kid` against our cache before
  // jose consumes the token. We do NOT trust the parsed `alg` here —
  // jose enforces it via `algorithms: ['RS256']` and rejects alg=none /
  // alg-confusion attacks at verify time.
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { valid: false, reason: 'malformed_jwt' };
  }
  let header: { alg?: string; kid?: string; typ?: string };
  try {
    header = JSON.parse(decodeBase64Url(parts[0]).toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed_jwt' };
  }

  // Fail-closed on the audience BEFORE any jose work — same behaviour as
  // R19. If operators forgot to set the audience, ALL tokens would
  // otherwise pass the audience check, silently accepting any MP-signed
  // JWT (cross-tenant). Reject and log.
  const expectedAudience = process.env.MP_OIDC_AUDIENCE;
  if (!expectedAudience) {
    logger.warn('mp_oidc_audience_unset', {});
    return { valid: false, reason: 'audience_not_configured' };
  }
  const expectedIssuer = process.env.MP_OIDC_ISSUER || DEFAULT_MP_ISSUER;

  // Resolve the signing key. If the `kid` isn't in the cached JWKS, force
  // a refresh ONCE and try again — this is the documented refresh-on-401
  // path from mpJwksCache.ts. We still own this loop (rather than handing
  // it to jose.createRemoteJWKSet) so the cache's test seams stay live.
  let keys: MpJsonWebKey[];
  try {
    keys = (await getJwks(false)).keys;
  } catch (err) {
    return {
      valid: false,
      reason: `jwks_fetch_failed:${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let jwk = findKey(keys, header.kid);
  if (!jwk) {
    try {
      keys = (await getJwks(true)).keys;
      jwk = findKey(keys, header.kid);
    } catch (err) {
      return {
        valid: false,
        reason: `jwks_force_refresh_failed:${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }
  if (!jwk || !jwk.n || !jwk.e) {
    return { valid: false, reason: 'kid_not_found' };
  }

  // Import the JWK and run the full verify (signature + iss/aud/exp +
  // alg allow-list) through jose. Optional clock-skew tolerance is read
  // at call time so tests can flip it without module re-init.
  let publicKey: Awaited<ReturnType<typeof importJWK>>;
  try {
    publicKey = await importJWK({ kty: jwk.kty, n: jwk.n, e: jwk.e }, 'RS256');
  } catch {
    return { valid: false, reason: 'jwk_to_key_failed' };
  }

  const clockToleranceRaw = process.env.MP_OIDC_CLOCK_TOLERANCE_SEC;
  const clockTolerance =
    typeof clockToleranceRaw === 'string' && /^\d+$/.test(clockToleranceRaw)
      ? Number(clockToleranceRaw)
      : 0;

  let payload: JWTPayload;
  try {
    const result = await jwtVerify(token, publicKey, {
      issuer: expectedIssuer,
      audience: expectedAudience,
      algorithms: ['RS256'],
      clockTolerance,
    });
    payload = result.payload;
  } catch (err) {
    const reason = joseErrorToReason(err);
    if (reason === 'expired') {
      // jose attaches the parsed payload on JWTExpired so we can echo
      // `expiresAt` back for audit. Best-effort — fall through to undefined
      // if the version we ship doesn't populate it.
      const exp = (err as { payload?: { exp?: number } }).payload?.exp;
      return {
        valid: false,
        reason,
        expiresAt: typeof exp === 'number' ? exp : undefined,
      };
    }
    return { valid: false, reason };
  }

  const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    // jose's default behaviour does not require `exp`. We do — preserve
    // the R19 contract and reject tokens missing exp explicitly.
    return { valid: false, reason: 'exp_missing' };
  }

  const payerEmail =
    (payload as { payer?: { email?: string } }).payer?.email ??
    (payload as { email?: string }).email;

  return {
    valid: true,
    payerEmail,
    expiresAt: exp,
  };
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

        // Round 22 — audit fix CRITICAL #3 (DT-03): activar suscripción
        // del usuario tras MP IPN approved. Mismo patrón que webpay
        // AUTHORIZED en billing.ts. Best-effort — no rompe el flow del IPN
        // (response a MP debe ser 200 ack); admin tiene mark-paid fallback.
        try {
          const invoiceSnap = await invoiceRef.get();
          const invoiceData = invoiceSnap.data();
          const lineItems = Array.isArray(invoiceData?.lineItems) ? invoiceData!.lineItems : [];
          const tierId = lineItems[0]?.tierId ?? invoiceData?.tierId ?? null;
          const ownerUid = invoiceData?.createdBy ?? null;
          if (ownerUid && tierId) {
            await db.collection('users').doc(ownerUid).set(
              {
                subscriptionPlan: tierId,
                subscription: {
                  planId: tierId,
                  status: 'active',
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  lastInvoiceId: invoiceId,
                  paymentMethod: 'mercadopago',
                },
              },
              { merge: true },
            );
            logger.info('mp_ipn_subscription_activated', { uid: ownerUid, tierId, invoiceId });
          } else {
            logger.warn('mp_ipn_subscription_missing_data', { ownerUid, tierId, invoiceId });
          }
        } catch (subErr) {
          logger.error('mp_ipn_subscription_update_failed', subErr as Error, { invoiceId });
        }
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
