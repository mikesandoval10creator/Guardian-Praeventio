// Praeventio Guard — billing split step 2 (2026-06-11, deuda D3).
//
// Khipu (CL transferencia bancaria) domain route, moved VERBATIM from
// `src/server/routes/billing.ts` (handler untouched — imports only):
//   • POST /api/billing/khipu/webhook (IPN, HMAC-SHA256 + idempotency).

import express, { type Router } from 'express';
import admin from 'firebase-admin';

import { logger } from '../../../utils/logger.js';
// Sprint 22 Bucket AA — request-scoped tracing on the billing dispatch path.
import { tracedAsync } from '../../../services/observability/tracing.js';
import { KhipuAdapter } from '../../../services/billing/khipuAdapter.js';
import { withIdempotency } from '../../../services/billing/idempotency.js';
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
}
