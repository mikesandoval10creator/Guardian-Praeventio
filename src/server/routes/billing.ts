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

import { Router } from 'express';
import admin from 'firebase-admin';
import { performance } from 'node:perf_hooks';
import { google } from 'googleapis';

import { verifyAuth } from '../middleware/verifyAuth.js';
import { safeSecretEqual } from '../middleware/safeSecretEqual.js';
import { invoiceStatusLimiter } from '../middleware/limiters.js';
import { logger } from '../../utils/logger.js';
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
import { stripeAdapter } from '../../services/billing/stripeAdapter.js';
import { withIdempotency } from '../../services/billing/idempotency.js';
import { recordWebpayReturnLatency } from '../../services/billing/webpayMetrics.js';
import {
  mercadoPagoAdapter,
  MercadoPagoAdapterError,
  type MercadoPagoCurrencyId,
} from '../../services/billing/mercadoPagoAdapter.js';
import {
  verifyMercadoPagoIpnSignatureFromBody,
  processMercadoPagoIpn,
} from '../../services/billing/mercadoPagoIpn.js';
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
    console.log('Google Play Developer API client initialized.');
  } catch (error) {
    console.error('Failed to initialize Google Play API client:', error);
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
billingApiRouter.post('/webhook', async (req, res) => {
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

    // All four outcomes ACK 200 to suppress Pub/Sub redelivery — see
    // contract notes in idempotency.ts.
    return res.status(200).send('OK');
  } catch (error) {
    // Deliberate: withIdempotency leaves the doc as 'in_progress' on a
    // work() exception. The staleness window will grant a future
    // redelivery a fresh attempt.
    logger.error('rtdn_webhook_failed', error);
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
        const tx = await webpayAdapter.createTransaction({
          buyOrder: invoice.id.slice(0, 26),
          sessionId: callerUid,
          amount: invoice.totals.total,
          returnUrl: `${process.env.APP_BASE_URL ?? ''}/billing/return`,
        });
        paymentUrl = tx.url;
        status = 'awaiting-payment';
      } catch (err) {
        logger.error('webpay_create_failed', err, { invoiceId: invoice.id });
      }
    } else if (body.paymentMethod === 'stripe' && stripeAdapter.isConfigured()) {
      try {
        const session = await stripeAdapter.createCheckoutSession({
          invoiceId: invoice.id,
          priceId: process.env[`STRIPE_PRICE_${body.tierId.toUpperCase().replace(/-/g, '_')}`] ?? '',
          quantity: 1,
          customerEmail: cliente.email,
          successUrl: `${process.env.APP_BASE_URL ?? ''}/billing/success?invoice=${invoice.id}`,
          cancelUrl: `${process.env.APP_BASE_URL ?? ''}/billing/cancel?invoice=${invoice.id}`,
          metadata: { invoiceId: invoice.id, tierId: body.tierId },
        });
        paymentUrl = session.url;
        status = 'awaiting-payment';
      } catch (err) {
        logger.error('stripe_create_failed', err, { invoiceId: invoice.id });
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
    const invoiceId = `inv_mp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

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
    return res.status(500).json({
      error: 'MercadoPago checkout failed',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

// POST /api/billing/webhook/mercadopago — Round 18 R2 (deferred from R17).
//
// MercadoPago IPN endpoint. Public route (no verifyAuth) — trust comes from
// the HMAC-SHA256 signature header `x-signature` validated against the
// MP_IPN_SECRET env var. Body re-fetches the canonical payment state from
// MP via the adapter, then maps to our invoice outcome and updates the doc.
// Idempotent on `processed_mp_ipn/{paymentId}` so MP retries don't double-
// process.
//
// Round 18 R6 (R6→R17 MEDIUM #2): the signing input is now the RFC 8785
// canonical-JSON form of the parsed body (sorted keys, no whitespace,
// shortest numeric form). Producers MUST canonicalise before HMACing —
// `verifyMercadoPagoIpnSignatureFromBody` does this internally on the
// verifier side. `LEGACY_HMAC_FALLBACK=1` env flag opens a one-shot
// `JSON.stringify` rollback path documented at the helper definition.
//
// MP's production manifest format `ts=<ts>,v1=<hex>` (over
// id+request-id+ts) remains deferred — see the file-level TODO at the
// top of mercadoPagoAdapter.ts.
billingApiRouter.post('/webhook/mercadopago', async (req, res) => {
  const signature = req.header('x-signature') ?? '';
  const ok = verifyMercadoPagoIpnSignatureFromBody(
    req.body ?? {},
    signature,
    process.env.MP_IPN_SECRET ?? '',
  );
  if (!ok) {
    return res.status(401).send('Invalid signature');
  }

  try {
    const result = await processMercadoPagoIpn(req.body ?? {});
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    logger.error('mp_ipn_processing_failed', err as Error, {
      paymentId: req.body?.data?.id,
    });
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
    } else {
      // FAILED (-96/-97/-98 or malformed). Transient. Keep status
      // 'pending-payment' so the user can retry the same card.
      outcome = 'failed';
      await invoiceRef.set(
        { status: 'pending-payment', webpayToken: tokenWs },
        { merge: true },
      );
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
    recordWebpayReturnLatency({ outcome: 'failure', latencyMs: elapsed() });
    return res.redirect(`/pricing/failed?error=webpay`);
  }
});
