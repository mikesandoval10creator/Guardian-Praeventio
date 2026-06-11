// Praeventio Guard — billing split step 2 (2026-06-11, deuda D3).
//
// IAP receipt-validation routes (Sprint 21 Ola 6 Bucket T pair), moved
// VERBATIM from `src/server/routes/billing.ts` (handlers untouched —
// imports only):
//   • POST /api/billing/google-play/validate-receipt
//   • POST /api/billing/app-store/validate-receipt
//
// Kept together (instead of folding into googleplay.ts / appstore.ts)
// because they were shipped as one bucket with a shared header comment and
// a mirrored `recordAttempt` pattern, and because keeping them in their own
// module preserves the monolith's exact route-registration order.

import type { Router } from 'express';
import admin from 'firebase-admin';

import { verifyAuth } from '../../middleware/verifyAuth.js';
import { logger } from '../../../utils/logger.js';
// Sprint 39 P0.3 — synchronous server-to-server IAP receipt validators.
// See file headers in each for the auth/env contract.
import { validateGooglePlaySubscription } from '../../../services/billing/googlePlayValidator.js';
import { validateAppleTransaction } from '../../../services/billing/appleTransactionValidator.js';
import { sentryCapture } from './shared.js';

// ────────────────────────────────────────────────────────────────────────────
// Sprint 21 Ola 6 Bucket T — IAP receipt validation stubs.
//
// The Capacitor IAP plugin (used by Pricing.tsx on android/ios) returns a
// purchase receipt to the client. The client POSTs that receipt here so
// the server has a fraud-signal hook AND an audit trail of the attempt.
//
// IMPORTANT — these endpoints DO NOT grant the subscription benefit on
// their own. The authoritative grant flow is:
//   • Google Play → RTDN webhook at POST /api/billing/webhook (see
//     ./googleplay.ts) which re-fetches the canonical subscription state
//     from the Google Play Developer API (`purchases.subscriptions.get`).
//   • App Store → App Store Server Notifications (SSN) v2 webhook
//     (POST /api/billing/webhook/apple — see ./appstore.ts).
//
// Granting on the strength of the client-supplied receipt alone would
// open us to replay / forged-receipt fraud (App Store sandbox receipts
// are well-documented as forgeable). The client receipt is informational.
//
// Both endpoints return 202 Accepted to signal "we'll grant when the
// store confirms server-to-server" without lying about completion.
// ────────────────────────────────────────────────────────────────────────────

export function registerIapReceiptRoutes(billingApiRouter: Router): void {
  billingApiRouter.post(
    '/google-play/validate-receipt',
    verifyAuth,
    async (req, res) => {
      const { productId, tierId, receiptId } = (req.body ?? {}) as {
        productId?: string;
        tierId?: string;
        receiptId?: string;
      };
      const uid = req.user?.uid;

      if (!productId || !receiptId) {
        return res.status(400).json({ error: 'missing_fields' });
      }

      // Always persist the attempt (best-effort) so ops can correlate with
      // RTDN later. We never store the full token — it's token-equivalent
      // material and would broaden the blast radius of a Firestore breach.
      const recordAttempt = async (outcome: string, reason?: string) => {
        try {
          const db = admin.firestore();
          await db.collection('iap_receipt_attempts').add({
            provider: 'google-play',
            userId: uid ?? null,
            productId,
            tierId: tierId ?? null,
            receiptIdHash: receiptId.slice(0, 16) + '…',
            outcome,
            reason: reason ?? null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            ip: req.ip ?? null,
            userAgent: req.header('user-agent') ?? null,
          });
        } catch (err) {
          logger.warn('iap_validate_receipt_attempt_log_failed', {
            provider: 'google-play',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      };

      try {
        const result = await validateGooglePlaySubscription(receiptId, productId);

        if (result.ok === false) {
          const failure = result;
          await recordAttempt('rejected', failure.reason);

          // Map internal reasons to HTTP status. We deliberately do NOT
          // echo `failure.detail` to the client — it carries operator info
          // (env var names, internal state) that could help an attacker
          // probe the validation surface.
          switch (failure.reason) {
            case 'token_not_found':
            case 'token_invalid':
            case 'token_replaced':
            case 'product_mismatch':
            case 'subscription_inactive':
            case 'expired':
            case 'test_purchase':
              logger.warn('iap_validate_receipt_rejected', {
                provider: 'google-play',
                productId,
                reason: failure.reason,
                detail: failure.detail,
              });
              return res.status(400).json({
                error: 'receipt_invalid',
                reason: failure.reason,
              });

            case 'config_missing':
            case 'permission_denied':
              logger.error('iap_validate_receipt_config_error', null, {
                provider: 'google-play',
                reason: failure.reason,
                detail: failure.detail,
              });
              sentryCapture(new Error(`google_play_validator_${failure.reason}`), {
                endpoint: '/api/billing/google-play/validate-receipt',
                tags: { method: 'POST', provider: 'google-play' },
              });
              return res.status(502).json({
                error: 'validator_unavailable',
              });

            case 'transient_error':
              logger.warn('iap_validate_receipt_transient', {
                provider: 'google-play',
                detail: failure.detail,
              });
              return res.status(503).json({
                error: 'transient_error',
                retryable: true,
              });

            default: {
              // Exhaustiveness guard — a new failure reason must land here.
              const _exhaustive: never = failure.reason;
              void _exhaustive;
              return res.status(500).json({ error: 'iap_receipt_validation_failed' });
            }
          }
        }

        // result.ok === true here.
        const success = result;
        await recordAttempt('granted');
        logger.info('iap_validate_receipt_granted', {
          provider: 'google-play',
          productId,
          tierId: tierId ?? null,
          expiryMs: success.expiryMs,
          regionCode: success.regionCode,
          subscriptionState: success.subscriptionState,
        });

        return res.status(200).json({
          ok: true,
          productId: success.productId,
          expiryMs: success.expiryMs,
          regionCode: success.regionCode,
          // The actual subscription grant in Firestore is performed
          // server-side by the RTDN handler when it processes the
          // corresponding pub/sub notification. The synchronous validation
          // here lets the client unblock immediately and is the
          // authoritative "this purchase is real" check.
        });
      } catch (err) {
        await recordAttempt('error', err instanceof Error ? err.message : 'unknown');
        logger.error('iap_validate_receipt_failed', err, {
          provider: 'google-play',
        });
        sentryCapture(err, {
          endpoint: '/api/billing/google-play/validate-receipt',
          tags: { method: 'POST', provider: 'google-play' },
        });
        return res.status(500).json({ error: 'iap_receipt_validation_failed' });
      }
    },
  );

  billingApiRouter.post(
    '/app-store/validate-receipt',
    verifyAuth,
    async (req, res) => {
      const { productId, tierId, receiptId } = (req.body ?? {}) as {
        productId?: string;
        tierId?: string;
        receiptId?: string;
      };
      const uid = req.user?.uid;

      if (!productId || !receiptId) {
        return res.status(400).json({ error: 'missing_fields' });
      }

      const recordAttempt = async (outcome: string, reason?: string) => {
        try {
          const db = admin.firestore();
          await db.collection('iap_receipt_attempts').add({
            provider: 'app-store',
            userId: uid ?? null,
            productId,
            tierId: tierId ?? null,
            receiptIdHash: receiptId.slice(0, 16) + '…',
            outcome,
            reason: reason ?? null,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            ip: req.ip ?? null,
            userAgent: req.header('user-agent') ?? null,
          });
        } catch (err) {
          logger.warn('iap_validate_receipt_attempt_log_failed', {
            provider: 'app-store',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      };

      try {
        // `receiptId` here is the iOS transactionId — StoreKit 2 and the
        // Capacitor IAP plugin both surface the transactionId, not the
        // legacy base64 receipt blob.
        const result = await validateAppleTransaction(receiptId, productId);

        if (result.ok === false) {
          const failure = result;
          await recordAttempt('rejected', failure.reason);

          switch (failure.reason) {
            case 'transaction_not_found':
            case 'jws_invalid':
            case 'bundle_mismatch':
            case 'product_mismatch':
            case 'expired':
            case 'revoked':
              logger.warn('iap_validate_receipt_rejected', {
                provider: 'app-store',
                productId,
                reason: failure.reason,
                detail: failure.detail,
              });
              return res.status(400).json({
                error: 'receipt_invalid',
                reason: failure.reason,
              });

            case 'config_missing':
            case 'permission_denied':
              logger.error('iap_validate_receipt_config_error', null, {
                provider: 'app-store',
                reason: failure.reason,
                detail: failure.detail,
              });
              sentryCapture(new Error(`apple_validator_${failure.reason}`), {
                endpoint: '/api/billing/app-store/validate-receipt',
                tags: { method: 'POST', provider: 'app-store' },
              });
              return res.status(502).json({
                error: 'validator_unavailable',
              });

            case 'transient_error':
              logger.warn('iap_validate_receipt_transient', {
                provider: 'app-store',
                detail: failure.detail,
              });
              return res.status(503).json({
                error: 'transient_error',
                retryable: true,
              });

            default: {
              const _exhaustive: never = failure.reason;
              void _exhaustive;
              return res.status(500).json({ error: 'iap_receipt_validation_failed' });
            }
          }
        }

        const success = result;
        await recordAttempt('granted');
        logger.info('iap_validate_receipt_granted', {
          provider: 'app-store',
          productId: success.productId,
          tierId: tierId ?? null,
          expiryMs: success.expiryMs,
          environment: success.environment,
          originalTransactionId: success.originalTransactionId,
        });

        return res.status(200).json({
          ok: true,
          productId: success.productId,
          expiryMs: success.expiryMs,
          environment: success.environment,
          // Persistent grant + entitlement bookkeeping is handled by the
          // SSN v2 webhook in services/billing/appleSsn.ts; this endpoint
          // is the synchronous "is this transaction real?" gate.
        });
      } catch (err) {
        await recordAttempt('error', err instanceof Error ? err.message : 'unknown');
        logger.error('iap_validate_receipt_failed', err, {
          provider: 'app-store',
        });
        sentryCapture(err, {
          endpoint: '/api/billing/app-store/validate-receipt',
          tags: { method: 'POST', provider: 'app-store' },
        });
        return res.status(500).json({ error: 'iap_receipt_validation_failed' });
      }
    },
  );
}
