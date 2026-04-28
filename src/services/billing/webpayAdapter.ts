// Praeventio Guard — Webpay/Transbank adapter (REAL IMPLEMENTATION).
//
// This module wraps the official `transbank-sdk` (`WebpayPlus.Transaction`)
// behind our internal `WebpayAdapter` contract so the rest of the codebase
// stays SDK-agnostic. The adapter:
//
//   • Defaults to Transbank's "Tienda de Integración" sandbox credentials
//     (so dev/CI never hits production by accident).
//   • Switches to env-supplied production credentials when
//     `WEBPAY_COMMERCE_CODE` + `WEBPAY_API_KEY` are set, with optional
//     `WEBPAY_ENV='production'` to flip the environment URL.
//   • Maps Transbank's verbose `commit()` payload to a tight subset
//     (`status`, `buyOrder`, `amount`, `authorizationCode`, `cardLast4`)
//     and stashes the raw response on `raw` for the audit log.
//   • Throws `WebpayAdapterError` (subclass of `Error`) on SDK failures so
//     callers can `instanceof`-check rather than relying on string parsing.
//
// See BILLING.md → "Webpay setup" for env wiring + test card numbers.
//
// IMPORTANT (PCI scope): never log card PAN, CVV, or full Transbank
// payloads in production. The `raw` field on `WebpayCommitResult` is for
// server-side audit trails only — never serialize it back to the browser.

import {
  Environment,
  IntegrationApiKeys,
  IntegrationCommerceCodes,
  Options,
  WebpayPlus,
} from 'transbank-sdk';

export interface WebpayConfig {
  /** Transbank-issued commerce code. Read from `WEBPAY_COMMERCE_CODE`. */
  commerceCode: string;
  /** Transbank API key. Read from `WEBPAY_API_KEY`. */
  apiKey: string;
  environment: 'integration' | 'production';
}

export interface WebpayTransaction {
  /** Invoice id (used as Transbank `buy_order`, max 26 chars). */
  buyOrder: string;
  /** Per-user session id from our auth layer. */
  sessionId: string;
  /** CLP amount, no decimals. Validated against Transbank min/max. */
  amount: number;
  /** Where Transbank sends the user after the payment flow. */
  returnUrl: string;
}

export interface WebpayCreateResult {
  token: string;
  /** URL to which we redirect the user (token is appended as form field). */
  url: string;
}

export type WebpayCommitStatus = 'AUTHORIZED' | 'REJECTED' | 'FAILED';

export interface WebpayCommitResult {
  status: WebpayCommitStatus;
  /** Transbank authorization code when AUTHORIZED. */
  authorizationCode?: string;
  /** Original buy_order echoed back. */
  buyOrder: string;
  amount: number;
  /** Last 4 digits of card. Never log full PAN. */
  cardLast4?: string;
  /** Raw transbank response for audit; never expose to the client. */
  raw?: unknown;
}

export interface WebpayRefundResult {
  type: 'REVERSED' | 'NULLIFIED';
  authorizationCode?: string;
  authorizedAmount: number;
  /** Remaining balance after the refund (Transbank `balance` field). */
  balance?: number;
  raw?: unknown;
}

/**
 * Adapter contract. The runtime export below is the real implementation
 * backed by `transbank-sdk`. Tests inject a mock via `vi.mock(...)`.
 */
export interface WebpayAdapter {
  init(config: WebpayConfig): void;
  isConfigured(): boolean;
  createTransaction(tx: WebpayTransaction): Promise<WebpayCreateResult>;
  commitTransaction(token: string): Promise<WebpayCommitResult>;
  refundTransaction(token: string, amount: number): Promise<WebpayRefundResult>;
}

/**
 * Kept for backward compatibility with any callers that still
 * `instanceof`-check the old stub error. New code should use
 * `WebpayAdapterError` for real SDK failures.
 */
export class WebpayNotImplementedError extends Error {
  constructor(method: string) {
    super(
      `WebpayAdapter.${method}() not implemented yet. ` +
        `Wire transbank-sdk per BILLING.md before calling.`,
    );
    this.name = 'WebpayNotImplementedError';
  }
}

/** Thrown when the underlying Transbank SDK call fails. Wraps the cause. */
export class WebpayAdapterError extends Error {
  readonly method: string;
  readonly cause?: unknown;
  constructor(method: string, cause: unknown) {
    const causeMsg =
      cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : 'unknown error';
    super(`WebpayAdapter.${method}() failed: ${causeMsg}`);
    this.name = 'WebpayAdapterError';
    this.method = method;
    this.cause = cause;
  }
}

/** Holds adapter-level configuration once `init()` has been called. */
interface InternalState {
  options: Options | null;
  configured: boolean;
}

function buildIntegrationOptions(): Options {
  return new Options(
    IntegrationCommerceCodes.WEBPAY_PLUS,
    IntegrationApiKeys.WEBPAY,
    Environment.Integration,
  );
}

function buildOptionsFromConfig(config: WebpayConfig): Options {
  const env =
    config.environment === 'production'
      ? Environment.Production
      : Environment.Integration;
  return new Options(config.commerceCode, config.apiKey, env);
}

function readEnvOptions(): Options | null {
  const code = process.env.WEBPAY_COMMERCE_CODE;
  const key = process.env.WEBPAY_API_KEY;
  if (!code || !key) return null;
  const env =
    process.env.WEBPAY_ENV === 'production' ||
    process.env.WEBPAY_ENVIRONMENT === 'production'
      ? Environment.Production
      : Environment.Integration;
  return new Options(code, key, env);
}

/**
 * Transbank `response_code` values that indicate transient infrastructure
 * trouble (timeout / network / Transbank unavailable) rather than a card
 * decision. These are NOT card-side rejections — the user can simply retry
 * with the same card. Mapping them to `REJECTED` would lie to the customer
 * ("your card was declined") and steer the UI to a dead-end "try another
 * card" screen instead of the correct "retry" path.
 *
 * Source: Transbank Webpay Plus Webpay Plus REST docs, "Códigos de respuesta".
 */
const WEBPAY_TRANSIENT_RESPONSE_CODES: ReadonlySet<number> = new Set([
  -96, // Transbank timeout
  -97, // Network / connection failure between TBK and issuer
  -98, // Service unavailable
]);

/**
 * Map Transbank's verbose commit response to our compact `WebpayCommitResult`.
 *
 * Three-state mapping (do NOT collapse back to two — see Issue 1 in the
 * billing flow review):
 *
 *   - `response_code === 0 && status === 'AUTHORIZED'` → `'AUTHORIZED'`.
 *   - `response_code` ∈ {-1..-8} (and any other negative not in the
 *     transient set) → `'REJECTED'`. Card-side decline; user should try a
 *     different card.
 *   - `response_code` ∈ {-96, -97, -98} → `'FAILED'`. Transient infra
 *     issue; user should retry the same card.
 *   - Anything else (no `response_code`, malformed shape, etc.) → `'FAILED'`
 *     defensively. Preserves the retry path; never silently treats a
 *     malformed response as a hard card decline.
 */
function mapCommitResponse(response: any): WebpayCommitResult {
  const responseCode: unknown = response?.response_code;
  const responseStatus: unknown = response?.status;
  let status: WebpayCommitStatus;

  if (responseCode === 0 && responseStatus === 'AUTHORIZED') {
    status = 'AUTHORIZED';
  } else if (
    typeof responseCode === 'number' &&
    WEBPAY_TRANSIENT_RESPONSE_CODES.has(responseCode)
  ) {
    status = 'FAILED';
  } else if (typeof responseCode === 'number' && responseCode < 0) {
    status = 'REJECTED';
  } else {
    // Malformed: no response_code, or a positive non-zero code we don't
    // recognise. Fail-soft to FAILED so the user gets a retry, not a
    // misleading "card declined" page.
    status = 'FAILED';
  }

  return {
    status,
    authorizationCode: response?.authorization_code ?? undefined,
    buyOrder: response?.buy_order ?? '',
    amount: typeof response?.amount === 'number' ? response.amount : 0,
    cardLast4:
      typeof response?.card_detail?.card_number === 'string'
        ? response.card_detail.card_number.slice(-4)
        : undefined,
    raw: response,
  };
}

function mapRefundResponse(response: any, requestedAmount: number): WebpayRefundResult {
  const rawType = (response?.type ?? '').toString().toUpperCase();
  const type: WebpayRefundResult['type'] =
    rawType === 'REVERSED' ? 'REVERSED' : 'NULLIFIED';
  return {
    type,
    authorizationCode: response?.authorization_code ?? undefined,
    authorizedAmount:
      typeof response?.nullified_amount === 'number'
        ? response.nullified_amount
        : requestedAmount,
    balance: typeof response?.balance === 'number' ? response.balance : undefined,
    raw: response,
  };
}

const state: InternalState = {
  options: null,
  configured: false,
};

function resolveOptions(): Options {
  // Priority: explicit init() > env vars > sandbox defaults.
  if (state.options) return state.options;
  const fromEnv = readEnvOptions();
  if (fromEnv) return fromEnv;
  return buildIntegrationOptions();
}

/**
 * Real Transbank-backed adapter. Same shape as the previous stub so
 * existing imports in `server.ts` continue to compile.
 */
export const webpayAdapter: WebpayAdapter = {
  init(config: WebpayConfig): void {
    state.options = buildOptionsFromConfig(config);
    state.configured = Boolean(config.commerceCode && config.apiKey);
  },
  isConfigured(): boolean {
    if (state.configured) return true;
    return Boolean(
      process.env.WEBPAY_COMMERCE_CODE && process.env.WEBPAY_API_KEY,
    );
  },
  async createTransaction(tx: WebpayTransaction): Promise<WebpayCreateResult> {
    try {
      const txService = new WebpayPlus.Transaction(resolveOptions());
      const response = await txService.create(
        tx.buyOrder,
        tx.sessionId,
        tx.amount,
        tx.returnUrl,
      );
      return { token: response.token, url: response.url };
    } catch (err) {
      throw new WebpayAdapterError('createTransaction', err);
    }
  },
  async commitTransaction(token: string): Promise<WebpayCommitResult> {
    try {
      const txService = new WebpayPlus.Transaction(resolveOptions());
      const response = await txService.commit(token);
      return mapCommitResponse(response);
    } catch (err) {
      throw new WebpayAdapterError('commitTransaction', err);
    }
  },
  async refundTransaction(token: string, amount: number): Promise<WebpayRefundResult> {
    try {
      const txService = new WebpayPlus.Transaction(resolveOptions());
      const response = await txService.refund(token, amount);
      return mapRefundResponse(response, amount);
    } catch (err) {
      throw new WebpayAdapterError('refundTransaction', err);
    }
  },
};

/** Test-only helper. Resets the module-level config so each test is hermetic. */
export function __resetWebpayAdapterStateForTests(): void {
  state.options = null;
  state.configured = false;
}

// ───────────────────────────────────────────────────────────────────────────
// Idempotency: `processed_webpay/{token_ws}` lock-then-complete.
//
// Webpay can redeliver the return-URL token within milliseconds (browser
// reload, double-tap, network retry). Two concurrent hits to
// `/billing/webpay/return` would both pass a naive "is invoice already
// paid?" check, so we move the dedupe to a server-only Firestore doc
// keyed by `token_ws` — mirroring the Google Play RTDN handler's
// `processed_pubsub` pattern.
//
// Doc shape (server-only — `processed_webpay` is intentionally NOT readable
// by clients; the firestore.rules default-deny applies, see header TODO):
//
//   {
//     status: 'in_progress' | 'done',
//     lockedAtMs: number,                       // entry millis (server clock)
//     outcome?: 'paid' | 'rejected' | 'failed', // present when status='done'
//     invoiceId?: string,                       // for replay-redirect
//     completedAt?: Timestamp,
//     expiresAt?: Date                          // hint for Firestore TTL
//   }
//
// We pass in the document ref so callers wire it to the Admin SDK, and so
// these helpers stay unit-testable with a fake ref. We deliberately do NOT
// import `firebase-admin` here — that keeps this file mockable from
// vitest without spinning up the SDK.
// ───────────────────────────────────────────────────────────────────────────

/** Webpay return URL outcome categories — narrower than the SDK shape. */
export type WebpayReturnOutcome = 'paid' | 'rejected' | 'failed';

/** Stale-lock window. After this elapses, a redelivery may steal the lock. */
export const WEBPAY_IDEMPOTENCY_STALE_LOCK_MS = 5 * 60 * 1000;

/**
 * Minimal Firestore-document-ref contract used by these helpers. We only
 * lean on the Admin SDK shape (`get`, `set` with `{ merge: true }`,
 * `update`) so tests can pass a `vi.fn()`-backed stub.
 */
export interface WebpayLockDocRef {
  get(): Promise<{ exists: boolean; data(): Record<string, any> | undefined }>;
  set(data: Record<string, any>, options?: { merge?: boolean }): Promise<unknown>;
  update(data: Record<string, any>): Promise<unknown>;
}

export interface AcquireWebpayLockResult {
  /** True iff this caller is now the owner and should run the work. */
  acquired: boolean;
  /** True if the lock was already in 'done' state (duplicate redelivery). */
  alreadyDone?: boolean;
  /** True if another worker holds a fresh in_progress lock. */
  inFlight?: boolean;
  /** Outcome from a prior 'done' run, used to replay the original redirect. */
  outcome?: WebpayReturnOutcome;
  /** Invoice id captured by the prior 'done' run. */
  invoiceId?: string;
}

/**
 * Step 1 of the lock-then-complete dance. Reads the doc, decides whether
 * this caller may proceed, and (if yes) writes `status: 'in_progress'`.
 *
 * The states are the same four buckets as in the RTDN handler:
 *   - absent           → write in_progress, acquired=true.
 *   - status === done  → duplicate; acquired=false, alreadyDone=true,
 *                        outcome+invoiceId returned for replay-redirect.
 *   - in_progress fresh → acquired=false, inFlight=true. Caller should
 *                        redirect to a "still processing" page (we use
 *                        /pricing/success and let UI handle eventual
 *                        consistency, mirroring RTDN's ack-200 strategy).
 *   - in_progress stale → steal the lock; acquired=true.
 *
 * We never throw on a normal Firestore-empty path; only a transport-level
 * error from `.get()` / `.set()` would propagate (caller's catch handler
 * preserves the in_progress doc so the staleness window allows retry).
 */
export async function acquireWebpayIdempotencyLock(
  ref: WebpayLockDocRef,
  now: () => number = () => Date.now(),
): Promise<AcquireWebpayLockResult> {
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() ?? {};
    if (data.status === 'done') {
      return {
        acquired: false,
        alreadyDone: true,
        outcome: data.outcome as WebpayReturnOutcome | undefined,
        invoiceId: typeof data.invoiceId === 'string' ? data.invoiceId : undefined,
      };
    }
    if (data.status === 'in_progress') {
      const lockedAtMs = typeof data.lockedAtMs === 'number' ? data.lockedAtMs : 0;
      if (lockedAtMs && now() - lockedAtMs < WEBPAY_IDEMPOTENCY_STALE_LOCK_MS) {
        return { acquired: false, inFlight: true };
      }
      // Stale lock — fall through and steal it.
    }
  }

  // Fresh, or stale lock being stolen. Note the ms timestamp is for the
  // helper's own staleness math; callers may also pass `lockedAt` as a
  // server timestamp (Admin SDK FieldValue) for human-readable audit.
  const lockedAtMs = now();
  const expiresAt = new Date(lockedAtMs + 7 * 24 * 60 * 60 * 1000); // TTL hint
  await ref.set(
    {
      status: 'in_progress',
      lockedAtMs,
      receivedAtMs: lockedAtMs,
      expiresAt,
    },
    { merge: true },
  );
  return { acquired: true };
}

export interface FinalizeWebpayLockArgs {
  outcome: WebpayReturnOutcome;
  invoiceId: string;
  /** Optional Firestore server timestamp factory (Admin SDK). */
  serverTimestamp?: () => unknown;
}

/**
 * Step 2 of the lock-then-complete dance. Marks the doc `status: 'done'`
 * with outcome + invoiceId so a future redelivery can replay the original
 * redirect (paid → /pricing/success, rejected → /pricing/failed,
 * failed → /pricing/retry).
 *
 * BEST-EFFORT: this never throws. If the finalize write fails (Firestore
 * blip), we log and return; the caller has already done the real work,
 * and worst case is a duplicate run after the staleness window. This
 * mirrors the RTDN handler's `rtdn_idempotency_finalize_failed` warning.
 */
export async function finalizeWebpayIdempotencyLock(
  ref: WebpayLockDocRef,
  args: FinalizeWebpayLockArgs,
): Promise<void> {
  try {
    const completedAt = args.serverTimestamp ? args.serverTimestamp() : new Date();
    await ref.update({
      status: 'done',
      outcome: args.outcome,
      invoiceId: args.invoiceId,
      completedAt,
    });
  } catch {
    // Best-effort; silent. The work is already complete; staleness window
    // allows a future redelivery to retry the finalize step if needed.
  }
}
