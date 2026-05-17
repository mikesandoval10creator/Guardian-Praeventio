// Praeventio Guard â€” Round 17 R2 Phase 2 split.
//
// Billing endpoints extracted from server.ts. Phase 1 (Round 16 R5) shipped
// admin/health/audit; this phase moves the 6 /api/billing/* routes plus the
// Webpay return handler at /billing/webpay/return.
//
// Mount strategy (in server.ts):
//   â€¢ app.use('/api/billing', billingApiRouter)  â† 6 /api/billing/* routes
//   â€¢ app.use('/billing',     billingWebpayRouter) â† Webpay return only
//
// Why TWO routers? `/billing/webpay/return` is the URL Transbank redirects
// the cardholder's browser to after card entry. That URL is registered with
// Transbank's commerce config and CANNOT change to `/api/billing/...` without
// a Webpay reissue. Keeping it on its own root-mounted router preserves the
// byte-identical path while still letting the API surface live under
// `/api/billing/`.
//
// Final paths (preserved verbatim â€” DO NOT change):
//   â€¢ POST /api/billing/verify                  (Google Play purchase verify)
//   â€¢ POST /api/billing/webhook                 (RTDN, shared-secret + idempotency)
//   â€¢ POST /api/billing/checkout                (Webpay/Stripe/manual invoice)
//   â€¢ POST /api/billing/checkout/mercadopago    (LATAM, Round 15 R2)
//   â€¢ POST /api/billing/invoice/:id/mark-paid   (admin manual fallback)
//   â€¢ GET  /api/billing/invoice/:id             (status poll, Round 13)
//   â€¢ GET  /billing/webpay/return               (Webpay browser return)
//
// Behavior contract (covered by I3 supertest harness â€” see
// src/__tests__/server/billing.test.ts; that harness builds a parallel
// minimal Express app, so this extraction does not affect those tests).
//
// Phase 3 (curriculum/projects) and Phase 4 (oauth/gemini) deferred to
// Round 18.

import express, { Router } from 'express';
import admin from 'firebase-admin';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { google } from 'googleapis';

import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { safeSecretEqual } from '../middleware/safeSecretEqual.js';
// Sprint 28 Bucket B3 â€” transversal Zod validation factory. See
// src/server/middleware/validate.ts for the contract.
import { validate } from '../middleware/validate.js';
import { invoiceStatusLimiter, googlePlayWebhookLimiter } from '../middleware/limiters.js';
import { logger } from '../../utils/logger.js';
// Sprint 22 Bucket AA â€” request-scoped tracing on the billing dispatch path.
import { tracedAsync } from '../../services/observability/tracing.js';
import { getErrorTracker } from '../../services/observability/index.js';

// Sentry capture helper â€” additive to logger.error. Wrapped so observability
// failures never crash the request path.
function sentryCapture(
  err: unknown,
  context: { endpoint?: string; trigger?: string; tags?: Record<string, string | number | boolean | null | undefined> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context as any,
    );
  } catch (e) {
    console.warn('[observability] capture failed', e);
  }
}
import { isAdminRole } from '../../types/roles.js';

import { buildInvoice } from '../../services/billing/invoice.js';
import type {
  CheckoutRequest,
  CheckoutResponse,
  CurrencyCode,
  PaymentMethod,
} from '../../services/billing/types.js';
import {
  webpayAdapter,
  acquireWebpayIdempotencyLock,
  finalizeWebpayIdempotencyLock,
  type WebpayReturnOutcome,
} from '../../services/billing/webpayAdapter.js';
import { KhipuAdapter } from '../../services/billing/khipuAdapter.js';
import { stripeAdapter } from '../../services/billing/stripeAdapter.js';
import { withIdempotency } from '../../services/billing/idempotency.js';
// Sprint 39 P0.3 â€” synchronous server-to-server IAP receipt validators.
// See file headers in each for the auth/env contract.
import { validateGooglePlaySubscription } from '../../services/billing/googlePlayValidator.js';
import { validateAppleTransaction } from '../../services/billing/appleTransactionValidator.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { recordWebpayReturnLatency } from '../../services/billing/webpayMetrics.js';
import {
  mercadoPagoAdapter,
  MercadoPagoAdapterError,
  type MercadoPagoCurrencyId,
} from '../../services/billing/mercadoPagoAdapter.js';
import {
  verifyMercadoPagoIpnSignatureFromBody,
  verifyMpIpnAnyFormat,
  verifyMercadoPagoIpnOidc,
  processMercadoPagoIpn,
} from '../../services/billing/mercadoPagoIpn.js';
// Sprint 49 D.8.b — DTE auto-issue orchestrator (pure decision). The wire
// here only DECIDES + logs; queue persistence / PSE dispatch lands in
// Sprint 50. NO push directo a SII — provider Bsale/PSE intermedio
// (directiva 3 plan maestro). See dteAutoIssueOrchestrator.ts header.
import {
  decideDteIssue,
  type DteIssueRequest,
} from '../../services/dte/dteAutoIssueOrchestrator.js';
import {
  verifyAndDecodeAppleSsn,
  applyAppleEntitlement,
  buildAppleSsnAuditRow,
  AppleSsnVerificationError,
} from '../../services/billing/appleSsn.js';
import {
  MP_CURRENCY_BY_COUNTRY,
  type LatamCurrency,
} from '../../services/billing/currency.js';
import { normalizeSubscriptionPlanId } from '../../services/pricing/subscriptionPlan.js';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Google Play Developer API client.
//
// Used by /api/billing/verify (one-shot purchase verify) and the RTDN
// webhook (re-fetch fresh subscription state on each notification). Init
// at module load: lazy reads of GOOGLE_PLAY_SERVICE_ACCOUNT_JSON would race
// the first request. `playAuth=null` is the documented unconfigured state
// â†’ /verify returns 500 with a helpful "not configured" message.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let playAuth: any = null;
const playDeveloperApi = google.androidpublisher('v3');

if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
    playAuth = google.auth.fromJSON(credentials);
    // @ts-ignore
    playAuth.scopes = ['https://www.googleapis.com/auth/androidpublisher'];
    logger.info('google_play_api_initialized');
  } catch (error) {
    logger.error('google_play_api_init_failed', error);
    sentryCapture(error, { endpoint: 'billing.googlePlayApiInit', tags: { phase: 'module-init' } });
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Chilean B2B Billing scaffolding (IMP5)
//
// Persistence:
//   Invoices are written to the `invoices/{id}` Firestore collection via the
//   Admin SDK only. firestore.rules treats this collection as default-deny
//   (server-only writes) â€” clients must NEVER read/write it directly. Do
//   not add a rule for `invoices/{id}` without an explicit threat-model
//   review; a wrong rule there leaks tax data and PII.
//
// Real provider integration is NOT in this commit â€” `webpayAdapter` and
// `stripeAdapter` throw on every method except `isConfigured()`. See
// BILLING.md for the runbook to wire transbank-sdk + stripe.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Tier pricing fallback: real source of truth is
// `src/services/pricing/tiers.ts` (IMP1's territory). Until that lands, we
// read from a small inline table mirroring `tiers.test.ts` so this endpoint
// type-checks and serves a 5xx with a helpful message for unknown tiers
// rather than crashing on import.
type BillingTier = {
  clpRegular: number;
  clpAnual: number;
  usdRegular: number;
  usdAnual: number;
};
const BILLING_TIER_FALLBACK: Record<string, BillingTier> = {
  // Net amounts (pre-IVA) for CLP; display amounts (incl IVA) live in tiers.ts.
  // 10075 * 1.19 = 11989.25 â†’ ceil 11990 (matches tiers.test.ts)
  'comite-paritario': { clpRegular: 10075, clpAnual: 81504, usdRegular: 13, usdAnual: 130 },
  'departamento-prevencion': { clpRegular: 26042, clpAnual: 250416, usdRegular: 33, usdAnual: 330 },
  'plata': { clpRegular: 42849, clpAnual: 411513, usdRegular: 54, usdAnual: 540 },
  'oro': { clpRegular: 76462, clpAnual: 734040, usdRegular: 96, usdAnual: 960 },
  'titanio': { clpRegular: 210076, clpAnual: 2016720, usdRegular: 263, usdAnual: 2630 },
  'diamante': { clpRegular: 420160, clpAnual: 4033536, usdRegular: 526, usdAnual: 5260 },
  'empresarial': { clpRegular: 1260496, clpAnual: 12099960, usdRegular: 1578, usdAnual: 15780 },
  'corporativo': { clpRegular: 2521000, clpAnual: 24201600, usdRegular: 3158, usdAnual: 31580 },
  'ilimitado': { clpRegular: 5042008, clpAnual: 48403252, usdRegular: 6315, usdAnual: 63150 },
};

function resolveBillingTier(tierId: string): BillingTier | null {
  return BILLING_TIER_FALLBACK[tierId] ?? null;
}

// Per-unit overage (CLP, net of IVA). Mirrors tiers.test.ts which uses
// $990/worker incl IVA â†’ 990/1.19 â‰ˆ 832.
const OVERAGE_CLP_PER_WORKER_NET = 832;
const OVERAGE_CLP_PER_PROJECT_NET = 5034; // 5990 / 1.19

const VALID_PAYMENT_METHODS: ReadonlyArray<PaymentMethod> = [
  'webpay', 'stripe', 'manual-transfer',
];
const VALID_CURRENCIES: ReadonlyArray<CurrencyCode> = ['CLP', 'USD'];

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Round 15 â€” MercadoPago checkout (LATAM: PE/AR/CO/MX/BR).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Per-country expected currency. The (country, currency) tuple must match
 *  before we'll create a preference â€” prevents accidental cross-currency
 *  invoicing. */
const MP_VALID_TUPLES: ReadonlySet<string> = new Set(
  Object.entries(MP_CURRENCY_BY_COUNTRY).map(([c, cur]) => `${c}:${cur}`),
);

/** Convert a CLP amount to a per-country MP unit_price using the same
 *  fallback ratios as `BILLING_TIER_FALLBACK`. We use the tier's USD
 *  price as a stable anchor, then apply a rough country multiplier so
 *  the displayed price is a sensible local-currency number. This is
 *  intentionally simple â€” Round 16 will swap it for per-country pricing
 *  rows on the tier definition. */
const MP_UNIT_PRICE_USD_MULTIPLIER: Record<string, number> = {
  PEN: 3.8, // 1 USD â‰ˆ 3.8 PEN
  ARS: 870, // 1 USD â‰ˆ 870 ARS (volatile â€” review monthly)
  COP: 4100, // 1 USD â‰ˆ 4100 COP
  MXN: 17.5, // 1 USD â‰ˆ 17.5 MXN
  BRL: 5.0, // 1 USD â‰ˆ 5 BRL
};

// Suppress "unused" warning for the LatamCurrency type re-export above â€”
// kept in scope so future endpoints in this file can narrow on it
// without re-importing from the currency module.
void (null as unknown as LatamCurrency | null);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Routers â€” see header for the two-router rationale.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const billingApiRouter = Router();
export const billingWebpayRouter = Router();

// POST /api/billing/verify â€” Google Play one-shot verify (subscription or
// in-app product). On success we mirror the order into `transactions` and
// update the user's `subscription` block.
//
// Sprint E backend debt (2026-05-16): `idempotencyKey()` middleware added
// to protect against double-call on flaky mobile networks. Same pattern as
// `/checkout` (line ~462 below): if the client retries with the same
// `Idempotency-Key` header, the first cached 2xx response is replayed and
// the handler runs ZERO times â€” preventing duplicate `transactions/*`
// rows and duplicate `users/{uid}.subscription.*` writes. The middleware
// is OPT-IN (no header â†’ falls through to the handler normally), so
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
      const expiryDate = data.expiryTimeMillis ? new Date(parseInt(data.expiryTimeMillis)).toISOString() : null;
      // paymentState 1 = received, 2 = free trial
      const isActive = data.paymentState === 1 || data.paymentState === 2;

      await db.collection('users').doc(uid).update({
        'subscription.planId': resolvedPlan,
        'subscription.status': isActive ? 'active' : 'expired',
        'subscription.expiryDate': expiryDate,
        'subscription.purchaseToken': purchaseToken,
        'subscription.orderId': data.orderId,
        'subscription.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      // One-time purchase logic
      await db.collection('users').doc(uid).update({
        [`purchased_products.${productId}`]: true,
        'subscription.updatedAt': admin.firestore.FieldValue.serverTimestamp(),
      });
    }

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

// POST /api/billing/webhook â€” Real-Time Developer Notifications (RTDN) push
// from Google Play via Cloud Pub/Sub. Shared-secret gate via ?token=
// query-string + lock-then-complete idempotency on `processed_pubsub`.
billingApiRouter.post('/webhook', googlePlayWebhookLimiter, async (req, res) => {
  // Verify shared secret â€” configure WEBHOOK_SECRET in Pub/Sub push subscription URL as ?token=<secret>
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
  // encapsulates the four-state machine â€” see
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
        const decodedData = JSON.parse(Buffer.from(message.data, 'base64').toString());
        const { subscriptionNotification } = decodedData;
        const packageName = decodedData.packageName;

        // Log only non-sensitive metadata. NEVER log purchaseToken â€” it's a
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

    // Surface the outcome for observability â€” preserves the
    // `rtdn_in_progress_skip` / `rtdn_stale_lock_stealing` signals the
    // inline implementation emitted.
    if (outcome.kind === 'in-flight') {
      logger.info('rtdn_in_progress_skip', { messageId });
    } else if (outcome.kind === 'stale-retry') {
      logger.warn('rtdn_stale_lock_stealing', { messageId });
    }

    // Sprint 28 H18 â€” audit trail of every webhook delivery (success
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

    // All four outcomes ACK 200 to suppress Pub/Sub redelivery â€” see
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

// POST /api/billing/checkout â€” create invoice + (eventually) redirect URL
// for Webpay/Stripe. CLP must use webpay or manual-transfer; USD must use
// stripe. Until adapters are wired, falls back to 'pending-config'.
billingApiRouter.post('/checkout', verifyAuth, idempotencyKey(), async (req, res) => {
  const callerUid = req.user!.uid;
  const callerEmail: string | null = req.user!.email ?? null;

  try {
    const body = req.body ?? {};

    // Input validation â€” fail closed. Never trust currency/method from client.
    if (typeof body.tierId !== 'string' || body.tierId.length === 0 || body.tierId.length > 64) {
      return res.status(400).json({ error: 'Invalid tierId' });
    }
    if (body.cycle !== 'monthly' && body.cycle !== 'annual') {
      return res.status(400).json({ error: 'Invalid cycle' });
    }
    if (!VALID_CURRENCIES.includes(body.currency)) {
      return res.status(400).json({ error: 'Invalid currency' });
    }
    if (!VALID_PAYMENT_METHODS.includes(body.paymentMethod)) {
      return res.status(400).json({ error: 'Invalid paymentMethod' });
    }
    if (!Number.isFinite(body.totalWorkers) || body.totalWorkers < 0 || body.totalWorkers > 1_000_000) {
      return res.status(400).json({ error: 'Invalid totalWorkers' });
    }
    if (!Number.isFinite(body.totalProjects) || body.totalProjects < 0 || body.totalProjects > 100_000) {
      return res.status(400).json({ error: 'Invalid totalProjects' });
    }
    const cliente = body.cliente;
    if (
      !cliente ||
      typeof cliente.nombre !== 'string' || cliente.nombre.length === 0 || cliente.nombre.length > 256 ||
      typeof cliente.email !== 'string' || !cliente.email.includes('@') || cliente.email.length > 256 ||
      (cliente.rut !== undefined && (typeof cliente.rut !== 'string' || cliente.rut.length > 32))
    ) {
      return res.status(400).json({ error: 'Invalid cliente' });
    }

    // CLP must use webpay or manual-transfer. USD must use stripe.
    if (body.currency === 'CLP' && body.paymentMethod === 'stripe') {
      return res.status(400).json({ error: 'CLP requires webpay or manual-transfer' });
    }
    if (body.currency === 'USD' && body.paymentMethod === 'webpay') {
      return res.status(400).json({ error: 'USD requires stripe or manual-transfer' });
    }

    const tier = resolveBillingTier(body.tierId);
    if (!tier) {
      return res.status(400).json({ error: 'Unknown tierId' });
    }

    const checkoutRequest: CheckoutRequest = {
      tierId: body.tierId,
      cycle: body.cycle,
      currency: body.currency,
      totalWorkers: body.totalWorkers,
      totalProjects: body.totalProjects,
      cliente: {
        nombre: cliente.nombre,
        email: cliente.email,
        rut: cliente.rut,
      },
      paymentMethod: body.paymentMethod,
    };

    // Compute overage off the tier limits. For now only ComitÃ© Paritario
    // and Departamento have variable overage in the fallback; the real
    // calculation belongs in pricing/tiers.ts.
    const workerOverage = Math.max(0, body.totalWorkers - 25);
    const projectOverage = Math.max(0, body.totalProjects - 3);

    const invoice = buildInvoice(
      checkoutRequest,
      tier,
      {
        workers: workerOverage,
        projects: projectOverage,
        clpPerWorker: OVERAGE_CLP_PER_WORKER_NET,
        clpPerProject: OVERAGE_CLP_PER_PROJECT_NET,
      },
      {
        emisorRazonSocial: process.env.BILLING_EMISOR_RAZON_SOCIAL,
      },
    );

    const db = admin.firestore();
    // Use the locally generated invoice.id as the Firestore doc id so the
    // CheckoutResponse and the Firestore document agree.
    await db.collection('invoices').doc(invoice.id).set({
      ...invoice,
      status: 'pending-payment',
      createdBy: callerUid,
      createdByEmail: callerEmail,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Adapter call â€” typed stubs throw, so we fall back to 'pending-config'.
    let paymentUrl: string | undefined;
    let status: CheckoutResponse['status'] = 'pending-config';

    if (body.paymentMethod === 'webpay' && webpayAdapter.isConfigured()) {
      try {
        const tx = await tracedAsync(
          'billing.checkout.webpay',
          { invoiceId: invoice.id, tierId: body.tierId, currency: body.currency },
          () => webpayAdapter.createTransaction({
            buyOrder: invoice.id.slice(0, 26),
            sessionId: callerUid,
            amount: invoice.totals.total,
            returnUrl: `${process.env.APP_BASE_URL ?? ''}/billing/webpay/return`,
          }),
        );
        paymentUrl = tx.url;
        status = 'awaiting-payment';
      } catch (err) {
        logger.error('webpay_create_failed', err, { invoiceId: invoice.id });
        sentryCapture(err, { endpoint: 'billing.checkout.webpay', tags: { invoiceId: invoice.id } });
      }
    } else if (body.paymentMethod === 'stripe' && stripeAdapter.isConfigured()) {
      try {
        const session = await tracedAsync(
          'billing.checkout.stripe',
          { invoiceId: invoice.id, tierId: body.tierId, currency: body.currency },
          () => stripeAdapter.createCheckoutSession({
            invoiceId: invoice.id,
            priceId: process.env[`STRIPE_PRICE_${body.tierId.toUpperCase().replace(/-/g, '_')}`] ?? '',
            quantity: 1,
            customerEmail: cliente.email,
            successUrl: `${process.env.APP_BASE_URL ?? ''}/billing/success?invoice=${invoice.id}`,
            cancelUrl: `${process.env.APP_BASE_URL ?? ''}/billing/cancel?invoice=${invoice.id}`,
            metadata: { invoiceId: invoice.id, tierId: body.tierId },
          }),
        );
        paymentUrl = session.url;
        status = 'awaiting-payment';
      } catch (err) {
        logger.error('stripe_create_failed', err, { invoiceId: invoice.id });
        sentryCapture(err, { endpoint: 'billing.checkout.stripe', tags: { invoiceId: invoice.id } });
      }
    } else if (body.paymentMethod === 'manual-transfer') {
      // No external provider â€” admin marks paid via /mark-paid endpoint.
      status = 'awaiting-payment';
    }

    const response: CheckoutResponse = {
      invoiceId: invoice.id,
      invoice: { ...invoice, status: 'pending-payment' },
      paymentUrl,
      status,
    };
    return res.json(response);
  } catch (error: any) {
    logger.error('billing_checkout_failed', error, { uid: callerUid });
    sentryCapture(error, { endpoint: '/api/billing/checkout', tags: { method: 'POST', uid: callerUid } });
    return res.status(500).json({
      error: 'Checkout failed',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

// POST /api/billing/invoice/:id/mark-paid â€” admin manual fallback for
// transferencia bancaria. 403 unless caller has admin role; writes a
// matching audit_logs row directly via the Admin SDK.
billingApiRouter.post('/invoice/:id/mark-paid', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const callerEmail: string | null = req.user!.email ?? null;
  const invoiceId = req.params.id;

  if (typeof invoiceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(invoiceId)) {
    return res.status(400).json({ error: 'Invalid invoice id' });
  }

  try {
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      return res.status(403).json({ error: 'Forbidden: admin role required' });
    }

    const db = admin.firestore();
    const ref = db.collection('invoices').doc(invoiceId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const current = snap.data();
    if (current?.status === 'paid') {
      return res.json({ success: true, alreadyPaid: true });
    }
    if (current?.status === 'cancelled' || current?.status === 'refunded') {
      return res.status(409).json({ error: `Cannot mark ${current.status} invoice as paid` });
    }

    await ref.update({
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paidBy: callerUid,
      paidByEmail: callerEmail,
      paymentSource: 'manual',
    });

    // Mirror /api/audit-log behavior â€” write directly via Admin SDK so we
    // stamp the same fields without an extra HTTP hop.
    await db.collection('audit_logs').add({
      action: 'billing.mark-paid',
      module: 'billing',
      details: { invoiceId, total: current?.totals?.total, currency: current?.totals?.currency },
      userId: callerUid,
      userEmail: callerEmail,
      projectId: null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    // Sprint 49 D.8.b — DTE auto-issue decision (placeholder).
    // TODO Sprint 50 — connect to dteIssueQueue persister + PSE dispatch.
    try {
      const ownerUid: string | null = current?.createdBy ?? null;
      const payerInfo = (current?.payerInfo ?? {}) as DteIssueRequest['payerInfo'];
      const planCode: string =
        current?.lineItems?.[0]?.tierId ?? current?.tierId ?? 'unknown';
      if (ownerUid) {
        const decision = decideDteIssue({
          paymentId: `manual:${invoiceId}`,
          tenantId: ownerUid,
          payerInfo,
          amountClp: typeof current?.totals?.total === 'number' ? current.totals.total : 0,
          planCode,
          paymentGateway: 'manual',
          paidAt: new Date().toISOString(),
        });
        logger.info('dte_autoissue_decision', {
          source: 'mark-paid',
          invoiceId,
          ownerUid,
          shouldIssue: decision.shouldIssue,
          documentKind: decision.documentKind,
          reason: decision.reason,
          idempotencyKey: decision.idempotencyKey,
        });
      }
    } catch (dteErr) {
      logger.error('dte_autoissue_decision_failed', dteErr as Error, { invoiceId });
      sentryCapture(dteErr, { endpoint: 'billing.markPaid.dteAutoIssue', tags: { invoiceId } });
    }

    return res.json({ success: true });
  } catch (error: any) {
    logger.error('billing_mark_paid_failed', error, { uid: callerUid, invoiceId });
    sentryCapture(error, { endpoint: '/api/billing/invoice/:id/mark-paid', tags: { method: 'POST', uid: callerUid, invoiceId } });
    return res.status(500).json({
      error: 'Mark-paid failed',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

// GET /api/billing/invoice/:id â€” read-only status poll for the SPA's
// post-checkout waiting screen. Returns ONLY safe fields (no purchaseToken,
// no internal audit metadata, no payer notes). Authorization model:
//
//   â€¢ verifyAuth gates the request to a logged-in user (req.user.uid).
//   â€¢ The doc must have been created by the same uid (`createdBy === uid`).
//   â€¢ Mismatch â†’ 404 (deliberate: do NOT 403, which would leak existence).
//
// We deliberately do NOT expose: the full lineItems list (already in the
// CheckoutResponse the client already has), webpayToken (bearer-credential),
// webpayAuthCode (PCI-adjacent), createdByEmail (PII duplicated elsewhere),
// or rawResponse fields from the adapter. If Pricing.tsx needs more, add
// fields here narrowly â€” never spread the entire doc.
billingApiRouter.get('/invoice/:id', verifyAuth, invoiceStatusLimiter, async (req, res) => {
  const callerUid = req.user!.uid;
  const invoiceId = req.params.id;

  if (typeof invoiceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(invoiceId)) {
    return res.status(400).json({ error: 'Invalid invoice id' });
  }

  try {
    const db = admin.firestore();
    const snap = await db.collection('invoices').doc(invoiceId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const data = snap.data() ?? {};

    // Authorization: the invoice must belong to the caller. We use
    // `createdBy` (set in /api/billing/checkout) as the owner uid. A
    // mismatch returns 404, NOT 403 â€” this prevents enumeration of
    // other users' invoice ids.
    if (data.createdBy !== callerUid) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    // Convert Firestore Timestamps to ISO strings for the wire shape.
    const tsToIso = (v: any): string | undefined => {
      if (!v) return undefined;
      if (typeof v === 'string') return v;
      if (typeof v.toDate === 'function') return v.toDate().toISOString();
      return undefined;
    };

    const safe: {
      id: string;
      status: 'draft' | 'pending-payment' | 'paid' | 'cancelled' | 'rejected' | 'refunded';
      totals: { subtotal: number; iva: number; total: number; currency: 'CLP' | 'USD' };
      emisorRut: '78231119-0';
      issuedAt: string;
      paidAt?: string;
      rejectionReason?: string;
    } = {
      id: invoiceId,
      status: data.status,
      totals: {
        subtotal: data.totals?.subtotal ?? 0,
        iva: data.totals?.iva ?? 0,
        total: data.totals?.total ?? 0,
        currency: data.totals?.currency ?? 'CLP',
      },
      emisorRut: '78231119-0',
      issuedAt: tsToIso(data.issuedAt) ?? tsToIso(data.createdAt) ?? '',
    };

    if (safe.status === 'paid') {
      safe.paidAt = tsToIso(data.paidAt);
    }
    if (safe.status === 'rejected' && typeof data.rejectionReason === 'string') {
      safe.rejectionReason = data.rejectionReason;
    }

    return res.json(safe);
  } catch (error: any) {
    logger.error('billing_invoice_status_failed', error, { uid: callerUid, invoiceId });
    sentryCapture(error, { endpoint: '/api/billing/invoice/:id', tags: { method: 'GET', uid: callerUid, invoiceId } });
    return res.status(500).json({
      error: 'Invoice status read failed',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

// POST /api/billing/checkout/mercadopago â€” Round 15 R2. LATAM checkout
// (PE/AR/CO/MX/BR). Auth-gated; idempotent at the invoice layer. Round 16
// will add the matching IPN webhook with OIDC verification similar to
// RTDN â€” until then MP payments must be reconciled via /mark-paid (same
// admin fallback used for transferencia bancaria).
billingApiRouter.post('/checkout/mercadopago', verifyAuth, idempotencyKey(), async (req, res) => {
  const callerUid = req.user!.uid;
  const callerEmail: string | null = req.user!.email ?? null;

  try {
    const body = req.body ?? {};

    // Input validation â€” fail closed. Never trust currency/country pair
    // from the client; mismatches reject with 400.
    if (typeof body.tierKey !== 'string' || body.tierKey.length === 0 || body.tierKey.length > 64) {
      return res.status(400).json({ error: 'Invalid tierKey' });
    }
    if (body.billingCycle !== 'monthly' && body.billingCycle !== 'annual') {
      return res.status(400).json({ error: 'Invalid billingCycle' });
    }
    if (typeof body.country !== 'string' || !(body.country in MP_CURRENCY_BY_COUNTRY)) {
      return res.status(400).json({
        error: 'Invalid country (must be one of PE, AR, CO, MX, BR)',
      });
    }
    const country = body.country as keyof typeof MP_CURRENCY_BY_COUNTRY;
    const expectedCurrency = MP_CURRENCY_BY_COUNTRY[country];
    if (body.currency !== expectedCurrency) {
      return res.status(400).json({
        error: `Country ${country} requires currency ${expectedCurrency}`,
      });
    }
    if (!MP_VALID_TUPLES.has(`${country}:${body.currency}`)) {
      return res.status(400).json({ error: 'Invalid country/currency combination' });
    }

    if (!mercadoPagoAdapter.isConfigured()) {
      return res.status(503).json({
        error: 'MercadoPago is not configured on this environment',
      });
    }

    // Load tier from the existing fallback table â€” same source of
    // truth as the Webpay path.
    const tier = resolveBillingTier(body.tierKey);
    if (!tier) {
      return res.status(400).json({ error: 'Unknown tierKey' });
    }

    // Compute MP unit_price from the tier's USD anchor. Annual cycles
    // get the 12x annual figure (MP supports preference-level recurrence
    // via PreApproval, which is a Round 16 concern â€” for now we charge
    // the annual lump sum).
    const usdAmount = body.billingCycle === 'annual' ? tier.usdAnual : tier.usdRegular;
    const multiplier = MP_UNIT_PRICE_USD_MULTIPLIER[expectedCurrency] ?? 1;
    // Round to 2 decimals so MP doesn't reject odd float precision.
    const unitPrice = Math.round(usdAmount * multiplier * 100) / 100;

    // Build a minimal invoice doc. We deliberately DO NOT call the
    // shared `buildInvoice()` here â€” that path is Chile-specific (CLP /
    // IVA / RUT). MP invoices live in the same Firestore collection
    // but with a `paymentMethod: 'mercadopago'` tag and the local-
    // currency totals. Round 16 will refactor `buildInvoice` to be
    // multi-currency aware.
    const db = admin.firestore();
    const invoiceId = `inv_mp_${Date.now()}_${randomUUID()}`;

    const baseUrl = process.env.APP_BASE_URL ?? '';
    const backUrls = {
      success: `${baseUrl}/pricing/success?invoice=${encodeURIComponent(invoiceId)}`,
      pending: `${baseUrl}/pricing/retry?invoice=${encodeURIComponent(invoiceId)}`,
      failure: `${baseUrl}/pricing/failed?invoice=${encodeURIComponent(invoiceId)}`,
    };
    const notificationUrl = `${baseUrl}/api/billing/webhook/mercadopago`;

    let preference: { id: string; init_point: string };
    try {
      preference = await tracedAsync(
        'billing.checkout.mercadopago',
        { invoiceId, country, currency: expectedCurrency, tierKey: body.tierKey },
        () => mercadoPagoAdapter.createPreference({
        items: [
          {
            title: `Praeventio Guard â€” ${body.tierKey} (${body.billingCycle})`,
            quantity: 1,
            unit_price: unitPrice,
            currency_id: expectedCurrency as MercadoPagoCurrencyId,
          },
        ],
        payer: { email: callerEmail ?? '' },
        back_urls: backUrls,
        notification_url: notificationUrl,
        external_reference: invoiceId,
        }),
      );
    } catch (err) {
      logger.error('mercadopago_create_failed', err, { invoiceId, country });
      sentryCapture(err, { endpoint: 'billing.checkout.mercadopago', tags: { invoiceId, country } });
      if (err instanceof MercadoPagoAdapterError) {
        return res.status(502).json({ error: 'MercadoPago preference creation failed' });
      }
      throw err;
    }

    await db.collection('invoices').doc(invoiceId).set({
      id: invoiceId,
      status: 'pending-payment',
      paymentMethod: 'mercadopago',
      mercadoPagoPreferenceId: preference.id,
      country,
      cliente: {
        nombre: callerEmail ?? 'Cliente Praeventio',
        email: callerEmail ?? '',
      },
      lineItems: [
        {
          tierId: body.tierKey,
          description: `Praeventio Guard â€” ${body.tierKey} (${body.billingCycle})`,
          quantity: 1,
          unitAmount: unitPrice,
          currency: expectedCurrency,
        },
      ],
      totals: {
        subtotal: unitPrice,
        iva: 0, // Local sales tax handled by MP itself per country.
        total: unitPrice,
        currency: expectedCurrency,
      },
      issuedAt: new Date().toISOString(),
      createdBy: callerUid,
      createdByEmail: callerEmail,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Audit log â€” mirror the /api/billing/checkout pattern but with the
    // mercadopago.preference.created action so dashboards can split the
    // funnel by payment rail.
    await db.collection('audit_logs').add({
      action: 'billing.mercadopago.preference.created',
      module: 'billing',
      details: {
        invoiceId,
        preferenceId: preference.id,
        tierKey: body.tierKey,
        billingCycle: body.billingCycle,
        country,
        currency: expectedCurrency,
        amount: unitPrice,
      },
      userId: callerUid,
      userEmail: callerEmail,
      projectId: null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    return res.json({
      preferenceId: preference.id,
      init_point: preference.init_point,
      invoiceId,
    });
  } catch (error: any) {
    logger.error('billing_mercadopago_checkout_failed', error, { uid: callerUid });
    sentryCapture(error, { endpoint: '/api/billing/checkout/mercadopago', tags: { method: 'POST', uid: callerUid } });
    return res.status(500).json({
      error: 'MercadoPago checkout failed',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

// POST /api/billing/webhook/mercadopago â€” Round 18 R2 (deferred from R17),
// extended in Round 19 (A9) with OIDC JWT verification.
//
// MercadoPago IPN endpoint. Public route (no verifyAuth) â€” trust comes from
// signature verification. Two modes are supported in the same handler:
//
//   Precedence: OIDC > HMAC > LEGACY_HMAC_FALLBACK
//
//   1. OIDC (Round 19): if the request carries
//      `Authorization: Bearer <jwt>`, the JWT is RS256-verified against
//      MP's JWKS (cached 6h via mpJwksCache.ts). Issuer / audience / exp
//      are checked. This is MP's go-forward auth scheme.
//
//   2. HMAC (Round 18 R6): if no Authorization header is present (or OIDC
//      verification fails), we fall back to `x-signature` HMAC-SHA256 over
//      the RFC 8785 canonical-JSON form of the parsed body, validated
//      against MP_IPN_SECRET.
//
//   3. LEGACY_HMAC_FALLBACK=1 (emergency rollback): inside the HMAC path,
//      `verifyMercadoPagoIpnSignatureFromBody` will additionally accept a
//      legacy JSON.stringify-signed body. Off by default. Turn back off
//      ASAP â€” see the helper definition for the signal we emit on use.
//
// All three failure modes return 401. The body still re-fetches canonical
// payment state from MP via the adapter, idempotent on
// `processed_mp_ipn/{paymentId}`.
//
// 2026-05-15 (Regla #3): se agregó el formato productivo `ts=<ts>,v1=<hex>`
// (manifest `id:<data.id>;request-id:<rid>;ts:<ts>;`). El handler ahora
// acepta ambos formatos vía `verifyMpIpnAnyFormat` y rechaza replay > 5 min.
billingApiRouter.post('/webhook/mercadopago', async (req, res) => {
  const authHeader = req.header('authorization') ?? '';
  const xSignature = req.header('x-signature') ?? '';
  const xRequestId = req.header('x-request-id') ?? '';
  const dataId =
    typeof req.body?.data?.id === 'string'
      ? req.body.data.id
      : req.body?.data?.id != null
        ? String(req.body.data.id)
        : '';

  // Tier 1 (preferred): OIDC JWT in `Authorization: Bearer ...`.
  let authenticated = false;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const oidc = await verifyMercadoPagoIpnOidc(authHeader);
    if (oidc.valid) {
      authenticated = true;
    } else {
      // Log the OIDC-side reason for ops, then fall through to HMAC. Note
      // that we don't outright 401 here â€” MP could be in the middle of
      // rolling out OIDC delivery and a sender that legacily sets BOTH
      // headers should still succeed via HMAC.
      logger.warn('mp_ipn_oidc_failed', { reason: oidc.reason ?? null });
    }
  }

  // Tier 2: HMAC. 2026-05-15 (Regla #3): el helper `verifyMpIpnAnyFormat`
  // detecta automáticamente el formato productivo (`ts=...,v1=...` con
  // manifest `id;request-id;ts`) vs legacy (`sha256=<hex>` sobre canonical
  // body). Sin esto, los IPN productivos de MP fallaban con 401.
  if (!authenticated) {
    authenticated = verifyMpIpnAnyFormat({
      signatureHeader: xSignature,
      requestIdHeader: xRequestId,
      dataId,
      parsedBody: req.body ?? {},
      secret: process.env.MP_IPN_SECRET ?? '',
    });
  }

  if (!authenticated) {
    return res.status(401).send('Invalid signature');
  }

  try {
    const paymentId = req.body?.data?.id;
    const result = await tracedAsync(
      'billing.webhook.mercadopago',
      { paymentId: paymentId ?? null, action: req.body?.action ?? null },
      () => processMercadoPagoIpn(req.body ?? {}),
    );
    // Sprint 28 H18 â€” audit success and replay for MP webhooks.
    if (result.idempotencyKind === 'duplicate') {
      await auditServerEvent(req, 'billing.webhook.replay', 'billing', {
        replay: true,
        source: 'mercadopago',
        txn: paymentId ?? null,
        invoiceId: result.invoiceId || null,
      }).catch(() => {});
    } else if (
      result.idempotencyKind === 'fresh-success' ||
      result.idempotencyKind === 'stale-retry'
    ) {
      await auditServerEvent(req, 'billing.webhook.success', 'billing', {
        source: 'mercadopago',
        txn: paymentId ?? null,
        invoiceId: result.invoiceId || null,
        outcome: result.outcome,
        idempotencyKind: result.idempotencyKind,
      }).catch(() => {});

      // Sprint 49 D.8.b → 2026-05-15: DTE auto-issue REAL.
      // ANTES: solo decideDteIssue + log, sin invocar el emitter.
      // AHORA: decision.shouldIssue=true → tryAutoIssueDte (gated por env
      // DTE_AUTO_ISSUE para activación controlada).
      // Mismo patrón que webpay/return — fail-soft, no bloquea ack del IPN.
      if (result.outcome === 'paid' && result.invoiceId) {
        try {
          const invoiceSnap = await admin
            .firestore()
            .collection('invoices')
            .doc(result.invoiceId)
            .get();
          const invoiceData = invoiceSnap.data();
          const ownerUid: string | null = invoiceData?.createdBy ?? null;
          const payerInfo = (invoiceData?.payerInfo ?? {}) as DteIssueRequest['payerInfo'];
          const planCode: string =
            invoiceData?.lineItems?.[0]?.tierId ?? invoiceData?.tierId ?? 'unknown';
          const amountClp =
            typeof invoiceData?.totals?.total === 'number' ? invoiceData.totals.total : 0;
          if (ownerUid) {
            const decision = decideDteIssue({
              paymentId: String(paymentId ?? result.invoiceId),
              tenantId: ownerUid,
              payerInfo,
              amountClp,
              planCode,
              paymentGateway: 'mercadopago',
              paidAt: new Date().toISOString(),
            });
            logger.info('dte_autoissue_decision', {
              source: 'mercadopago-ipn',
              invoiceId: result.invoiceId,
              ownerUid,
              shouldIssue: decision.shouldIssue,
              documentKind: decision.documentKind,
              reason: decision.reason,
              idempotencyKey: decision.idempotencyKey,
            });

            if (decision.shouldIssue && invoiceData) {
              try {
                const { tryAutoIssueDte } = await import(
                  '../../services/billing/invoice.js'
                );
                const invoiceForDte = {
                  ...invoiceData,
                  id: result.invoiceId,
                  status: 'paid' as const,
                  paidAt: new Date().toISOString(),
                };
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const issueResult = await tryAutoIssueDte(invoiceForDte as any);
                logger.info('dte_autoissue_result', {
                  source: 'mercadopago-ipn',
                  invoiceId: result.invoiceId,
                  ownerUid,
                  ok: issueResult.ok,
                  skipped: issueResult.skipped ?? null,
                  folio: issueResult.result?.folio ?? null,
                  errorMessage: issueResult.errorMessage ?? null,
                });
              } catch (issueErr) {
                logger.error('dte_autoissue_invoke_failed', issueErr as Error, {
                  source: 'mercadopago-ipn',
                  invoiceId: result.invoiceId,
                });
                sentryCapture(issueErr, {
                  endpoint: 'billing.mp.dteAutoIssue.invoke',
                  tags: { invoiceId: result.invoiceId },
                });
              }
            }
          }
        } catch (dteErr) {
          logger.error('dte_autoissue_decision_failed', dteErr as Error, {
            invoiceId: result.invoiceId,
          });
          sentryCapture(dteErr, {
            endpoint: 'billing.mp.dteAutoIssue',
            tags: { invoiceId: result.invoiceId },
          });
        }
      }
    }
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.error('mp_ipn_processing_failed', err as Error, {
      paymentId: req.body?.data?.id,
    });
    sentryCapture(err, { endpoint: '/api/billing/webhook/mercadopago', tags: { method: 'POST', paymentId: req.body?.data?.id ?? null } });
    return res.status(500).send('IPN processing failed');
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Webpay return URL â€” Transbank redirects the cardholder's browser back here
// after they pay. Mounted at /billing/webpay/return (NOT /api/) because
// Transbank's commerce config has this exact path registered.
//
// NOT auth-gated: the user may not have our session cookie at this point.
// Trust comes from the `token_ws` query param being verified by
// `webpayAdapter.commitTransaction`.
//
// Idempotency model (lock-then-complete via `processed_webpay/{token_ws}`):
//
//   processed_webpay is a server-only collection (default-deny via the
//   absence of any rule in firestore.rules â€” see header TODO there).
//   We mirror the Google Play RTDN pattern (`processed_pubsub`) so a
//   redelivered token (browser reload, double-tap, eventual-consistency
//   second hit) cannot double-process the commit.
//
//   - 'done'        â†’ replay the original outcome â†’ original redirect URL.
//   - 'in_progress' fresh (<5 min) â†’ another worker is on it; redirect to
//                                   /pricing/success and let the SPA poll.
//   - 'in_progress' stale (>5 min) â†’ assume the original processor died;
//                                   steal the lock and re-run.
//   - absent        â†’ write 'in_progress', commit, then update to 'done'.
//
//   On exception we deliberately do NOT update the doc; the staleness
//   window grants the next redelivery a fresh attempt.
//
// Status-mapping (matches WebpayCommitStatus + Invoice status):
//   AUTHORIZED â†’ invoice 'paid'           â†’ /pricing/success?invoice=...
//   REJECTED   â†’ invoice 'rejected'       â†’ /pricing/failed?invoice=...
//                (NOT 'cancelled' â€” card decline â‰  user cancellation)
//   FAILED     â†’ invoice stays 'pending-payment' â†’ /pricing/retry?invoice=...
//                (transient infra error; same card can retry)
//
// PARALLEL TO RTDN (`/api/billing/webhook`): both handlers implement
// lock-then-complete idempotency. RTDN now uses the shared
// `withIdempotency` helper from `src/services/billing/idempotency.ts`.
// This endpoint keeps the Webpay-specific `acquireWebpayIdempotencyLock`
// / `finalizeWebpayIdempotencyLock` wrappers because they encode the
// outcome+invoiceId replay-redirect contract (see types in
// webpayAdapter.ts) which is too domain-specific to fold into the
// generic helper without muddying its return shape.
// TODO(billing): consider unifying after the next round â€” risk in this
// commit is too high (would touch the entire payment confirmation
// path; deferring until invoice-replay typing settles).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
billingWebpayRouter.get('/webpay/return', async (req, res) => {
  // Round 13: capture wall-clock at handler entry so we can emit a
  // single `praeventio/webpay/return_latency_ms` histogram observation
  // at every exit. `outcome` is one of {success, failure, invalid}
  // â€” see src/services/billing/webpayMetrics.ts for label discipline.
  // The label key MUST match the Terraform descriptor (monitoring.tf
  // `webpay_return_latency`) â€” descriptor labels are immutable.
  const startedAt = performance.now();
  const elapsed = () => performance.now() - startedAt;

  const tokenWs = typeof req.query.token_ws === 'string' ? req.query.token_ws : null;
  if (!tokenWs || !/^[A-Za-z0-9_-]{1,128}$/.test(tokenWs)) {
    recordWebpayReturnLatency({ outcome: 'invalid', latencyMs: elapsed() });
    return res.status(400).send('Missing or invalid token_ws');
  }

  const db = admin.firestore();
  const lockRef = db.collection('processed_webpay').doc(tokenWs);

  // Helper: build the SPA redirect URL given the outcome + invoiceId.
  const redirectFor = (outcome: WebpayReturnOutcome, invoiceId: string | null): string => {
    const inv = invoiceId ? `?invoice=${encodeURIComponent(invoiceId)}` : '';
    if (outcome === 'paid') return `/pricing/success${inv}`;
    if (outcome === 'rejected') return `/pricing/failed${inv}`;
    // 'failed' (transient): user can retry the same card.
    return `/pricing/retry${inv}`;
  };

  // Map WebpayReturnOutcome (paid|rejected|failed) to the histogram's
  // `outcome` label (success|failure|invalid). Keep cardinality LOW â€”
  // see webpayMetrics.ts header.
  const histogramOutcomeFor = (
    o: WebpayReturnOutcome,
  ): 'success' | 'failure' => (o === 'paid' ? 'success' : 'failure');

  try {
    // Step 1: try to acquire the idempotency lock.
    const lock = await acquireWebpayIdempotencyLock(lockRef);
    if (!lock.acquired) {
      if (lock.alreadyDone && lock.outcome) {
        // Replay the original redirect.
        recordWebpayReturnLatency({
          outcome: histogramOutcomeFor(lock.outcome),
          latencyMs: elapsed(),
        });
        // Sprint 28 H18 â€” audit webhook replay for Webpay returns.
        await auditServerEvent(req, 'billing.webhook.replay', 'billing', {
          replay: true,
          source: 'webpay',
          txn: tokenWs,
          invoiceId: lock.invoiceId ?? null,
          previousOutcome: lock.outcome,
        }).catch(() => {});
        return res.redirect(redirectFor(lock.outcome, lock.invoiceId ?? null));
      }
      // In-flight from another worker. Mirror RTDN's "ack and let UI handle
      // eventual consistency" â€” redirect to /pricing/success and the SPA
      // will surface the actual state once Firestore catches up.
      recordWebpayReturnLatency({ outcome: 'success', latencyMs: elapsed() });
      return res.redirect(`/pricing/success`);
    }

    // Step 2: do the real work.
    const commit = await webpayAdapter.commitTransaction(tokenWs);
    const invoiceId = commit.buyOrder;
    const invoiceRef = db.collection('invoices').doc(invoiceId);

    let outcome: WebpayReturnOutcome;
    if (commit.status === 'AUTHORIZED') {
      outcome = 'paid';
      await invoiceRef.set({
        status: 'paid',
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        paymentSource: 'webpay',
        webpayToken: tokenWs,
        webpayAuthCode: commit.authorizationCode ?? null,
      }, { merge: true });

      // Round 22 â€” audit fix CRITICAL #2 (DT-02): activar suscripciÃ³n
      // del usuario tras pago confirmado. Sin esto el invoice quedaba
      // 'paid' pero users/{uid}.subscription.planId nunca cambiaba.
      // Best-effort: no rompe el redirect si la actualizaciÃ³n falla
      // (admin tiene /api/billing/invoice/:id/mark-paid como fallback).
      try {
        const invoiceSnap = await invoiceRef.get();
        const invoiceData = invoiceSnap.data();
        const lineItems = Array.isArray(invoiceData?.lineItems) ? invoiceData!.lineItems : [];
        const tierId = lineItems[0]?.tierId ?? invoiceData?.tierId ?? null;
        const ownerUid = invoiceData?.createdBy ?? null;
        const planId = normalizeSubscriptionPlanId(tierId);
        if (ownerUid && tierId && planId) {
          await db.collection('users').doc(ownerUid).set(
            {
              subscriptionPlan: planId,
              subscription: {
                planId,
                tierId,
                status: 'active',
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                lastInvoiceId: invoiceId,
                paymentMethod: 'webpay',
              },
            },
            { merge: true },
          );
          logger.info('webpay_subscription_activated', { uid: ownerUid, tierId, invoiceId });
        } else {
          logger.warn('webpay_subscription_missing_data', { ownerUid, tierId, invoiceId });
        }
      } catch (subErr) {
        logger.error('webpay_subscription_update_failed', subErr as Error, { invoiceId });
        sentryCapture(subErr, { endpoint: 'billing.webpay.subscriptionUpdate', tags: { invoiceId } });
      }

      await db.collection('audit_logs').add({
        action: 'billing.webpay-return.authorized',
        module: 'billing',
        details: { invoiceId, amount: commit.amount, authCode: commit.authorizationCode },
        userId: null, userEmail: null, projectId: null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null,
      });

      // Sprint 49 D.8.b → Codex fake fix §2.10 (2026-05-15):
      // ANTES: solo se decidía y loggeaba (decideDteIssue), pero NUNCA se
      // llamaba `tryAutoIssueDte()` → facturas pagadas no auto-emitían DTE.
      //
      // AHORA: si `decision.shouldIssue === true`, llamamos
      // `tryAutoIssueDte()` que respeta `DTE_AUTO_ISSUE` env (default false).
      // En producción quedará off hasta que infra setee la env var; entonces
      // empieza a emitir vía Bsale automáticamente. Nunca bloquea el redirect
      // — los errores se loggean + capturan a Sentry pero el user sigue su
      // flujo de pago confirmado.
      try {
        const invoiceSnap = await invoiceRef.get();
        const invoiceData = invoiceSnap.data();
        const ownerUid: string | null = invoiceData?.createdBy ?? null;
        const payerInfo = (invoiceData?.payerInfo ?? {}) as DteIssueRequest['payerInfo'];
        const planCode: string =
          invoiceData?.lineItems?.[0]?.tierId ?? invoiceData?.tierId ?? 'unknown';
        if (ownerUid) {
          const decision = decideDteIssue({
            paymentId: tokenWs,
            tenantId: ownerUid,
            payerInfo,
            amountClp: typeof commit.amount === 'number' ? commit.amount : 0,
            planCode,
            paymentGateway: 'webpay',
            paidAt: new Date().toISOString(),
          });
          logger.info('dte_autoissue_decision', {
            source: 'webpay-return',
            invoiceId,
            ownerUid,
            shouldIssue: decision.shouldIssue,
            documentKind: decision.documentKind,
            reason: decision.reason,
            idempotencyKey: decision.idempotencyKey,
          });

          // Si la decisión es emit, ahora SÍ ejecutamos vía tryAutoIssueDte.
          // El helper respeta env DTE_AUTO_ISSUE — fail-soft si no está
          // habilitado (skipped: 'disabled') o si no hay adapter Bsale
          // (skipped: 'no-adapter'). En esos casos solo loggeamos.
          if (decision.shouldIssue && invoiceData) {
            try {
              const { tryAutoIssueDte } = await import(
                '../../services/billing/invoice.js'
              );
              // El invoiceData ya tiene el shape Invoice porque persiste
              // desde createInvoice() en el mismo módulo. Re-hidratamos el
              // status a 'paid' por si Firestore aún no propagó.
              const invoiceForDte = {
                ...invoiceData,
                id: invoiceId,
                status: 'paid' as const,
                paidAt: new Date().toISOString(),
              };
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const result = await tryAutoIssueDte(invoiceForDte as any);
              logger.info('dte_autoissue_result', {
                source: 'webpay-return',
                invoiceId,
                ownerUid,
                ok: result.ok,
                skipped: result.skipped ?? null,
                folio: result.result?.folio ?? null,
                errorMessage: result.errorMessage ?? null,
              });
            } catch (issueErr) {
              logger.error('dte_autoissue_invoke_failed', issueErr as Error, {
                source: 'webpay-return',
                invoiceId,
              });
              sentryCapture(issueErr, {
                endpoint: 'billing.webpay.dteAutoIssue.invoke',
                tags: { invoiceId },
              });
            }
          }
        }
      } catch (dteErr) {
        // Never block the redirect on the DTE decision — it's advisory.
        logger.error('dte_autoissue_decision_failed', dteErr as Error, { invoiceId });
        sentryCapture(dteErr, { endpoint: 'billing.webpay.dteAutoIssue', tags: { invoiceId } });
      }
    } else if (commit.status === 'REJECTED') {
      // Card-side decline. Invoice stays actionable â€” user may retry with a
      // different card. 'cancelled' is reserved for explicit user/admin
      // cancellation only.
      outcome = 'rejected';
      await invoiceRef.set(
        { status: 'rejected', webpayToken: tokenWs },
        { merge: true },
      );
      // Sprint 20 18th-wave â€” TM-R02 closure. Mirror the AUTHORIZED audit
      // row so a customer dispute on a "rejected" outcome has a tamper-
      // evident server-side trail (Repudiation threat in STRIDE).
      await db.collection('audit_logs').add({
        action: 'billing.webpay-return.rejected',
        module: 'billing',
        details: { invoiceId, amount: commit.amount },
        userId: null, userEmail: null, projectId: null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null,
      });
    } else {
      // FAILED (-96/-97/-98 or malformed). Transient. Keep status
      // 'pending-payment' so the user can retry the same card.
      outcome = 'failed';
      await invoiceRef.set(
        { status: 'pending-payment', webpayToken: tokenWs },
        { merge: true },
      );
      // Sprint 20 18th-wave â€” TM-R02 closure. Same audit-row contract as
      // the REJECTED branch; distinguishes transient infra failures from
      // card-side declines for ops dashboards.
      await db.collection('audit_logs').add({
        action: 'billing.webpay-return.failed',
        module: 'billing',
        details: { invoiceId, amount: commit.amount },
        userId: null, userEmail: null, projectId: null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null,
      });
    }

    // Step 3: finalize the lock so a redelivery can replay the redirect.
    // Best-effort â€” never throws.
    await finalizeWebpayIdempotencyLock(lockRef, {
      outcome,
      invoiceId,
      serverTimestamp: () => admin.firestore.FieldValue.serverTimestamp(),
    });

    recordWebpayReturnLatency({
      outcome: histogramOutcomeFor(outcome),
      latencyMs: elapsed(),
    });
    return res.redirect(redirectFor(outcome, invoiceId));
  } catch (error: any) {
    // Deliberate: do NOT update processed_webpay here. Leaving the doc as
    // 'in_progress' allows the staleness window to grant a future
    // redelivery a fresh attempt â€” same approach as the RTDN handler.
    logger.error('webpay_return_failed', error, { tokenWs });
    sentryCapture(error, { endpoint: '/billing/webpay/return', tags: { method: 'GET' } });
    recordWebpayReturnLatency({ outcome: 'failure', latencyMs: elapsed() });
    return res.redirect(`/pricing/failed?error=webpay`);
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/billing/khipu/webhook â€” Khipu IPN endpoint.
//
// Public route (no verifyAuth) â€” trust comes from the HMAC-SHA256 signature
// on the `X-Khipu-Signature` header (`t=<unix-seconds>,s=<hex>`). Body is
// parsed as RAW so the signature input matches exactly what Khipu signed
// â€” going through `express.json()` would re-serialise and break the HMAC.
//
// Idempotency: shared `withIdempotency` helper keyed on the Khipu
// `payment_id` (or `notification_id`/`api_request_id` if present), mirroring
// the MercadoPago IPN pattern. The work() block is intentionally minimal:
// after authenticating the producer, we re-fetch canonical state via
// `getPaymentStatus()` (the IPN body is informational only â€” never trust
// status fields from a webhook payload directly), update the invoice, and
// write an audit log row.
//
// Mounted on the API router (NOT the /billing/webpay/* router) because
// Khipu is the producer and they choose the URL â€” we control it with our
// own commerce config rather than Transbank's.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
billingApiRouter.post(
  '/khipu/webhook',
  express.raw({ type: 'application/json', limit: '10kb' }),
  async (req, res) => {
    const signature = req.header('x-khipu-signature') ?? '';
    // express.raw gives us a Buffer; decode once and reuse for both the
    // HMAC input and the JSON parse.
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string'
      ? req.body
      : '';

    const adapter = KhipuAdapter.fromEnv();
    if (!adapter.verifyWebhookSignature(rawBody, signature)) {
      // Do NOT echo the signature or rawBody back; ops can correlate via
      // request id + remote IP in the access log.
      return res.status(401).json({ error: 'invalid_signature' });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }

    const paymentId: string | undefined =
      typeof payload?.payment_id === 'string' ? payload.payment_id : undefined;
    const notificationId: string | undefined =
      typeof payload?.notification_id === 'string'
        ? payload.notification_id
        : typeof payload?.api_request_id === 'string'
        ? payload.api_request_id
        : undefined;
    const dedupeKey = notificationId ?? paymentId;

    if (!paymentId || !dedupeKey) {
      // Without a stable id we can't dedupe; ack 200 to suppress retries
      // (mirrors the RTDN handler's missing-messageId behaviour).
      logger.warn('khipu_ipn_missing_id');
      return res.status(200).json({ received: true });
    }

    const db = admin.firestore();

    try {
      const outcome = await withIdempotency(
        db,
        { collection: 'processed_khipu', key: dedupeKey },
        async () => {
          // Re-fetch canonical state â€” never trust status fields from the
          // webhook body alone (they're informational; the producer might
          // be fooled by a downstream replay).
          const status = await tracedAsync(
            'billing.webhook.khipu',
            { paymentId, dedupeKey },
            () => adapter.getPaymentStatus(paymentId),
          );
          const invoiceId = status.buyOrder;
          if (!invoiceId) {
            logger.warn('khipu_ipn_no_transaction_id', { paymentId });
            return { ok: false as const };
          }
          const invoiceRef = db.collection('invoices').doc(invoiceId);

          if (status.status === 'completed') {
            await invoiceRef.set(
              {
                status: 'paid',
                paidAt: admin.firestore.FieldValue.serverTimestamp(),
                paymentSource: 'khipu',
                khipuPaymentId: paymentId,
              },
              { merge: true },
            );
            await db.collection('audit_logs').add({
              action: 'billing.khipu-ipn.completed',
              module: 'billing',
              details: { invoiceId, amount: status.amount, paymentId },
              userId: null,
              userEmail: null,
              projectId: null,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              ip: req.ip ?? null,
              userAgent: req.header('user-agent') ?? null,
            });
          } else if (status.status === 'cancelled' || status.status === 'expired') {
            await invoiceRef.set(
              { status: 'rejected', khipuPaymentId: paymentId },
              { merge: true },
            );
            await db.collection('audit_logs').add({
              action: `billing.khipu-ipn.${status.status}`,
              module: 'billing',
              details: { invoiceId, amount: status.amount, paymentId },
              userId: null,
              userEmail: null,
              projectId: null,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              ip: req.ip ?? null,
              userAgent: req.header('user-agent') ?? null,
            });
          }
          // 'pending' / 'verifying' â†’ leave invoice as 'pending-payment';
          // a later IPN will fire when the bank confirms.

          return { ok: true as const, status: status.status };
        },
      );

      if (outcome.kind === 'in-flight') {
        logger.info('khipu_ipn_in_progress_skip', { dedupeKey });
      } else if (outcome.kind === 'stale-retry') {
        logger.warn('khipu_ipn_stale_lock_stealing', { dedupeKey });
      }

      // Sprint 28 H18 â€” audit replay vs success for Khipu webhooks.
      if (outcome.kind === 'duplicate') {
        await auditServerEvent(req, 'billing.webhook.replay', 'billing', {
          replay: true,
          source: 'khipu',
          txn: dedupeKey,
          paymentId,
        }).catch(() => {});
      } else if (
        outcome.kind === 'fresh-success' ||
        outcome.kind === 'stale-retry'
      ) {
        await auditServerEvent(req, 'billing.webhook.success', 'billing', {
          source: 'khipu',
          txn: dedupeKey,
          paymentId,
          outcome: outcome.kind,
        }).catch(() => {});
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      logger.error('khipu_ipn_failed', err, { dedupeKey, paymentId });
      sentryCapture(err, { endpoint: '/api/billing/khipu/webhook', tags: { method: 'POST', paymentId: paymentId ?? null } });
      // 500 keeps the IPN retry loop alive on the Khipu side; the
      // staleness window will grant the next redelivery a fresh attempt.
      return res.status(500).json({ error: 'ipn_processing_failed' });
    }
  },
);

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sprint 21 Ola 6 Bucket T â€” IAP receipt validation stubs.
//
// The Capacitor IAP plugin (used by Pricing.tsx on android/ios) returns a
// purchase receipt to the client. The client POSTs that receipt here so
// the server has a fraud-signal hook AND an audit trail of the attempt.
//
// IMPORTANT â€” these endpoints DO NOT grant the subscription benefit on
// their own. The authoritative grant flow is:
//   â€¢ Google Play â†’ RTDN webhook at POST /api/billing/webhook (this file
//     line 278) which re-fetches the canonical subscription state from
//     the Google Play Developer API (`purchases.subscriptions.get`).
//   â€¢ App Store â†’ App Store Server Notifications (SSN) v2 webhook
//     (TODO: ship in a follow-up bucket alongside the App Store Connect
//     entitlement flow).
//
// Granting on the strength of the client-supplied receipt alone would
// open us to replay / forged-receipt fraud (App Store sandbox receipts
// are well-documented as forgeable). The client receipt is informational.
//
// Both endpoints return 202 Accepted to signal "we'll grant when the
// store confirms server-to-server" without lying about completion.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    // RTDN later. We never store the full token â€” it's token-equivalent
    // material and would broaden the blast radius of a Firestore breach.
    const recordAttempt = async (outcome: string, reason?: string) => {
      try {
        const db = admin.firestore();
        await db.collection('iap_receipt_attempts').add({
          provider: 'google-play',
          userId: uid ?? null,
          productId,
          tierId: tierId ?? null,
          receiptIdHash: receiptId.slice(0, 16) + 'â€¦',
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
        // echo `failure.detail` to the client â€” it carries operator info
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
            // Exhaustiveness guard â€” a new failure reason must land here.
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
          receiptIdHash: receiptId.slice(0, 16) + 'â€¦',
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
      // `receiptId` here is the iOS transactionId â€” StoreKit 2 and the
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// POST /api/billing/webhook/apple â€” App Store Server Notifications v2.
//
// Sprint 27 audit P0 fix H2 â€” closes the iOS entitlement gap. Apple
// posts `{ signedPayload: "<JWS>" }`; we verify the JWS, decode the
// nested transactionInfo / renewalInfo blobs, and dispatch to the
// shared entitlement helper in services/billing/appleSsn.ts.
//
// Mirrors the Google Play RTDN handler at /api/billing/webhook above:
//   â€¢ idempotent on Apple's `notificationUUID` via `processed_apple_ssn`
//     (using the same `withIdempotency` lock-then-complete helper),
//   â€¢ ALWAYS ACK 200 except when the JWS itself fails verification
//     (401) â€” Apple retries on 5xx for ~24h; we suppress retries for
//     anything we've already accepted by writing the lock doc,
//   â€¢ writes `apple_ssn_attempts/{auto}` for every accepted
//     notification with `verified_chain: false` (intermediate mode â€”
//     see the file header in services/billing/appleSsn.ts for the
//     follow-up to ship full Apple Root G3 chain verification).
//
// Why no shared-secret token like the RTDN handler? Apple SSN v2 is
// authenticated via the JWS signature alone â€” Apple's docs explicitly
// recommend AGAINST adding a query-string token because it ends up in
// CDN logs. The cryptographic signature is the auth boundary.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sprint 28 Bucket B3 â€” Zod-gated payload before JWS verify.
// Sprint 29 H17: legacy `typeof signedPayload !== 'string'` guard removed
// â€” Zod schema is the single source of truth for shape.
const appleWebhookSchema = z.object({
  signedPayload: z.string().min(1),
});
billingApiRouter.post('/webhook/apple', validate(appleWebhookSchema), async (req, res) => {
  const { signedPayload } = req.body as { signedPayload: string };

  let verifiedChain = false;
  let payload;
  try {
    const verified = await verifyAndDecodeAppleSsn(signedPayload);
    payload = verified.payload;
    verifiedChain = verified.verifiedChain;
  } catch (err) {
    if (err instanceof AppleSsnVerificationError) {
      // Auth failure â€” never ACK 200 on these. Apple WILL retry,
      // but a forged-JWS replay in a tight loop would be a DoS we
      // want to drop hard.
      logger.warn('apple_ssn_verification_failed', { reason: err.message });
      return res.status(401).json({ error: 'invalid_signature' });
    }
    logger.error('apple_ssn_verify_unexpected', err);
    sentryCapture(err, { endpoint: '/api/billing/webhook/apple', tags: { method: 'POST', phase: 'verify' } });
    return res.status(500).json({ error: 'verify_failed' });
  }

  const db = admin.firestore();

  try {
    const outcome = await withIdempotency(
      db,
      { collection: 'processed_apple_ssn', key: payload.notificationUUID },
      async () => {
        logger.info('apple_ssn_received', {
          notificationType: payload.notificationType,
          subtype: payload.subtype ?? null,
          notificationUUID: payload.notificationUUID,
          // Never log the inner JWTs or appAccountToken â€” both are
          // bearer-equivalent material in the App Store Server API.
        });

        const result = await tracedAsync(
          'billing.webhook.apple',
          {
            notificationType: payload.notificationType ?? null,
            subtype: payload.subtype ?? null,
            verifiedChain,
          },
          () => applyAppleEntitlement({
            payload,
            db: db as any,
          }),
        );

        await db
          .collection('apple_ssn_attempts')
          .add(buildAppleSsnAuditRow({ payload, result, verifiedChain }));

        return { ok: true, action: result.action, userId: result.userId };
      },
    );

    if (outcome.kind === 'in-flight') {
      logger.info('apple_ssn_in_progress_skip', {
        notificationUUID: payload.notificationUUID,
      });
    } else if (outcome.kind === 'stale-retry') {
      logger.warn('apple_ssn_stale_lock_stealing', {
        notificationUUID: payload.notificationUUID,
      });
    }

    // Sprint 28 H18 â€” audit replay vs success for Apple SSN webhooks.
    if (outcome.kind === 'duplicate') {
      await auditServerEvent(req, 'billing.webhook.replay', 'billing', {
        replay: true,
        source: 'apple',
        txn: payload.notificationUUID,
        notificationType: payload.notificationType,
      }).catch(() => {});
    } else if (
      outcome.kind === 'fresh-success' ||
      outcome.kind === 'stale-retry'
    ) {
      await auditServerEvent(req, 'billing.webhook.success', 'billing', {
        source: 'apple',
        txn: payload.notificationUUID,
        notificationType: payload.notificationType,
        outcome: outcome.kind,
      }).catch(() => {});
    }

    // All four outcomes ACK 200 â€” see contract notes in idempotency.ts.
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('apple_ssn_webhook_failed', error, {
      notificationUUID: payload.notificationUUID,
    });
    sentryCapture(error, { endpoint: '/api/billing/webhook/apple', tags: { method: 'POST', notificationUUID: payload.notificationUUID } });
    return res.status(500).json({ error: 'webhook_processing_failed' });
  }
});
