// Praeventio Guard — Apple App Store transaction validator.
//
// Sprint 39 P0.3 — closes the App Store "client receipt trust" gap.
// Mirrors googlePlayValidator: synchronous server-to-server validation
// of an iOS transactionId against Apple's App Store Server API. The SSN
// v2 webhook at /api/billing/webhook/apple continues to handle the
// async lifecycle events (renewals, refunds).
//
// Why this and not the legacy /verifyReceipt endpoint?
//   Apple deprecated /verifyReceipt in 2023 in favour of the App Store
//   Server API (https://developer.apple.com/storekit/app-store-server-api).
//   Modern StoreKit 2 clients (Capacitor IAP plugin included) send the
//   transactionId — not the legacy receipt blob.
//
// Auth: App Store Connect API key (.p8) signed as an ES256 JWT.
//   • Key ID, Issuer ID (UUID, NOT the Team ID), Bundle ID baked into
//     env. Tokens live ≤15 min (we re-sign per request — they're cheap).
//   • Audience MUST be `appstoreconnect-v1`.
//
// JWS verification of the response is delegated to the existing
// `verifyJwsLeafOnly` helper in `./appleSsn.ts` — same Apple WWDR
// signing chain as SSN v2, so any future full-chain upgrade lands
// in both call sites at once.
//
// Sandbox routing: Apple's "try-prod, fall-back-to-sandbox on 21007"
// trick is for the legacy endpoint. For the Server API we get a 404
// with errorCode 4040010 (`TransactionIdNotFoundError`) on
// prod-against-a-sandbox-tx, and we retry against the sandbox base URL.
// TestFlight builds always live in sandbox.
//
// Reference:
//   https://developer.apple.com/documentation/appstoreserverapi/get-transaction-info
//   https://developer.apple.com/documentation/appstoreserverapi/generating-json-web-tokens-for-api-requests
//   https://developer.apple.com/documentation/appstoreserverapi/environment

import fs from 'node:fs/promises';
import path from 'node:path';
import { SignJWT, importPKCS8 } from 'jose';

import {
  verifyJwsLeafOnly,
  AppleSsnVerificationError,
} from './appleSsn.js';
import { logger } from '../../utils/logger.js';

// ───────────────────────────────────────────────────────────────────────────
// Public types
// ───────────────────────────────────────────────────────────────────────────

export type AppleValidationFailureReason =
  | 'config_missing'        // env vars not set — operator error
  | 'transaction_not_found' // 404 prod + 404 sandbox — forged or wrong bundle
  | 'permission_denied'     // 401 — JWT misconfigured / expired key
  | 'jws_invalid'           // signature verify failed
  | 'bundle_mismatch'       // valid JWS, but wrong bundleId — fraud signal
  | 'product_mismatch'      // valid JWS, but wrong productId
  | 'expired'               // expiresDate in the past
  | 'revoked'               // revocationDate present
  | 'transient_error';      // 5xx/429 — retryable

export interface AppleTransactionPayload {
  bundleId?: string;
  productId?: string;
  /** Apple's persistent identifier across reinstalls (per-user). */
  appAccountToken?: string;
  /** Stable across renewals — use to match SSN v2 renewals. */
  originalTransactionId?: string;
  /** Per-charge transaction id. */
  transactionId?: string;
  /** Epoch ms — when access expires. */
  expiresDate?: number;
  /** Epoch ms — when the user was billed. */
  purchaseDate?: number;
  /** Epoch ms — set on refund/revocation. */
  revocationDate?: number;
  /** 'Auto-Renewable Subscription' | 'Non-Renewing Subscription' | … */
  type?: string;
}

export interface AppleValidationSuccess {
  ok: true;
  /** Epoch ms — when access expires. */
  expiryMs: number;
  productId: string;
  originalTransactionId: string;
  /** Environment the transaction belongs to (audit signal). */
  environment: 'production' | 'sandbox';
  /** Decoded payload for the caller (audit + persistence). */
  payload: AppleTransactionPayload;
}

export interface AppleValidationFailure {
  ok: false;
  reason: AppleValidationFailureReason;
  detail: string;
}

export type AppleValidationResult =
  | AppleValidationSuccess
  | AppleValidationFailure;

// ───────────────────────────────────────────────────────────────────────────
// Constants
// ───────────────────────────────────────────────────────────────────────────

const PROD_BASE = 'https://api.storekit.itunes.apple.com';
const SANDBOX_BASE = 'https://api.storekit-sandbox.itunes.apple.com';
const APPLE_TX_NOT_FOUND_ERROR_CODE = 4040010;

// ───────────────────────────────────────────────────────────────────────────
// Test injection
// ───────────────────────────────────────────────────────────────────────────

export interface AppleTestSeam {
  /** Returns `{ status, body }` per (base, txId). */
  fetchTransaction(
    base: string,
    transactionId: string,
    bearer: string,
  ): Promise<{ status: number; body: any }>;
  /** Returns the verified payload directly — bypasses real JWS check. */
  verifyJws?: <T>(jws: string) => Promise<{ payload: T; verifiedChain: boolean }>;
  /**
   * When set, returned verbatim instead of reading APPLE_API_KEY_PATH +
   * signing a real ES256 JWT. Tests use this to avoid touching the
   * filesystem or rolling a real P-256 key.
   */
  bearerOverride?: string;
}

let injectedSeam: AppleTestSeam | null = null;

export function __setAppleSeamForTests(seam: AppleTestSeam | null): void {
  injectedSeam = seam;
}

// ───────────────────────────────────────────────────────────────────────────
// JWT bearer
//
// We rebuild the JWT per validation call. Tokens are valid for ≤15 min and
// the signing cost is negligible (P-256 ES256). Caching introduces an
// invalidation window for key rotation that isn't worth the saving.
// ───────────────────────────────────────────────────────────────────────────

async function buildBearer(): Promise<string | null> {
  const keyPath = process.env.APPLE_API_KEY_PATH;
  const keyId = process.env.APPLE_KEY_ID;
  const issuerId = process.env.APPLE_ISSUER_ID;
  const bundleId = process.env.APPLE_BUNDLE_ID;

  if (!keyPath || !keyId || !issuerId || !bundleId) {
    return null;
  }

  let pkcs8: string;
  try {
    pkcs8 = await fs.readFile(path.resolve(keyPath), 'utf8');
  } catch (err) {
    logger.warn('apple_validator_key_read_failed', {
      keyPath,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  const pk = await importPKCS8(pkcs8, 'ES256');

  return new SignJWT({ bid: bundleId })
    .setProtectedHeader({ alg: 'ES256', kid: keyId, typ: 'JWT' })
    .setIssuer(issuerId)
    .setIssuedAt()
    .setExpirationTime('15m')
    .setAudience('appstoreconnect-v1')
    .sign(pk);
}

// ───────────────────────────────────────────────────────────────────────────
// Default fetch implementation (real Apple call).
//
// The seam lets tests stub this out without touching `global.fetch`,
// avoiding the leakage that bites every other test in the same file.
// ───────────────────────────────────────────────────────────────────────────
async function realFetchTransaction(
  base: string,
  transactionId: string,
  bearer: string,
): Promise<{ status: number; body: any }> {
  const res = await fetch(
    `${base}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
    {
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/json',
      },
    },
  );
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

// ───────────────────────────────────────────────────────────────────────────
// Public API
// ───────────────────────────────────────────────────────────────────────────

/**
 * Validate an iOS transactionId against the App Store Server API.
 *
 * Tries the production base URL first; on `TransactionIdNotFoundError`
 * retries against sandbox so TestFlight purchases still validate.
 */
export async function validateAppleTransaction(
  transactionId: string,
  claimedProductId: string,
): Promise<AppleValidationResult> {
  if (!transactionId || typeof transactionId !== 'string') {
    return {
      ok: false,
      reason: 'transaction_not_found',
      detail: 'transactionId is missing or non-string',
    };
  }

  const expectedBundleId = process.env.APPLE_BUNDLE_ID;
  if (!expectedBundleId) {
    return {
      ok: false,
      reason: 'config_missing',
      detail: 'APPLE_BUNDLE_ID env var is not set',
    };
  }

  const bearer = injectedSeam?.bearerOverride ?? (await buildBearer());
  if (!bearer) {
    return {
      ok: false,
      reason: 'config_missing',
      detail:
        'APPLE_API_KEY_PATH / APPLE_KEY_ID / APPLE_ISSUER_ID / APPLE_BUNDLE_ID env vars must all be set',
    };
  }

  const fetchTx = injectedSeam?.fetchTransaction ?? realFetchTransaction;

  // Production-first; sandbox fallback on 404+errorCode=4040010.
  let environment: 'production' | 'sandbox' = 'production';
  let resp = await fetchTx(PROD_BASE, transactionId, bearer);
  if (
    resp.status === 404 &&
    Number(resp.body?.errorCode) === APPLE_TX_NOT_FOUND_ERROR_CODE
  ) {
    environment = 'sandbox';
    resp = await fetchTx(SANDBOX_BASE, transactionId, bearer);
  }

  if (resp.status === 401 || resp.status === 403) {
    return {
      ok: false,
      reason: 'permission_denied',
      detail: `${resp.status}: ${resp.body?.errorMessage ?? 'auth failed'}`,
    };
  }
  if (resp.status === 404) {
    return {
      ok: false,
      reason: 'transaction_not_found',
      detail: `404 in both prod+sandbox: ${resp.body?.errorMessage ?? 'unknown'}`,
    };
  }
  if (resp.status === 429 || resp.status >= 500) {
    return {
      ok: false,
      reason: 'transient_error',
      detail: `${resp.status}: ${resp.body?.errorMessage ?? 'transient'}`,
    };
  }
  if (resp.status !== 200) {
    return {
      ok: false,
      reason: 'transient_error',
      detail: `unexpected status ${resp.status}`,
    };
  }

  const signedTransactionInfo: string | undefined =
    resp.body?.signedTransactionInfo;
  if (!signedTransactionInfo || typeof signedTransactionInfo !== 'string') {
    return {
      ok: false,
      reason: 'jws_invalid',
      detail: 'response missing signedTransactionInfo',
    };
  }

  let payload: AppleTransactionPayload;
  try {
    const verifyJws = injectedSeam?.verifyJws ?? verifyJwsLeafOnly;
    const verified = await verifyJws<AppleTransactionPayload>(
      signedTransactionInfo,
    );
    payload = verified.payload;
  } catch (err) {
    if (err instanceof AppleSsnVerificationError) {
      return {
        ok: false,
        reason: 'jws_invalid',
        detail: err.message,
      };
    }
    throw err;
  }

  // Defense-in-depth field checks.
  if (payload.bundleId && payload.bundleId !== expectedBundleId) {
    return {
      ok: false,
      reason: 'bundle_mismatch',
      detail: `JWS bundleId=${payload.bundleId} does not match APPLE_BUNDLE_ID`,
    };
  }
  if (!payload.productId || payload.productId !== claimedProductId) {
    return {
      ok: false,
      reason: 'product_mismatch',
      detail: `JWS productId=${payload.productId ?? '<none>'} does not match claimed=${claimedProductId}`,
    };
  }
  if (payload.revocationDate) {
    return {
      ok: false,
      reason: 'revoked',
      detail: `revocationDate=${payload.revocationDate}`,
    };
  }
  if (
    typeof payload.expiresDate !== 'number' ||
    payload.expiresDate <= Date.now()
  ) {
    return {
      ok: false,
      reason: 'expired',
      detail: `expiresDate=${payload.expiresDate ?? '<none>'} is not in the future`,
    };
  }
  if (!payload.originalTransactionId) {
    return {
      ok: false,
      reason: 'jws_invalid',
      detail: 'payload missing originalTransactionId',
    };
  }

  return {
    ok: true,
    expiryMs: payload.expiresDate,
    productId: payload.productId,
    originalTransactionId: payload.originalTransactionId,
    environment,
    payload,
  };
}
