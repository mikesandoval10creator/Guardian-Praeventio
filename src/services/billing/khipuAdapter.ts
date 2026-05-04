// Praeventio Guard — Khipu adapter (REAL IMPLEMENTATION).
//
// Khipu (https://khipu.com/) is a Chilean payments gateway specialised in
// bank-transfer rails. It is the alternative to Webpay/Transbank for B2B
// customers (Titanio+) who pay by transferencia electrónica and don't want
// to ride the card network. This adapter mirrors the shape of
// `webpayAdapter.ts`:
//
//   • Exposes a tight `KhipuTransaction` / `KhipuCreateResult` /
//     `KhipuCommitResult` contract so callers stay SDK-agnostic.
//   • Defaults to Khipu's documented sandbox credentials (so dev / CI / E2E
//     never hit a real merchant).
//   • Uses the official REST API (POST /v3/payments) directly — Khipu does
//     NOT publish a Node SDK, so a small fetch wrapper is the canonical
//     surface and keeps dependencies thin.
//   • Wraps webhook HMAC verification in a constant-time compare with a
//     ±300 s timestamp drift window (replay defence).
//   • Emits failures through `withSentryScope('khipu', ...)` for ops
//     parity with the Webpay path.
//
// SECURITY (boundaries — see header note in webpayAdapter.ts):
//   - NEVER log `KHIPU_SECRET`, the raw HMAC, or the raw webhook body.
//   - NEVER serialise `raw` back to the browser; it is server-only audit data.
//   - HMAC verification uses `crypto.timingSafeEqual` on equal-length buffers.
//
// See BILLING.md → "Khipu setup" for env wiring + sandbox test flow.

import crypto from 'node:crypto';
import { withSentryScope } from '../observability/sentryInstrumentation';

// ───────────────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────────────

export interface KhipuConfig {
  /** Khipu-issued cobrador receiver id. Read from `KHIPU_RECEIVER_ID`. */
  receiverId: string;
  /** Khipu API secret (also signs webhook HMACs). Read from `KHIPU_SECRET`. */
  secret: string;
  environment: 'integration' | 'production';
}

export interface KhipuTransaction {
  /** Invoice id (used as Khipu `transaction_id` for idempotency). */
  buyOrder: string;
  /** Per-user session id from our auth layer. */
  sessionId: string;
  /** CLP amount, no decimals. */
  amount: number;
  /** Subject shown to the payer in the Khipu UI. */
  subject: string;
  /** Currency. Khipu CL only emits CLP. */
  currency: 'CLP';
  /** Where Khipu sends the user after a successful transfer. */
  returnUrl: string;
  /** Where Khipu sends the user when they cancel out. */
  cancelUrl: string;
  /** Khipu IPN endpoint on our server (signed POST). */
  notifyUrl: string;
}

export interface KhipuCreateResult {
  paymentId: string;
  /** Primary URL to which we redirect the user. */
  paymentUrl: string;
  /** Optional simplified flow URL (mobile-first single-bank). */
  simplifiedTransferUrl?: string;
  /** Optional traditional flow URL (multi-bank list). */
  transferUrl?: string;
  /** Optional deep link for the Khipu app. */
  appUrl?: string;
  /** ISO-8601 expiry timestamp. */
  expiresAt: string;
  /** Raw Khipu response. Server-only audit; never expose to clients. */
  raw: unknown;
}

/** Same shape as `WebpayCommitResult` (intentional — see header). */
export interface KhipuCommitResult {
  status: 'completed' | 'pending' | 'cancelled' | 'expired';
  buyOrder: string;
  amount: number;
  paymentId: string;
  raw: unknown;
}

/** Wraps any Khipu network or 4xx/5xx failure. Caller can `instanceof`-check. */
export class KhipuAdapterError extends Error {
  readonly method: string;
  readonly cause?: unknown;
  readonly statusCode?: number;
  constructor(method: string, cause: unknown, statusCode?: number) {
    const causeMsg =
      cause instanceof Error
        ? cause.message
        : typeof cause === 'string'
        ? cause
        : 'unknown error';
    super(`KhipuAdapter.${method}() failed: ${causeMsg}`);
    this.name = 'KhipuAdapterError';
    this.method = method;
    this.cause = cause;
    this.statusCode = statusCode;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// URLs
// ───────────────────────────────────────────────────────────────────────────

const KHIPU_INTEGRATION_BASE = 'https://payment-api.khipu.com/v3';
const KHIPU_PRODUCTION_BASE = 'https://payment-api.khipu.com/v3';
// Khipu uses the same hostname for both environments; the receiver_id +
// API key route the request to the right sandbox/production tenant.
// We keep two constants so a future hostname split is a one-line change.

function baseUrlFor(environment: KhipuConfig['environment']): string {
  return environment === 'production'
    ? KHIPU_PRODUCTION_BASE
    : KHIPU_INTEGRATION_BASE;
}

// ───────────────────────────────────────────────────────────────────────────
// Webhook HMAC tolerances
// ───────────────────────────────────────────────────────────────────────────

/** Maximum acceptable wall-clock skew between sender and receiver. */
export const KHIPU_WEBHOOK_DRIFT_TOLERANCE_SEC = 300;

// ───────────────────────────────────────────────────────────────────────────
// Adapter
// ───────────────────────────────────────────────────────────────────────────

export class KhipuAdapter {
  /**
   * Documented Khipu sandbox credentials. Receiver id `74400` is the public
   * "Cobros de prueba" demo cobrador and the secret below is the demo HMAC
   * key — both are explicitly published by Khipu for integration testing
   * and do NOT grant access to real funds. Replaced at runtime by env vars
   * for production.
   */
  static readonly SANDBOX_DEFAULTS: KhipuConfig = {
    receiverId: '74400',
    secret: 'cb061c060c2a3da3a9d9b3f4e2f7b8d9-test-sandbox',
    environment: 'integration',
  };

  readonly config: KhipuConfig;
  /** Injected fetch — production uses the global; tests pass a vi.fn(). */
  private readonly fetchImpl: typeof fetch;

  constructor(config: KhipuConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Build an adapter from process env. Falls back to `SANDBOX_DEFAULTS` if
   * either KHIPU_RECEIVER_ID or KHIPU_SECRET is missing — same fail-safe
   * behaviour as `webpayAdapter` so dev / CI / E2E never accidentally hit
   * a real merchant.
   */
  static fromEnv(fetchImpl: typeof fetch = fetch): KhipuAdapter {
    const receiverId = process.env.KHIPU_RECEIVER_ID;
    const secret = process.env.KHIPU_SECRET;
    const env =
      process.env.KHIPU_ENV === 'production' ? 'production' : 'integration';
    if (!receiverId || !secret) {
      return new KhipuAdapter(KhipuAdapter.SANDBOX_DEFAULTS, fetchImpl);
    }
    return new KhipuAdapter(
      { receiverId, secret, environment: env },
      fetchImpl,
    );
  }

  /** Whether explicit (non-sandbox) production credentials are in play. */
  isConfigured(): boolean {
    return Boolean(
      process.env.KHIPU_RECEIVER_ID && process.env.KHIPU_SECRET,
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // createPayment — POST /v3/payments
  // ─────────────────────────────────────────────────────────────────────
  async createPayment(tx: KhipuTransaction): Promise<KhipuCreateResult> {
    return withSentryScope(
      'khipu',
      { action: 'createPayment', buyOrder: tx.buyOrder, amount: tx.amount },
      async () => {
        const url = `${baseUrlFor(this.config.environment)}/payments`;
        const body = {
          amount: tx.amount,
          currency: tx.currency,
          subject: tx.subject,
          transaction_id: tx.buyOrder,
          return_url: tx.returnUrl,
          cancel_url: tx.cancelUrl,
          notify_url: tx.notifyUrl,
          notify_api_version: '3.0',
        };

        let response: Response;
        try {
          response = await this.fetchImpl(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.config.secret,
            },
            body: JSON.stringify(body),
          });
        } catch (err) {
          throw new KhipuAdapterError('createPayment', err);
        }

        if (!response.ok) {
          let detail: unknown = undefined;
          try {
            detail = await response.json();
          } catch {
            /* swallow body-parse fail; the status code is the signal */
          }
          throw new KhipuAdapterError(
            'createPayment',
            `Khipu returned ${response.status}`,
            response.status,
          );
          // `detail` is intentionally not embedded in the message — it may
          // contain echo of secret-bearing fields; ops should reach for
          // Sentry context (sanitized) instead.
          void detail;
        }

        let payload: any;
        try {
          payload = await response.json();
        } catch (err) {
          throw new KhipuAdapterError('createPayment', err);
        }

        return {
          paymentId: typeof payload.payment_id === 'string' ? payload.payment_id : '',
          paymentUrl: typeof payload.payment_url === 'string' ? payload.payment_url : '',
          simplifiedTransferUrl:
            typeof payload.simplified_transfer_url === 'string'
              ? payload.simplified_transfer_url
              : undefined,
          transferUrl:
            typeof payload.transfer_url === 'string' ? payload.transfer_url : undefined,
          appUrl: typeof payload.app_url === 'string' ? payload.app_url : undefined,
          expiresAt:
            typeof payload.expires_date === 'string' ? payload.expires_date : '',
          raw: payload,
        };
      },
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // getPaymentStatus — GET /v3/payments/{id}
  // ─────────────────────────────────────────────────────────────────────
  async getPaymentStatus(paymentId: string): Promise<KhipuCommitResult> {
    return withSentryScope(
      'khipu',
      { action: 'getPaymentStatus', paymentIdLength: paymentId?.length ?? 0 },
      async () => {
        const url = `${baseUrlFor(this.config.environment)}/payments/${encodeURIComponent(
          paymentId,
        )}`;

        let response: Response;
        try {
          response = await this.fetchImpl(url, {
            method: 'GET',
            headers: { 'x-api-key': this.config.secret },
          });
        } catch (err) {
          throw new KhipuAdapterError('getPaymentStatus', err);
        }

        if (!response.ok) {
          throw new KhipuAdapterError(
            'getPaymentStatus',
            `Khipu returned ${response.status}`,
            response.status,
          );
        }

        let payload: any;
        try {
          payload = await response.json();
        } catch (err) {
          throw new KhipuAdapterError('getPaymentStatus', err);
        }

        return mapKhipuStatus(payload);
      },
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // verifyWebhookSignature — HMAC-SHA256 over `${timestamp}.${rawBody}`
  // ─────────────────────────────────────────────────────────────────────
  /**
   * Verify a Khipu IPN signature header.
   *
   * Header format:  `t=<unix-seconds>,s=<lowercase-hex-sha256>`
   * Signed payload: `${timestamp}.${rawBody}` (HMAC-SHA256, key=secret).
   *
   * Returns false (never throws) on:
   *   - missing/malformed header
   *   - timestamp drift > KHIPU_WEBHOOK_DRIFT_TOLERANCE_SEC
   *   - HMAC mismatch
   *
   * The compare is constant-time via `crypto.timingSafeEqual` over equal-
   * length buffers; a length mismatch short-circuits without leaking timing.
   */
  verifyWebhookSignature(
    rawBody: string,
    signatureHeader: string,
    now: () => number = () => Math.floor(Date.now() / 1000),
  ): boolean {
    if (typeof signatureHeader !== 'string' || signatureHeader.length === 0) {
      return false;
    }
    const parts = signatureHeader.split(',').map((p) => p.trim());
    let timestamp: number | null = null;
    let signature: string | null = null;
    for (const part of parts) {
      if (part.startsWith('t=')) {
        const ts = Number(part.slice(2));
        if (Number.isFinite(ts)) timestamp = ts;
      } else if (part.startsWith('s=')) {
        signature = part.slice(2);
      }
    }
    if (timestamp === null || signature === null || signature.length === 0) {
      return false;
    }

    // Replay window: reject anything older than ±drift tolerance. We allow
    // a small future skew too in case the producer's clock runs slightly
    // ahead of ours.
    const drift = Math.abs(now() - timestamp);
    if (drift > KHIPU_WEBHOOK_DRIFT_TOLERANCE_SEC) {
      return false;
    }

    const expected = crypto
      .createHmac('sha256', this.config.secret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    // Equal-length buffers required by timingSafeEqual.
    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(signature, 'utf8');
    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }
    try {
      return crypto.timingSafeEqual(expectedBuf, actualBuf);
    } catch {
      return false;
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Status mapping — Khipu status codes → our four-state union.
//
// Khipu returns `status` ∈ { 'pending', 'verifying', 'done', 'failed' } and
// a separate `expires_date`. We collapse these to a tighter UX-relevant
// shape that mirrors `WebpayCommitResult.status`:
//
//   - 'done'                                  → 'completed'
//   - 'failed' / cancelled / cancelled-by-user → 'cancelled'
//   - now() > expires_date                    → 'expired'
//   - everything else (pending / verifying)   → 'pending'
//
// We deliberately fold `verifying` into `pending` — from the caller's POV
// the user has paid but the bank hasn't confirmed, which is exactly the
// "still waiting" UX the SPA shows on /pricing/retry.
// ───────────────────────────────────────────────────────────────────────────
function mapKhipuStatus(payload: any): KhipuCommitResult {
  const buyOrder: string =
    typeof payload?.transaction_id === 'string' ? payload.transaction_id : '';
  const amount: number = typeof payload?.amount === 'number' ? payload.amount : 0;
  const paymentId: string =
    typeof payload?.payment_id === 'string' ? payload.payment_id : '';
  const rawStatus: string =
    typeof payload?.status === 'string' ? payload.status.toLowerCase() : '';
  const expiresDate: string | undefined =
    typeof payload?.expires_date === 'string' ? payload.expires_date : undefined;

  let status: KhipuCommitResult['status'];
  if (rawStatus === 'done') {
    status = 'completed';
  } else if (rawStatus === 'failed' || rawStatus === 'cancelled') {
    status = 'cancelled';
  } else if (expiresDate && Date.parse(expiresDate) < Date.now()) {
    status = 'expired';
  } else {
    status = 'pending';
  }

  return { status, buyOrder, amount, paymentId, raw: payload };
}
