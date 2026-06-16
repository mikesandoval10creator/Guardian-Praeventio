// Praeventio Guard — billing split step 2 (2026-06-11, deuda D3).
//
// Khipu (CL transferencia bancaria) domain routes:
//   • POST /api/billing/khipu/webhook (IPN, HMAC-SHA256 + idempotency) —
//     moved VERBATIM from `src/server/routes/billing.ts`; completed
//     2026-06-11 ("khipu cableado") with subscription activation + DTE
//     auto-issue, mirroring the Webpay return / MP IPN paths.
//   • POST /api/billing/khipu/checkout (2026-06-11, "khipu cableado") —
//     creates the Khipu payment for a subscription checkout. This was the
//     missing half: adapter + webhook existed but nothing CREATED payments.

import express, { type Router } from 'express';
import admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';

import { logger } from '../../../utils/logger.js';
// Sprint 22 Bucket AA — request-scoped tracing on the billing dispatch path.
import { tracedAsync } from '../../../services/observability/tracing.js';
import { verifyAuth } from '../../middleware/verifyAuth.js';
import { idempotencyKey } from '../../middleware/idempotencyKey.js';
import {
  KhipuAdapter,
  KhipuAdapterError,
} from '../../../services/billing/khipuAdapter.js';
import { withIdempotency } from '../../../services/billing/idempotency.js';
import { calculateInvoiceTotals } from '../../../services/billing/invoice.js';
import type { Invoice, InvoiceLineItem } from '../../../services/billing/types.js';
import { resolveBillingTier } from './pricing.js';
import { resolveBillingTierUf } from './ufPricing.js';
import {
  normalizeSubscriptionPlanId,
  resolveInvoiceCycle,
  DEFAULT_SUBSCRIPTION_CYCLE,
  type BillingCycle,
} from '../../../services/pricing/subscriptionPlan.js';
// DTE auto-issue orchestrator (pure decision) — same wire as webpay/MP.
import {
  decideDteIssue,
  type DteIssueRequest,
} from '../../../services/dte/dteAutoIssueOrchestrator.js';
import { auditServerEvent } from '../../middleware/auditLog.js';
import { sentryCapture } from './shared.js';

export function registerKhipuRoutes(billingApiRouter: Router): void {
  // ──────────────────────────────────────────────────────────────────────────
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
  // ──────────────────────────────────────────────────────────────────────────
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
              // Resolve the billing cycle from server-side invoice state for
              // the audit row (best-effort + own try so a read blip never
              // breaks the IPN ack); reused for the subscription write below.
              let cycle: BillingCycle = DEFAULT_SUBSCRIPTION_CYCLE;
              try {
                const cycleSnap = await invoiceRef.get();
                const resolved = resolveInvoiceCycle(cycleSnap.data());
                cycle = resolved.cycle;
                if (resolved.source === 'default' && cycleSnap.exists) {
                  logger.warn('billing_cycle_defaulted', { invoiceId, rail: 'khipu' });
                }
              } catch (cycleErr) {
                logger.warn('khipu_ipn_cycle_resolve_failed', {
                  invoiceId,
                  err: cycleErr instanceof Error ? cycleErr.message : String(cycleErr),
                });
              }

              await db.collection('audit_logs').add({
                action: 'billing.khipu-ipn.completed',
                module: 'billing',
                details: { invoiceId, amount: status.amount, paymentId, cycle },
                userId: null,
                userEmail: null,
                projectId: null,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                ip: req.ip ?? null,
                userAgent: req.header('user-agent') ?? null,
              });

              // 2026-06-11 (khipu cableado) — completion parity with the
              // other AUTOMATED rails: activate users/{uid}.subscription
              // (same shape as webpay return DT-02 / MP IPN DT-03). Without
              // this, the invoice flipped to 'paid' but the entitlement
              // never changed. Best-effort: never breaks the IPN ack; admin
              // keeps /mark-paid as fallback. Runs INSIDE withIdempotency,
              // so a replayed IPN cannot re-activate.
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
                        paymentMethod: 'khipu',
                        cycle,
                      },
                    },
                    { merge: true },
                  );
                  logger.info('khipu_ipn_subscription_activated', { uid: ownerUid, tierId, invoiceId });
                } else {
                  logger.warn('khipu_ipn_subscription_missing_data', { ownerUid, tierId, invoiceId });
                }

                // DTE auto-issue — same wire as webpay return / MP IPN:
                // decideDteIssue (pure) + tryAutoIssueDte (respects the
                // DTE_AUTO_ISSUE env gate; fail-soft, never blocks the ack).
                if (ownerUid) {
                  const payerInfo = (invoiceData?.payerInfo ?? {}) as DteIssueRequest['payerInfo'];
                  const planCode: string =
                    lineItems[0]?.tierId ?? invoiceData?.tierId ?? 'unknown';
                  const decision = decideDteIssue({
                    paymentId,
                    tenantId: ownerUid,
                    payerInfo,
                    amountClp: typeof status.amount === 'number' ? status.amount : 0,
                    planCode,
                    paymentGateway: 'khipu',
                    paidAt: new Date().toISOString(),
                  });
                  logger.info('dte_autoissue_decision', {
                    source: 'khipu-ipn',
                    invoiceId,
                    ownerUid,
                    shouldIssue: decision.shouldIssue,
                    documentKind: decision.documentKind,
                    reason: decision.reason,
                    idempotencyKey: decision.idempotencyKey,
                  });
                  if (decision.shouldIssue && invoiceData) {
                    try {
                      const { tryAutoIssueDte } = await import(
                        '../../../services/billing/invoice.js'
                      );
                      // Firestore data persisted by our own checkout handler
                      // already carries the Invoice shape; re-hydrate status
                      // to 'paid' in case the snapshot lags the set() above.
                      const invoiceForDte = {
                        ...invoiceData,
                        id: invoiceId,
                        status: 'paid' as const,
                        paidAt: new Date().toISOString(),
                      } as unknown as Invoice;
                      const issueResult = await tryAutoIssueDte(invoiceForDte);
                      logger.info('dte_autoissue_result', {
                        source: 'khipu-ipn',
                        invoiceId,
                        ownerUid,
                        ok: issueResult.ok,
                        skipped: issueResult.skipped ?? null,
                        folio: issueResult.result?.folio ?? null,
                        errorMessage: issueResult.errorMessage ?? null,
                      });
                    } catch (issueErr) {
                      logger.error('dte_autoissue_invoke_failed', issueErr as Error, {
                        source: 'khipu-ipn',
                        invoiceId,
                      });
                      sentryCapture(issueErr, {
                        endpoint: 'billing.khipu.dteAutoIssue.invoke',
                        tags: { invoiceId },
                      });
                    }
                  }
                }
              } catch (subErr) {
                logger.error('khipu_ipn_subscription_update_failed', subErr as Error, { invoiceId });
                sentryCapture(subErr, { endpoint: 'billing.khipu.subscriptionUpdate', tags: { invoiceId } });
              }
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
          }).then((ok: boolean) => {
            // P0 informe 2026-06-12: auditServerEvent nunca lanza — boolean.
            if (!ok) logger.error('billing_audit_write_failed', new Error('audit_write_failed'), { event: 'billing.webhook.replay', source: 'khipu', txn: dedupeKey });
          });
        } else if (
          outcome.kind === 'fresh-success' ||
          outcome.kind === 'stale-retry'
        ) {
          await auditServerEvent(req, 'billing.webhook.success', 'billing', {
            source: 'khipu',
            txn: dedupeKey,
            paymentId,
            outcome: outcome.kind,
          }).then((ok: boolean) => {
            if (!ok) logger.error('billing_audit_write_failed', new Error('audit_write_failed'), { event: 'billing.webhook.success', source: 'khipu', txn: dedupeKey });
          });
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

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/billing/khipu/checkout — create a Khipu bank-transfer payment
  // for a subscription plan (CL, CLP only).
  //
  // Auth-gated (verifyAuth) + idempotency-key middleware, mirroring the
  // Webpay `/checkout` and MP `/checkout/mercadopago` siblings. The body
  // carries ONLY { planId, cycle? } — amount and currency are resolved
  // SERVER-side from the canonical tier table (never trust a client amount).
  //
  // Correlation contract with the webhook below: we pass the invoice id as
  // Khipu `transaction_id` (buyOrder), so `getPaymentStatus().buyOrder`
  // resolves back to `invoices/{invoiceId}` on IPN delivery.
  //
  // Rule #13 (anti-stub): without real KHIPU_* credentials the rail answers
  // an honest 503 instead of silently creating sandbox payments.
  // ──────────────────────────────────────────────────────────────────────────
  billingApiRouter.post('/khipu/checkout', verifyAuth, idempotencyKey(), async (req, res) => {
    const callerUid = req.user!.uid;
    const callerEmail: string | null = req.user!.email ?? null;

    try {
      const body = req.body ?? {};

      // Input validation — fail closed.
      if (typeof body.planId !== 'string' || body.planId.length === 0 || body.planId.length > 64) {
        return res.status(400).json({ error: 'Invalid planId' });
      }
      // Fail-closed like the webpay/mercadopago siblings: a missing/invalid
      // cycle is rejected (the web client always sends it) rather than silently
      // defaulting to monthly — which would mis-bill an intended annual purchase.
      if (body.cycle !== 'monthly' && body.cycle !== 'annual') {
        return res.status(400).json({ error: 'Invalid cycle' });
      }
      const cycle: 'monthly' | 'annual' = body.cycle;
      // Canonical plan check: the tier must exist in the pricing table AND
      // normalize to a subscription plan id (src/services/pricing/).
      const tier = await resolveBillingTierUf(body.planId, admin.firestore());
      const planId = normalizeSubscriptionPlanId(body.planId);
      if (!tier || !planId) {
        return res.status(400).json({ error: 'Unknown planId' });
      }

      const adapter = KhipuAdapter.fromEnv();
      if (!adapter.isConfigured()) {
        // Honest unavailability (rule #13). Copy is user-facing → es-CL.
        return res.status(503).json({
          error:
            'Khipu no está configurado en este entorno. Usa otro medio de pago o contacta a contacto@praeventio.net.',
        });
      }

      // SERVER-computed amount: net CLP from the canonical tier table, IVA
      // applied with the same ceil rule as every other CLP invoice.
      const netAmount = cycle === 'annual' ? tier.clpAnual : tier.clpRegular;
      const lineItems: InvoiceLineItem[] = [
        {
          tierId: body.planId,
          description: `Suscripción ${body.planId} (${cycle})`,
          quantity: 1,
          unitAmount: netAmount,
          currency: 'CLP',
        },
      ];
      const totals = calculateInvoiceTotals(lineItems, true);

      const invoiceId = `inv_khipu_${Date.now()}_${randomUUID()}`;
      const baseUrl = process.env.APP_BASE_URL ?? '';

      let payment: { paymentId: string; paymentUrl: string; expiresAt: string };
      try {
        payment = await tracedAsync(
          'billing.checkout.khipu',
          { invoiceId, planId: body.planId, cycle, amount: totals.total },
          () =>
            adapter.createPayment({
              buyOrder: invoiceId,
              sessionId: callerUid,
              amount: totals.total,
              currency: 'CLP',
              // Subject is shown to the payer in the Khipu UI → es-CL.
              subject: `Praeventio Guard — Suscripción ${body.planId} (${cycle === 'annual' ? 'anual' : 'mensual'})`,
              returnUrl: `${baseUrl}/pricing/success?invoice=${encodeURIComponent(invoiceId)}`,
              cancelUrl: `${baseUrl}/pricing/failed?invoice=${encodeURIComponent(invoiceId)}`,
              notifyUrl: `${baseUrl}/api/billing/khipu/webhook`,
            }),
        );
      } catch (err) {
        logger.error('khipu_create_failed', err, { invoiceId, planId: body.planId });
        sentryCapture(err, { endpoint: 'billing.checkout.khipu', tags: { invoiceId } });
        if (err instanceof KhipuAdapterError) {
          // 502: upstream failed; never leak the adapter error message.
          return res.status(502).json({ error: 'Khipu payment creation failed' });
        }
        throw err;
      }

      // Pending invoice the IPN webhook correlates via buyOrder === invoiceId.
      // Same collection/shape as the Webpay + MP pending records.
      const db = admin.firestore();
      await db.collection('invoices').doc(invoiceId).set({
        id: invoiceId,
        status: 'pending-payment',
        paymentMethod: 'khipu',
        cycle,
        khipuPaymentId: payment.paymentId,
        cliente: {
          nombre: callerEmail ?? 'Cliente Praeventio',
          email: callerEmail ?? '',
        },
        lineItems,
        totals,
        issuedAt: new Date().toISOString(),
        createdBy: callerUid,
        createdByEmail: callerEmail,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Audit row — identity stamped from the verified token, mirroring
      // `billing.mercadopago.preference.created` so dashboards can split the
      // funnel by payment rail.
      await db.collection('audit_logs').add({
        action: 'billing.khipu.payment.created',
        module: 'billing',
        details: {
          invoiceId,
          paymentId: payment.paymentId,
          planId: body.planId,
          cycle,
          currency: 'CLP',
          amount: totals.total,
        },
        userId: callerUid,
        userEmail: callerEmail,
        projectId: null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });

      return res.json({
        invoiceId,
        paymentId: payment.paymentId,
        paymentUrl: payment.paymentUrl,
        expiresAt: payment.expiresAt,
      });
    } catch (error: any) {
      logger.error('billing_khipu_checkout_failed', error, { uid: callerUid });
      sentryCapture(error, { endpoint: '/api/billing/khipu/checkout', tags: { method: 'POST', uid: callerUid } });
      return res.status(500).json({
        error: 'Khipu checkout failed',
        details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
      });
    }
  });

}
