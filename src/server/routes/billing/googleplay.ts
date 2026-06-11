// Praeventio Guard — billing split step 2 (2026-06-11, deuda D3).
//
// Google Play domain routes, moved VERBATIM from
// `src/server/routes/billing.ts` (handlers untouched — imports only):
//   • module-level Google Play Developer API client init,
//   • POST /api/billing/verify   (one-shot purchase verify),
//   • POST /api/billing/webhook  (RTDN via Cloud Pub/Sub).
//
// Registration order inside `registerGooglePlayRoutes` preserves the original
// monolith order (/verify then /webhook). The IAP receipt-validation stub for
// Google Play lives in `./iapReceipts.ts` (it was registered much later in
// the monolith and shares its pattern with the App Store one).

import type { Router } from 'express';
import admin from 'firebase-admin';
import { google } from 'googleapis';

import { verifyAuth } from '../../middleware/verifyAuth.js';
import { idempotencyKey } from '../../middleware/idempotencyKey.js';
import { safeSecretEqual } from '../../middleware/safeSecretEqual.js';
import { googlePlayWebhookLimiter } from '../../middleware/limiters.js';
import { logger } from '../../../utils/logger.js';
import { withIdempotency } from '../../../services/billing/idempotency.js';
import { auditServerEvent } from '../../middleware/auditLog.js';
import { normalizeSubscriptionPlanId } from '../../../services/pricing/subscriptionPlan.js';
import { sentryCapture } from './shared.js';

// ────────────────────────────────────────────────────────────────────────────
// Google Play Developer API client.
//
// Used by /api/billing/verify (one-shot purchase verify) and the RTDN
// webhook (re-fetch fresh subscription state on each notification). Init
// at module load: lazy reads of GOOGLE_PLAY_SERVICE_ACCOUNT_JSON would race
// the first request. `playAuth=null` is the documented unconfigured state
// → /verify returns 500 with a helpful "not configured" message.
// ────────────────────────────────────────────────────────────────────────────
let playAuth: any = null;
const playDeveloperApi = google.androidpublisher('v3');

if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
    playAuth = google.auth.fromJSON(credentials);
    playAuth.scopes = ['https://www.googleapis.com/auth/androidpublisher'];
    logger.info('google_play_api_initialized');
  } catch (error) {
    logger.error('google_play_api_init_failed', error);
    sentryCapture(error, { endpoint: 'billing.googlePlayApiInit', tags: { phase: 'module-init' } });
  }
}

export function registerGooglePlayRoutes(billingApiRouter: Router): void {
  // POST /api/billing/verify — Google Play one-shot verify (subscription or
  // in-app product). On success we mirror the order into `transactions` and
  // update the user's `subscription` block.
  //
  // Sprint E backend debt (2026-05-16): `idempotencyKey()` middleware added
  // to protect against double-call on flaky mobile networks. Same pattern as
  // `/checkout`: if the client retries with the same
  // `Idempotency-Key` header, the first cached 2xx response is replayed and
  // the handler runs ZERO times — preventing duplicate `transactions/*`
  // rows and duplicate `users/{uid}.subscription.*` writes. The middleware
  // is OPT-IN (no header → falls through to the handler normally), so
  // existing clients that don't send the header keep working exactly as
  // before.
  billingApiRouter.post('/verify', verifyAuth, idempotencyKey(), async (req, res) => {
    const { purchaseToken, productId, type } = req.body;
    const uid = req.user!.uid;
    const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;

    if (!playAuth || !packageName) {
      return res.status(500).json({ error: 'Google Play API not configured on server' });
    }

    try {
      let verificationResult;
      if (type === 'subscription') {
        verificationResult = await playDeveloperApi.purchases.subscriptions.get({
          auth: playAuth,
          packageName,
          subscriptionId: productId,
          token: purchaseToken,
        });
      } else {
        verificationResult = await playDeveloperApi.purchases.products.get({
          auth: playAuth,
          packageName,
          productId,
          token: purchaseToken,
        });
      }

      const data = verificationResult.data;
      const db = admin.firestore();

      // Log transaction
      await db.collection('transactions').add({
        userId: uid,
        orderId: data.orderId || 'unknown',
        packageName,
        productId,
        purchaseToken,
        type: type || 'subscription',
        status: 'verified',
        rawResponse: data,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Store entitlements using the legacy subscription ids expected by
      // feature gates, even when providers send canonical pricing tier ids.
      const resolvedPlan = normalizeSubscriptionPlanId(productId) ?? 'comite';

      // Update user subscription status
      if (type === 'subscription') {
        // Narrow: `type === 'subscription'` guarantees subscription branch above
        // returned `Schema$SubscriptionPurchase` (which has `expiryTimeMillis` &
        // `paymentState`). TS can't narrow `data` through the disjoint `if`,
        // so we project to a typed shape here.
        const subData = data as { expiryTimeMillis?: string | null; paymentState?: number | null; orderId?: string | null };
        const expiryDate = subData.expiryTimeMillis ? new Date(parseInt(subData.expiryTimeMillis)).toISOString() : null;
        // paymentState 1 = received, 2 = free trial
        const isActive = subData.paymentState === 1 || subData.paymentState === 2;

        await db.collection('users').doc(uid).update({
          'subscription.planId': resolvedPlan,
          'subscription.status': isActive ? 'active' : 'expired',
          'subscription.expiryDate': expiryDate,
          'subscription.purchaseToken': purchaseToken,
          'subscription.orderId': subData.orderId,
          'subscription.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
        });
      } else {
        // One-time purchase logic
        await db.collection('users').doc(uid).update({
          [`purchased_products.${productId}`]: true,
          'subscription.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      await auditServerEvent(req, 'billing.verify', 'billing', {
        uid,
        productId,
        type: type ?? 'subscription',
        planId: resolvedPlan,
        orderId: data.orderId ?? null,
      });
      return res.json({ success: true, data });
    } catch (error: any) {
      logger.error('purchase_verification_failed', error, { uid });
      sentryCapture(error, { endpoint: '/api/billing/verify', tags: { method: 'POST', uid } });
      return res.status(500).json({
        error: 'Failed to verify purchase',
        // Avoid leaking Firebase/googleapis internals in production responses.
        details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
      });
    }
  });

  // POST /api/billing/webhook — Real-Time Developer Notifications (RTDN) push
  // from Google Play via Cloud Pub/Sub. Shared-secret gate via ?token=
  // query-string + lock-then-complete idempotency on `processed_pubsub`.
  billingApiRouter.post('/webhook', googlePlayWebhookLimiter, async (req, res) => {
    // Verify shared secret — configure WEBHOOK_SECRET in Pub/Sub push subscription URL as ?token=<secret>
    // Fail closed: missing config means we reject everything rather than accept everyone.
    const expectedToken = process.env.WEBHOOK_SECRET;
    if (!expectedToken) {
      logger.error('rtdn_webhook_misconfigured', undefined, {
        reason: 'WEBHOOK_SECRET not set',
      });
      return res.status(500).send('Server configuration error');
    }

    // Constant-time comparison via safeSecretEqual: pads the provided value to
    // the expected length so neither length nor bytes leak through wall-clock
    // timing. The previous `length !== length` short-circuit was technically
    // a length-disclosure side channel.
    const providedToken = req.query.token;
    if (typeof providedToken !== 'string' || !safeSecretEqual(providedToken, expectedToken)) {
      return res.status(401).send('Unauthorized');
    }

    // RTDN Verification (Google Cloud Pub/Sub push)
    const { message } = req.body;
    if (!message || !message.data) {
      return res.status(400).send('No message data');
    }

    // Idempotency: Pub/Sub may redeliver the same message. We dedupe via
    // `processed_pubsub/{messageId}` using the shared `withIdempotency`
    // helper (lock-then-complete; 5-minute staleness window). The helper
    // encapsulates the four-state machine — see
    // src/services/billing/idempotency.ts for the full contract.
    //
    // No messageId? We bail out non-idempotently and ACK 200; without a
    // dedupe key we can't safely persist a lock and we don't want to wedge
    // the subscription on a malformed delivery.
    const messageId: string | undefined = message.messageId || message.message_id;
    const db = admin.firestore();

    if (!messageId) {
      logger.warn('rtdn_missing_message_id');
      return res.status(200).send('OK');
    }

    try {
      const outcome = await withIdempotency(
        db,
        { collection: 'processed_pubsub', key: messageId },
        async () => {
          let decodedData: { subscriptionNotification?: { notificationType?: number; subscriptionId?: string; purchaseToken?: string }; packageName?: string };
          try {
            decodedData = JSON.parse(Buffer.from(message.data, 'base64').toString());
          } catch (parseErr) {
            logger.warn('rtdn_malformed_message_data', {
              messageId,
              reason: parseErr instanceof Error ? parseErr.name : 'parse_error',
            });
            return { ok: false as const, malformed: true as const };
          }
          const subscriptionNotification = decodedData.subscriptionNotification;
          const packageName = decodedData.packageName;

          // Log only non-sensitive metadata. NEVER log purchaseToken — it's a
          // bearer credential for Google Play.
          logger.info('rtdn_received', {
            notificationType: subscriptionNotification?.notificationType,
            subscriptionId: subscriptionNotification?.subscriptionId,
            packageName,
          });

          if (subscriptionNotification) {
            const { purchaseToken, subscriptionId } = subscriptionNotification;

            // Update the user whose token matches
            const userQuery = await db.collection('users').where('subscription.purchaseToken', '==', purchaseToken).get();

            if (!userQuery.empty) {
              const userDoc = userQuery.docs[0];
              logger.info('rtdn_updating_user_subscription', { userId: userDoc.id });

              // Fetch fresh state from Google
              const verificationResult = await playDeveloperApi.purchases.subscriptions.get({
                auth: playAuth,
                packageName,
                subscriptionId,
                token: purchaseToken,
              });

              const data = verificationResult.data;
              const isActive = data.paymentState === 1 || data.paymentState === 2;
              const expiryDate = data.expiryTimeMillis ? new Date(parseInt(data.expiryTimeMillis)).toISOString() : null;

              await userDoc.ref.update({
                'subscription.status': isActive ? 'active' : 'expired',
                'subscription.expiryDate': expiryDate,
                'subscription.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
              });
            }
          }

          return { ok: true };
        },
      );

      // Surface the outcome for observability — preserves the
      // `rtdn_in_progress_skip` / `rtdn_stale_lock_stealing` signals the
      // inline implementation emitted.
      if (outcome.kind === 'in-flight') {
        logger.info('rtdn_in_progress_skip', { messageId });
      } else if (outcome.kind === 'stale-retry') {
        logger.warn('rtdn_stale_lock_stealing', { messageId });
      }

      // Sprint 28 H18 — audit trail of every webhook delivery (success
      // and replay). Best-effort: we never fail the request because of a
      // failed audit write.
      if (outcome.kind === 'duplicate') {
        await auditServerEvent(req, 'billing.webhook.replay', 'billing', {
          replay: true,
          source: 'google-play',
          txn: messageId,
          previousResult: outcome.previousResult,
        }).catch(() => {});
      } else if (outcome.kind === 'fresh-success' || outcome.kind === 'stale-retry') {
        await auditServerEvent(req, 'billing.webhook.success', 'billing', {
          source: 'google-play',
          txn: messageId,
          outcome: outcome.kind,
        }).catch(() => {});
      }

      // All four outcomes ACK 200 to suppress Pub/Sub redelivery — see
      // contract notes in idempotency.ts.
      return res.status(200).send('OK');
    } catch (error) {
      // Deliberate: withIdempotency leaves the doc as 'in_progress' on a
      // work() exception. The staleness window will grant a future
      // redelivery a fresh attempt.
      logger.error('rtdn_webhook_failed', error);
      sentryCapture(error, { endpoint: '/api/billing/webhook', tags: { method: 'POST', source: 'rtdn' } });
      return res.status(500).send('Webhook processing failed');
    }
  });
}
