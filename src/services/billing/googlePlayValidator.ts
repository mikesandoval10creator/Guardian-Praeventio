// Praeventio Guard — Google Play subscription receipt validator.
//
// Sprint 39 P0.3 — closes the Google Play "client receipt trust" gap.
// Before this module shipped, POST /api/billing/google-play/validate-receipt
// only logged the attempt and returned 202 — the actual entitlement grant
// depended on the RTDN webhook firing. That meant:
//   1. Users who paid but whose RTDN was delayed (Pub/Sub backlog) had
//      to wait minutes — sometimes hours — before their subscription
//      activated.
//   2. There was no synchronous "did this purchase actually happen?"
//      check; the server trusted the client's receipt blindly.
//
// This validator performs the synchronous server-to-server check against
// Google Play Developer API v3 using `purchases.subscriptionsv2.get`
// (the canonical 2024+ endpoint that handles base-plans/offers; legacy
// v1 cannot represent multi-line subscriptions). It is invoked from the
// /validate-receipt route to grant entitlement immediately on a valid
// purchase, while the RTDN webhook continues to handle renewals,
// cancellations, and refunds asynchronously.
//
// Auth: Google Auth Library `GoogleAuth` with the
// `https://www.googleapis.com/auth/androidpublisher` scope. ADC is
// preferred — set `GOOGLE_APPLICATION_CREDENTIALS` to the service
// account JSON path in dev, or use Workload Identity in Cloud Run.
//
// Defense-in-depth checks (in order):
//   1. Subscription state is in the "granted" set.
//   2. Line item productId matches the client-claimed productId
//      (prevents a valid receipt for product A being claimed as B).
//   3. Line item expiry is in the future.
//   4. testPurchase is false (or explicitly allowed via env).
//   5. acknowledgementState — auto-acknowledge if pending (Google
//      auto-refunds purchases unacknowledged for >3 days).
//
// Reference:
//   https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2/get
//   https://developer.android.com/google/play/billing/lifecycle/subscriptions

import { google, androidpublisher_v3 } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

import { logger } from '../../utils/logger.js';

// ───────────────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────────────

export type GooglePlayValidationFailureReason =
  | 'config_missing'         // env vars not set — operator error, not user fraud
  | 'token_not_found'        // 404 — forged or wrong package
  | 'token_invalid'          // 400 — malformed token
  | 'token_replaced'         // 410 — superseded by linkedPurchaseToken
  | 'product_mismatch'       // valid receipt, but for a different product than claimed
  | 'subscription_inactive'  // subscriptionState not in GRANTED_STATES
  | 'expired'                // expiry already passed
  | 'test_purchase'          // license-tester account, prod doesn't allow these
  | 'permission_denied'      // 401/403 — SA misconfigured (operator error)
  | 'transient_error';       // 5xx/429 — retryable

export interface GooglePlayValidationSuccess {
  ok: true;
  /** Epoch ms — when access expires. Use this to set the Firestore TTL. */
  expiryMs: number;
  /** ISO 3166-1 alpha-2, e.g. "CL". Comes from Google. */
  regionCode: string | null;
  /** If present, the token was upgraded — the previous token is dead. */
  linkedPurchaseToken: string | null;
  /** The verified productId from Google (post-mismatch check). */
  productId: string;
  /** Raw subscription state for audit. */
  subscriptionState: string;
}

export interface GooglePlayValidationFailure {
  ok: false;
  reason: GooglePlayValidationFailureReason;
  /** Operator-facing message — safe to log, NOT safe to surface to the user. */
  detail: string;
}

export type GooglePlayValidationResult =
  | GooglePlayValidationSuccess
  | GooglePlayValidationFailure;

// ───────────────────────────────────────────────────────────────────────────
// Subscription states that grant entitlement.
//
// `SUBSCRIPTION_STATE_CANCELED` is included because a cancelled subscription
// remains active until its current paid period expires — the user is entitled
// to the benefit they paid for. The actual loss-of-access happens when expiry
// passes (checked separately).
// ───────────────────────────────────────────────────────────────────────────
const GRANTED_STATES = new Set<string>([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED',
]);

// ───────────────────────────────────────────────────────────────────────────
// Client singleton — built lazily so importing this module in a unit-test
// context (no ADC, no env) does not crash at module load.
//
// `getClient()` returns null when the required env vars are missing. The
// route handler maps that to a `config_missing` failure (502), not a
// silent grant.
// ───────────────────────────────────────────────────────────────────────────
let cachedClient: androidpublisher_v3.Androidpublisher | null = null;

/**
 * Optional injection point for tests. When set, used in lieu of the real
 * googleapis client.
 */
let injectedClient: androidpublisher_v3.Androidpublisher | null = null;

export function __setGooglePlayClientForTests(
  client: androidpublisher_v3.Androidpublisher | null,
): void {
  injectedClient = client;
  cachedClient = null;
}

function getClient(): androidpublisher_v3.Androidpublisher | null {
  if (injectedClient) return injectedClient;
  if (cachedClient) return cachedClient;
  // ADC: works with GOOGLE_APPLICATION_CREDENTIALS or Workload Identity.
  // We do NOT pass an explicit keyFile here so the same code works in
  // both dev (env var) and Cloud Run (metadata server).
  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });
    cachedClient = google.androidpublisher({ version: 'v3', auth });
    return cachedClient;
  } catch (err) {
    logger.warn('google_play_validator_client_init_failed', {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Validate a Google Play purchase token against the Play Developer API.
 *
 * Returns `{ ok: true, ... }` only when ALL defense-in-depth checks pass.
 * Any failure returns `{ ok: false, reason, detail }` — callers should
 * map `reason` to an HTTP status (400 vs 401 vs 502) and never echo
 * `detail` to the user.
 */
export async function validateGooglePlaySubscription(
  purchaseToken: string,
  claimedProductId: string,
): Promise<GooglePlayValidationResult> {
  const packageName = process.env.ANDROID_PACKAGE_NAME;
  if (!packageName) {
    return {
      ok: false,
      reason: 'config_missing',
      detail: 'ANDROID_PACKAGE_NAME env var is not set',
    };
  }

  const allowTestPurchases =
    process.env.GOOGLE_PLAY_ALLOW_TEST_PURCHASES === 'true';

  const client = getClient();
  if (!client) {
    return {
      ok: false,
      reason: 'config_missing',
      detail: 'GoogleAuth client could not be initialised (check GOOGLE_APPLICATION_CREDENTIALS)',
    };
  }

  // googleapis overloaded signatures resolve to `void` under strict TS in
  // some versions; pin the response shape via `any` cast and re-narrow on
  // `.data`.
  let response: { data: androidpublisher_v3.Schema$SubscriptionPurchaseV2 };
  try {
    response = (await client.purchases.subscriptionsv2.get({
      packageName,
      token: purchaseToken,
    })) as unknown as { data: androidpublisher_v3.Schema$SubscriptionPurchaseV2 };
  } catch (err: any) {
    return classifyGoogleApiError(err);
  }

  const data = response.data;

  // Check 1: test purchase gate (license-tester accounts).
  if (data.testPurchase && !allowTestPurchases) {
    return {
      ok: false,
      reason: 'test_purchase',
      detail:
        'Token is from a license-tester account; set GOOGLE_PLAY_ALLOW_TEST_PURCHASES=true to allow in staging',
    };
  }

  // Check 2: subscription state.
  const subscriptionState = data.subscriptionState ?? 'SUBSCRIPTION_STATE_UNSPECIFIED';
  if (!GRANTED_STATES.has(subscriptionState)) {
    return {
      ok: false,
      reason: 'subscription_inactive',
      detail: `Subscription state ${subscriptionState} does not grant entitlement`,
    };
  }

  // Check 3: line item product match.
  const lineItem = (data.lineItems ?? []).find(
    (li) => li.productId === claimedProductId,
  );
  if (!lineItem) {
    return {
      ok: false,
      reason: 'product_mismatch',
      detail: `Claimed productId ${claimedProductId} not in subscription lineItems`,
    };
  }

  // Check 4: expiry is in the future.
  if (!lineItem.expiryTime) {
    return {
      ok: false,
      reason: 'subscription_inactive',
      detail: 'Line item missing expiryTime',
    };
  }
  const expiryMs = Date.parse(lineItem.expiryTime);
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
    return {
      ok: false,
      reason: 'expired',
      detail: `Line item expiryTime ${lineItem.expiryTime} is not in the future`,
    };
  }

  // Auto-acknowledge if pending — Google auto-refunds purchases that are
  // not acknowledged within 3 days. The v2 endpoint shares the
  // `acknowledgementState` field with v1 even though it's surfaced at
  // the line-item level for v2.
  if (
    data.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING'
  ) {
    try {
      await client.purchases.subscriptions.acknowledge({
        packageName,
        subscriptionId: claimedProductId,
        token: purchaseToken,
        requestBody: { developerPayload: '' },
      });
      logger.info('google_play_subscription_acknowledged', {
        productId: claimedProductId,
      });
    } catch (err) {
      // Acknowledgement failure is logged but does NOT fail the
      // validation — the user paid, they should be entitled. The next
      // RTDN renewal cycle will re-acknowledge if needed.
      logger.warn('google_play_acknowledge_failed', {
        productId: claimedProductId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: true,
    expiryMs,
    regionCode: data.regionCode ?? null,
    linkedPurchaseToken: data.linkedPurchaseToken ?? null,
    productId: lineItem.productId!,
    subscriptionState,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Error classification.
//
// The Node googleapis client throws `GaxiosError` with HTTP `code` and
// `errors[].reason`. We map those to our public failure reasons so the
// route handler can pick the right HTTP status and ops can grep on the
// reason.
// ───────────────────────────────────────────────────────────────────────────
function classifyGoogleApiError(err: any): GooglePlayValidationFailure {
  const status: number | undefined = err?.code ?? err?.response?.status;
  const reasonStr: string =
    err?.errors?.[0]?.reason ??
    err?.response?.data?.error?.errors?.[0]?.reason ??
    '';
  const message: string =
    err?.message ?? err?.response?.data?.error?.message ?? 'unknown';

  if (status === 404) {
    return {
      ok: false,
      reason: 'token_not_found',
      detail: `404 (${reasonStr || 'purchaseTokenNotFound'}): ${message}`,
    };
  }
  if (status === 410) {
    return {
      ok: false,
      reason: 'token_replaced',
      detail: `410 (${reasonStr || 'purchaseTokenNoLongerValid'}): ${message}`,
    };
  }
  if (status === 400) {
    return {
      ok: false,
      reason: 'token_invalid',
      detail: `400: ${message}`,
    };
  }
  if (status === 401 || status === 403) {
    return {
      ok: false,
      reason: 'permission_denied',
      detail: `${status}: ${message} — service account misconfigured`,
    };
  }
  if (status === 429 || (status !== undefined && status >= 500)) {
    return {
      ok: false,
      reason: 'transient_error',
      detail: `${status}: ${message}`,
    };
  }
  // Unknown / network — treat as transient so the client retries.
  return {
    ok: false,
    reason: 'transient_error',
    detail: `unclassified: ${message}`,
  };
}
