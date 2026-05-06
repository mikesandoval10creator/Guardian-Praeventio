// Praeventio Guard — Round 17 R2 Phase 2 split.
//
// Billing endpoints extracted from server.ts. Phase 1 (Round 16 R5) shipped
// admin/health/audit; this phase moves the 6 /api/billing/* routes plus the
// Webpay return handler at /billing/webpay/return.
//
// Mount strategy (in server.ts):
//   • app.use('/api/billing', billingApiRouter)  ← 6 /api/billing/* routes
//   • app.use('/billing',     billingWebpayRouter) ← Webpay return only
//
// Why TWO routers? `/billing/webpay/return` is the URL Transbank redirects
// the cardholder's browser to after card entry. That URL is registered with
// Transbank's commerce config and CANNOT change to `/api/billing/...` without
// a Webpay reissue. Keeping it on its own root-mounted router preserves the
// byte-identical path while still letting the API surface live under
// `/api/billing/`.
//
// Final paths (preserved verbatim — DO NOT change):
//   • POST /api/billing/verify                  (Google Play purchase verify)
//   • POST /api/billing/webhook                 (RTDN, shared-secret + idempotency)
//   • POST /api/billing/checkout                (Webpay/Stripe/manual invoice)
//   • POST /api/billing/checkout/mercadopago    (LATAM, Round 15 R2)
//   • POST /api/billing/invoice/:id/mark-paid   (admin manual fallback)
//   • GET  /api/billing/invoice/:id             (status poll, Round 13)
//   • GET  /billing/webpay/return               (Webpay browser return)
//
// Behavior contract (covered by I3 supertest harness — see
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
import { safeSecretEqual } from '../middleware/safeSecretEqual.js';
// Sprint 28 Bucket B3 — transversal Zod validation factory. See
// src/server/middleware/validate.ts for the contract.
import { validate } from '../middleware/validate.js';
import { invoiceStatusLimiter, googlePlayWebhookLimiter } from '../middleware/limiters.js';
import { logger } from '../../utils/logger.js';
// Sprint 22 Bucket AA — request-scoped tracing on the billing dispatch path.
import { tracedAsync } from '../../services/observability/tracing.js';
import { getErrorTracker } from '../../services/observability/index.js';

// Sentry capture helper — additive to logger.error. Wrapped so observability
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
import { auditServerEvent } from '../middleware/auditLog.js';
import { recordWebpayReturnLatency } from '../../services/billing/webpayMetrics.js';
import {
  mercadoPagoAdapter,
  MercadoPagoAdapterError,
  type MercadoPagoCurrencyId,
} from '../../services/billing/mercadoPagoAdapter.js';
import {
  verifyMercadoPagoIpnSignatureFromBody,
  verifyMercadoPagoIpnOidc,
  processMercadoPagoIpn,
} from '../../services/billing/mercadoPagoIpn.js';
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

// ───────────────────────────────────────────────────────────────────────────
// Google Play Developer API client.
//
// Used by /api/billing/verify (one-shot purchase verify) and the RTDN
// webhook (re-fetch fresh subscription state on each notification). Init
// at module load: lazy reads of GOOGLE_PLAY_SERVICE_ACCOUNT_JSON would race
// the first request. `playAuth=null` is the documented unconfigured state
// → /verify returns 500 with a helpful "not configured" message.
// ───────────────────────────────────────────────────────────────────────────
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

// ───────────────────────────────────────────────────────────────────────────
// Chilean B2B Billing scaffolding (IMP5)
//
// Persistence:
//   Invoices are written to the `invoices/{id}` Firestore collection via the
//   Admin SDK only. firestore.rules treats this collection as default-deny
//   (server-only writes) — clients must NEVER read/write it directly. Do
//   not add a rule for `invoices/{id}` without an explicit threat-model
//   review; a wrong rule there leaks tax data and PII.
//
// Real provider integration is NOT in this commit — `webpayAdapter` and
// `stripeAdapter` throw on every method except `isConfigured()`. See
// BILLING.md for the runbook to wire transbank-sdk + stripe.
// ───────────────────────────────────────────────────────────────────────────

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
  // 10075 * 1.19 = 11989.25 → ceil 11990 (matches tiers.test.ts)
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
// $990/worker incl IVA → 990/1.19 ≈ 832.
const OVERAGE_CLP_PER_WORKER_NET = 832;
const OVERAGE_CLP_PER_PROJECT_NET = 5034; // 5990 / 1.19

const VALID_PAYMENT_METHODS: ReadonlyArray<PaymentMethod> = [
  'webpay', 'stripe', 'manual-transfer',
];
const VALID_CURRENCIES: ReadonlyArray<CurrencyCode> = ['CLP', 'USD'];

// ───────────────────────────────────────────────────────────────────────────
// Round 15 — MercadoPago checkout (LATAM: PE/AR/CO/MX/BR).
// ───────────────────────────────────────────────────────────────────────────

/** Per-country expected currency. The (country, currency) tuple must match
 *  before we'll create a preference — prevents accidental cross-currency
 *  invoicing. */
const MP_VALID_TUPLES: ReadonlySet<string> = new Set(
  Object.entries(MP_CURRENCY_BY_COUNTRY).map(([c, cur]) => `${c}:${cur}`),
);

/** Convert a CLP amount to a per-country MP unit_price using the same
 *  fallback ratios as `BILLING_TIER_FALLBACK`. We use the tier's USD
 *  price as a stable anchor, then apply a rough country multiplier so
 *  the displayed price is a sensible local-currency number. This is
 *  intentionally simple — Round 16 will swap it for per-country pricing
 *  rows on the tier definition. */
const MP_UNIT_PRICE_USD_MULTIPLIER: Record<string, number> = {
  PEN: 3.8, // 1 USD ≈ 3.8 PEN
  ARS: 870, // 1 USD ≈ 870 ARS (volatile — review monthly)
  COP: 4100, // 1 USD ≈ 4100 COP
  MXN: 17.5, // 1 USD ≈ 17.5 MXN
  BRL: 5.0, // 1 USD ≈ 5 BRL
};

// Suppress "unused" warning for the LatamCurrency type re-export above —
// kept in scope so future endpoints in this file can narrow on it
// without re-importing from the currency module.
void (null as unknown as LatamCurrency | null);

// ───────────────────────────────────────────────────────────────────────────
// Routers — see header for the two-router rationale.
// ───────────────────────────────────────────────────────────────────────────
export const billingApiRouter = Router();
export const billingWebpayRouter = Router();

// POST /api/billing/verify — Google Play one-shot verify (subscription or
// in-app product). On success we mirror the order into `transactions` and
// update the user's `subscription` block.
billingApiRouter.post('/verify', verifyAuth, async (req, res) => {
  const { purchaseToken, productId, type } = req.body;
  const uid = (req as any).user.uid;
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

    // Validate productId is a known plan name (whitelist)
    const VALID_PLANS = ['free', 'comite', 'departamento', 'plata', 'oro', 'platino', 'empresarial', 'corporativo', 'ilimitado'];
    const resolvedPlan = VALID_PLANS.includes(productId) ? productId : 'comite';

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

    res.json({ success: true, data });
  } catch (error: any) {
    logger.error('purchase_verification_failed', error, { uid });
    sentryCapture(error, { endpoint: '/api/billing/verify', tags: { method: 'POST', uid } });
    res.status(500).json({
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
        const decodedData = JSON.parse(Buffer.from(message.data, 'base64').toString());
        const { subscriptionNotification } = decodedData;
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

// POST /api/billing/checkout — create invoice + (eventually) redirect URL
// for Webpay/Stripe. CLP must use webpay or manual-transfer; USD must use
// stripe. Until adapters are wired, falls back to 'pending-config'.
billingApiRouter.post('/checkout', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const callerEmail: string | null = (req as any).user.email ?? null;

  try {
    const body = req.body ?? {};

    // Input validation — fail closed. Never trust currency/method from client.
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

    // Compute overage off the tier limits. For now only Comité Paritario
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

    // Adapter call — typed stubs throw, so we fall back to 'pending-config'.
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
            returnUrl: `${process.env.APP_BASE_URL ?? ''}/billing/return`,
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
      // No external provider — admin marks paid via /mark-paid endpoint.
      status = 'awaiting-payment';
    }

    const response: CheckoutResponse = {
      invoiceId: invoice.id,
      invoice: { ...invoice, status: 'pending-payment' },
      paymentUrl,
      status,
    };
    res.json(response);
  } catch (error: any) {
    logger.error('billing_checkout_failed', error, { uid: callerUid });
    sentryCapture(error, { endpoint: '/api/billing/checkout', tags: { method: 'POST', uid: callerUid } });
    res.status(500).json({
      error: 'Checkout failed',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

// POST /api/billing/invoice/:id/mark-paid — admin manual fallback for
// transferencia bancaria. 403 unless caller has admin role; writes a
// matching audit_logs row directly via the Admin SDK.
billingApiRouter.post('/invoice/:id/mark-paid', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const callerEmail: string | null = (req as any).user.email ?? null;
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

    // Mirror /api/audit-log behavior — write directly via Admin SDK so we
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

    res.json({ success: true });
  } catch (error: any) {
    logger.error('billing_mark_paid_failed', error, { uid: callerUid, invoiceId });
    sentryCapture(error, { endpoint: '/api/billing/invoice/:id/mark-paid', tags: { method: 'POST', uid: callerUid, invoiceId } });
    res.status(500).json({
      error: 'Mark-paid failed',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

// GET /api/billing/invoice/:id — read-only status poll for the SPA's
// post-checkout waiting screen. Returns ONLY safe fields (no purchaseToken,
// no internal audit metadata, no payer notes). Authorization model:
//
//   • verifyAuth gates the request to a logged-in user (req.user.uid).
//   • The doc must have been created by the same uid (`createdBy === uid`).
//   • Mismatch → 404 (deliberate: do NOT 403, which would leak existence).
//
// We deliberately do NOT expose: the full lineItems list (already in the
// CheckoutResponse the client already has), webpayToken (bearer-credential),
// webpayAuthCode (PCI-adjacent), createdByEmail (PII duplicated elsewhere),
// or rawResponse fields from the adapter. If Pricing.tsx needs more, add
// fields here narrowly — never spread the entire doc.
billingApiRouter.get('/invoice/:id', verifyAuth, invoiceStatusLimiter, async (req, res) => {
  const callerUid = (req as any).user.uid;
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
    // mismatch returns 404, NOT 403 — this prevents enumeration of
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

// POST /api/billing/checkout/mercadopago — Round 15 R2. LATAM checkout
// (PE/AR/CO/MX/BR). Auth-gated; idempotent at the invoice layer. Round 16
// will add the matching IPN webhook with OIDC verification similar to
// RTDN — until then MP payments must be reconciled via /mark-paid (same
// admin fallback used for transferencia bancaria).
billingApiRouter.post('/checkout/mercadopago', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const callerEmail: string | null = (req as any).user.email ?? null;

  try {
    const body = req.body ?? {};

    // Input validation — fail closed. Never trust currency/country pair
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

    // Load tier from the existing fallback table — same source of
    // truth as the Webpay path.
    const tier = resolveBillingTier(body.tierKey);
    if (!tier) {
      return res.status(400).json({ error: 'Unknown tierKey' });
    }

    // Compute MP unit_price from the tier's USD anchor. Annual cycles
    // get the 12x annual figure (MP supports preference-level recurrence
    // via PreApproval, which is a Round 16 concern — for now we charge
    // the annual lump sum).
    const usdAmount = body.billingCycle === 'annual' ? tier.usdAnual : tier.usdRegular;
    const multiplier = MP_UNIT_PRICE_USD_MULTIPLIER[expectedCurrency] ?? 1;
    // Round to 2 decimals so MP doesn't reject odd float precision.
    const unitPrice = Math.round(usdAmount * multiplier * 100) / 100;

    // Build a minimal invoice doc. We deliberately DO NOT call the
    // shared `buildInvoice()` here — that path is Chile-specific (CLP /
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
      preference = await mercadoPagoAdapter.createPreference({
        items: [
          {
            title: `Praeventio Guard — ${body.tierKey} (${body.billingCycle})`,
            quantity: 1,
            unit_price: unitPrice,
            currency_id: expectedCurrency as MercadoPagoCurrencyId,
          },
        ],
        payer: { email: callerEmail ?? '' },
        back_urls: backUrls,
        notification_url: notificationUrl,
        external_reference: invoiceId,
      });
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
          description: `Praeventio Guard — ${body.tierKey} (${body.billingCycle})`,
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

    // Audit log — mirror the /api/billing/checkout pattern but with the
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

// POST /api/billing/webhook/mercadopago — Round 18 R2 (deferred from R17),
// extended in Round 19 (A9) with OIDC JWT verification.
//
// MercadoPago IPN endpoint. Public route (no verifyAuth) — trust comes from
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
//      ASAP — see the helper definition for the signal we emit on use.
//
// All three failure modes return 401. The body still re-fetches canonical
// payment state from MP via the adapter, idempotent on
// `processed_mp_ipn/{paymentId}`.
//
// MP's production manifest format `ts=<ts>,v1=<hex>` (over
// id+request-id+ts) remains deferred — see the file-level TODO at the
// top of mercadoPagoAdapter.ts.
billingApiRouter.post('/webhook/mercadopago', async (req, res) => {
  const authHeader = req.header('authorization') ?? '';
  const xSignature = req.header('x-signature') ?? '';

  // Tier 1 (preferred): OIDC JWT in `Authorization: Bearer ...`.
  let authenticated = false;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const oidc = await verifyMercadoPagoIpnOidc(authHeader);
    if (oidc.valid) {
      authenticated = true;
    } else {
      // Log the OIDC-side reason for ops, then fall through to HMAC. Note
      // that we don't outright 401 here — MP could be in the middle of
      // rolling out OIDC delivery and a sender that legacily sets BOTH
      // headers should still succeed via HMAC.
      logger.warn('mp_ipn_oidc_failed', { reason: oidc.reason ?? null });
    }
  }

  // Tier 2 (fallback): legacy HMAC over canonical body.
  if (!authenticated) {
    authenticated = verifyMercadoPagoIpnSignatureFromBody(
      req.body ?? {},
      xSignature,
      process.env.MP_IPN_SECRET ?? '',
    );
  }

  if (!authenticated) {
    return res.status(401).send('Invalid signature');
  }

  try {
    const result = await processMercadoPagoIpn(req.body ?? {});
    const paymentId = req.body?.data?.id;
    // Sprint 28 H18 — audit success and replay for MP webhooks.
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

// ───────────────────────────────────────────────────────────────────────────
// Webpay return URL — Transbank redirects the cardholder's browser back here
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
//   absence of any rule in firestore.rules — see header TODO there).
//   We mirror the Google Play RTDN pattern (`processed_pubsub`) so a
//   redelivered token (browser reload, double-tap, eventual-consistency
//   second hit) cannot double-process the commit.
//
//   - 'done'        → replay the original outcome → original redirect URL.
//   - 'in_progress' fresh (<5 min) → another worker is on it; redirect to
//                                   /pricing/success and let the SPA poll.
//   - 'in_progress' stale (>5 min) → assume the original processor died;
//                                   steal the lock and re-run.
//   - absent        → write 'in_progress', commit, then update to 'done'.
//
//   On exception we deliberately do NOT update the doc; the staleness
//   window grants the next redelivery a fresh attempt.
//
// Status-mapping (matches WebpayCommitStatus + Invoice status):
//   AUTHORIZED → invoice 'paid'           → /pricing/success?invoice=...
//   REJECTED   → invoice 'rejected'       → /pricing/failed?invoice=...
//                (NOT 'cancelled' — card decline ≠ user cancellation)
//   FAILED     → invoice stays 'pending-payment' → /pricing/retry?invoice=...
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
// TODO(billing): consider unifying after the next round — risk in this
// commit is too high (would touch the entire payment confirmation
// path; deferring until invoice-replay typing settles).
// ───────────────────────────────────────────────────────────────────────────
billingWebpayRouter.get('/webpay/return', async (req, res) => {
  // Round 13: capture wall-clock at handler entry so we can emit a
  // single `praeventio/webpay/return_latency_ms` histogram observation
  // at every exit. `outcome` is one of {success, failure, invalid}
  // — see src/services/billing/webpayMetrics.ts for label discipline.
  // The label key MUST match the Terraform descriptor (monitoring.tf
  // `webpay_return_latency`) — descriptor labels are immutable.
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
  // `outcome` label (success|failure|invalid). Keep cardinality LOW —
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
        // Sprint 28 H18 — audit webhook replay for Webpay returns.
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
      // eventual consistency" — redirect to /pricing/success and the SPA
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

      // Round 22 — audit fix CRITICAL #2 (DT-02): activar suscripción
      // del usuario tras pago confirmado. Sin esto el invoice quedaba
      // 'paid' pero users/{uid}.subscription.planId nunca cambiaba.
      // Best-effort: no rompe el redirect si la actualización falla
      // (admin tiene /api/billing/invoice/:id/mark-paid como fallback).
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
    } else if (commit.status === 'REJECTED') {
      // Card-side decline. Invoice stays actionable — user may retry with a
      // different card. 'cancelled' is reserved for explicit user/admin
      // cancellation only.
      outcome = 'rejected';
      await invoiceRef.set(
        { status: 'rejected', webpayToken: tokenWs },
        { merge: true },
      );
      // Sprint 20 18th-wave — TM-R02 closure. Mirror the AUTHORIZED audit
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
      // Sprint 20 18th-wave — TM-R02 closure. Same audit-row contract as
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
    // Best-effort — never throws.
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
    // redelivery a fresh attempt — same approach as the RTDN handler.
    logger.error('webpay_return_failed', error, { tokenWs });
    sentryCapture(error, { endpoint: '/billing/webpay/return', tags: { method: 'GET' } });
    recordWebpayReturnLatency({ outcome: 'failure', latencyMs: elapsed() });
    return res.redirect(`/pricing/failed?error=webpay`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /api/billing/khipu/webhook — Khipu IPN endpoint.
//
// Public route (no verifyAuth) — trust comes from the HMAC-SHA256 signature
// on the `X-Khipu-Signature` header (`t=<unix-seconds>,s=<hex>`). Body is
// parsed as RAW so the signature input matches exactly what Khipu signed
// — going through `express.json()` would re-serialise and break the HMAC.
//
// Idempotency: shared `withIdempotency` helper keyed on the Khipu
// `payment_id` (or `notification_id`/`api_request_id` if present), mirroring
// the MercadoPago IPN pattern. The work() block is intentionally minimal:
// after authenticating the producer, we re-fetch canonical state via
// `getPaymentStatus()` (the IPN body is informational only — never trust
// status fields from a webhook payload directly), update the invoice, and
// write an audit log row.
//
// Mounted on the API router (NOT the /billing/webpay/* router) because
// Khipu is the producer and they choose the URL — we control it with our
// own commerce config rather than Transbank's.
// ───────────────────────────────────────────────────────────────────────────
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
          // Re-fetch canonical state — never trust status fields from the
          // webhook body alone (they're informational; the producer might
          // be fooled by a downstream replay).
          const status = await adapter.getPaymentStatus(paymentId);
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
          // 'pending' / 'verifying' → leave invoice as 'pending-payment';
          // a later IPN will fire when the bank confirms.

          return { ok: true as const, status: status.status };
        },
      );

      if (outcome.kind === 'in-flight') {
        logger.info('khipu_ipn_in_progress_skip', { dedupeKey });
      } else if (outcome.kind === 'stale-retry') {
        logger.warn('khipu_ipn_stale_lock_stealing', { dedupeKey });
      }

      // Sprint 28 H18 — audit replay vs success for Khipu webhooks.
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

// ───────────────────────────────────────────────────────────────────────────
// Sprint 21 Ola 6 Bucket T — IAP receipt validation stubs.
//
// The Capacitor IAP plugin (used by Pricing.tsx on android/ios) returns a
// purchase receipt to the client. The client POSTs that receipt here so
// the server has a fraud-signal hook AND an audit trail of the attempt.
//
// IMPORTANT — these endpoints DO NOT grant the subscription benefit on
// their own. The authoritative grant flow is:
//   • Google Play → RTDN webhook at POST /api/billing/webhook (this file
//     line 278) which re-fetches the canonical subscription state from
//     the Google Play Developer API (`purchases.subscriptions.get`).
//   • App Store → App Store Server Notifications (SSN) v2 webhook
//     (TODO: ship in a follow-up bucket alongside the App Store Connect
//     entitlement flow).
//
// Granting on the strength of the client-supplied receipt alone would
// open us to replay / forged-receipt fraud (App Store sandbox receipts
// are well-documented as forgeable). The client receipt is informational.
//
// Both endpoints return 202 Accepted to signal "we'll grant when the
// store confirms server-to-server" without lying about completion.
// ───────────────────────────────────────────────────────────────────────────

billingApiRouter.post(
  '/google-play/validate-receipt',
  verifyAuth,
  async (req, res) => {
    const { productId, tierId, receiptId } = (req.body ?? {}) as {
      productId?: string;
      tierId?: string;
      receiptId?: string;
    };
    const uid = (req as any).user?.uid;

    if (!productId || !receiptId) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    try {
      // TODO: implement receipt validation against Google servers when
      // production secrets ready. The hook point is `playDeveloperApi.
      // purchases.subscriptions.get({ packageName, subscriptionId:
      // productId, token: receiptId })` (same call the RTDN handler
      // makes on each notification). For now we just persist the
      // attempt so ops can correlate with the eventual RTDN.
      const db = admin.firestore();
      await db.collection('iap_receipt_attempts').add({
        provider: 'google-play',
        userId: uid ?? null,
        productId,
        tierId: tierId ?? null,
        receiptIdHash: receiptId.slice(0, 16) + '…',
        // Never store the full receipt — it carries token-equivalent
        // material that could be replayed. The hashing here is a coarse
        // "first 16 chars" preview; ops uses Sentry breadcrumbs for the
        // full signal under access control.
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });

      logger.info('iap_validate_receipt_recorded', {
        provider: 'google-play',
        productId,
        tierId: tierId ?? null,
      });

      return res.status(202).json({
        accepted: true,
        message:
          'Receipt logged. Subscription benefit will activate once the ' +
          'Google Play RTDN webhook confirms the purchase server-to-server.',
      });
    } catch (err) {
      logger.error('iap_validate_receipt_failed', err, {
        provider: 'google-play',
      });
      sentryCapture(err, { endpoint: '/api/billing/google-play/validate-receipt', tags: { method: 'POST', provider: 'google-play' } });
      return res.status(500).json({ error: 'iap_receipt_log_failed' });
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
    const uid = (req as any).user?.uid;

    if (!productId || !receiptId) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    try {
      // TODO: implement receipt validation against Apple servers when
      // production secrets ready. The hook point is the App Store
      // Server API (`/inApps/v1/transactions/{transactionId}` or the
      // legacy `/verifyReceipt` endpoint). Sandbox vs production routing
      // and JWS signature verification (Apple Root CA chain) belong here.
      const db = admin.firestore();
      await db.collection('iap_receipt_attempts').add({
        provider: 'app-store',
        userId: uid ?? null,
        productId,
        tierId: tierId ?? null,
        receiptIdHash: receiptId.slice(0, 16) + '…',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });

      logger.info('iap_validate_receipt_recorded', {
        provider: 'app-store',
        productId,
        tierId: tierId ?? null,
      });

      return res.status(202).json({
        accepted: true,
        message:
          'Receipt logged. Subscription benefit will activate once the ' +
          'App Store Server Notification confirms the purchase server-to-server.',
      });
    } catch (err) {
      logger.error('iap_validate_receipt_failed', err, {
        provider: 'app-store',
      });
      sentryCapture(err, { endpoint: '/api/billing/app-store/validate-receipt', tags: { method: 'POST', provider: 'app-store' } });
      return res.status(500).json({ error: 'iap_receipt_log_failed' });
    }
  },
);

// ───────────────────────────────────────────────────────────────────────────
// POST /api/billing/webhook/apple — App Store Server Notifications v2.
//
// Sprint 27 audit P0 fix H2 — closes the iOS entitlement gap. Apple
// posts `{ signedPayload: "<JWS>" }`; we verify the JWS, decode the
// nested transactionInfo / renewalInfo blobs, and dispatch to the
// shared entitlement helper in services/billing/appleSsn.ts.
//
// Mirrors the Google Play RTDN handler at /api/billing/webhook above:
//   • idempotent on Apple's `notificationUUID` via `processed_apple_ssn`
//     (using the same `withIdempotency` lock-then-complete helper),
//   • ALWAYS ACK 200 except when the JWS itself fails verification
//     (401) — Apple retries on 5xx for ~24h; we suppress retries for
//     anything we've already accepted by writing the lock doc,
//   • writes `apple_ssn_attempts/{auto}` for every accepted
//     notification with `verified_chain: false` (intermediate mode —
//     see the file header in services/billing/appleSsn.ts for the
//     follow-up to ship full Apple Root G3 chain verification).
//
// Why no shared-secret token like the RTDN handler? Apple SSN v2 is
// authenticated via the JWS signature alone — Apple's docs explicitly
// recommend AGAINST adding a query-string token because it ends up in
// CDN logs. The cryptographic signature is the auth boundary.
// ───────────────────────────────────────────────────────────────────────────
// Sprint 28 Bucket B3 — Zod-gated payload before JWS verify.
// Sprint 29 H17: legacy `typeof signedPayload !== 'string'` guard removed
// — Zod schema is the single source of truth for shape.
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
      // Auth failure — never ACK 200 on these. Apple WILL retry,
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
          // Never log the inner JWTs or appAccountToken — both are
          // bearer-equivalent material in the App Store Server API.
        });

        const result = await applyAppleEntitlement({
          payload,
          db: db as any,
        });

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

    // Sprint 28 H18 — audit replay vs success for Apple SSN webhooks.
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

    // All four outcomes ACK 200 — see contract notes in idempotency.ts.
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('apple_ssn_webhook_failed', error, {
      notificationUUID: payload.notificationUUID,
    });
    sentryCapture(error, { endpoint: '/api/billing/webhook/apple', tags: { method: 'POST', notificationUUID: payload.notificationUUID } });
    return res.status(500).json({ error: 'webhook_processing_failed' });
  }
});
