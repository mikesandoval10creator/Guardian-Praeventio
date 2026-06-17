// Praeventio Guard — billing split step 2 (2026-06-11, deuda D3).
//
// Invoice administration routes, moved VERBATIM from
// `src/server/routes/billing.ts`:
//   • POST /api/billing/invoice/:id/mark-paid  (admin manual fallback),
//   • GET  /api/billing/invoice/:id            (owner-only status poll).
//
// B5/B15 remediation (2026-06-11, "paridad de los 4 rieles"): mark-paid is
// the MANUAL rail (B2B transferencia bancaria). Before this fix it only
// flipped the invoice to 'paid' — the customer got neither the subscription
// tier nor the DTE (boleta/factura) that webpay-return / MP IPN / Khipu IPN
// all deliver. The handler now mirrors the Khipu completed-branch exactly:
// withIdempotency guard, users/{uid}.subscription activation, decideDteIssue
// + tryAutoIssueDte (DTE_AUTO_ISSUE-gated, fail-soft) and — unlike the
// automated rails so far — persistence of transiently-failed emissions to
// `dte_issue_queue` for the cron drain (runDteIssueQueueDrain).
//
// Note: there is no standalone "tier change" route — entitlement updates
// happen inside the provider webhooks (Webpay return / RTDN / Apple SSN),
// and tier pricing constants live in `./pricing.ts`.

import type { Router } from 'express';
import admin from 'firebase-admin';

import { verifyAuth } from '../../middleware/verifyAuth.js';
import { invoiceStatusLimiter } from '../../middleware/limiters.js';
import { logger } from '../../../utils/logger.js';
import { isAdminRole } from '../../../types/roles.js';
import {
  decideDteIssue,
  type DteIssueRequest,
} from '../../../services/dte/dteAutoIssueOrchestrator.js';
import { withIdempotency } from '../../../services/billing/idempotency.js';
import { normalizeSubscriptionPlanId, resolveInvoiceCycle } from '../../../services/pricing/subscriptionPlan.js';
import {
  buildDteQueueInvoicePayload,
  enqueueDteIssueJob,
  shouldQueueDteRetry,
} from '../../../services/dte/dteIssueQueueStore.js';
import type { Invoice } from '../../../services/billing/types.js';
import { sentryCapture } from './shared.js';

export function registerInvoiceRoutes(billingApiRouter: Router): void {
  // POST /api/billing/invoice/:id/mark-paid — admin manual fallback for
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

      // B5/B15 — withIdempotency (`processed_markpaid/{invoiceId}`) closes
      // the race two concurrent admin clicks would open: the status check
      // above is read-then-write, so without the lock both requests could
      // pass it and double-activate / double-emit. Same lock-then-complete
      // helper as the Khipu/MP/RTDN rails.
      const outcome = await withIdempotency(
        db,
        { collection: 'processed_markpaid', key: invoiceId },
        async () => {
          const paidAtIso = new Date().toISOString();
          await ref.update({
            status: 'paid',
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            paidBy: callerUid,
            paidByEmail: callerEmail,
            paymentSource: 'manual',
          });

          // Subscription activation — completion parity with the automated
          // rails (webpay return / MP IPN / khipu IPN). Best-effort: a
          // failure here is logged + escalated but never un-pays the
          // invoice; the outcome is stamped into the audit row below.
          const lineItems = Array.isArray(current?.lineItems) ? current.lineItems : [];
          const tierId: string | null = lineItems[0]?.tierId ?? current?.tierId ?? null;
          const ownerUid: string | null = current?.createdBy ?? null;
          const { cycle, source: cycleSource } = resolveInvoiceCycle(current);
          if (cycleSource === 'default' && current != null) {
            logger.warn('billing_cycle_defaulted', { invoiceId, rail: 'mark-paid' });
          }
          let subscriptionActivation: 'activated' | 'missing-data' | 'failed' = 'missing-data';
          try {
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
                    paymentMethod: 'manual',
                    cycle,
                  },
                },
                { merge: true },
              );
              subscriptionActivation = 'activated';
              logger.info('mark_paid_subscription_activated', { uid: ownerUid, tierId, invoiceId });
            } else {
              logger.warn('mark_paid_subscription_missing_data', { ownerUid, tierId, invoiceId });
            }
          } catch (subErr) {
            subscriptionActivation = 'failed';
            logger.error('mark_paid_subscription_update_failed', subErr as Error, { invoiceId });
            sentryCapture(subErr, { endpoint: 'billing.markPaid.subscriptionUpdate', tags: { invoiceId } });
          }

          // DTE auto-issue — same wire as webpay return / MP IPN / khipu
          // IPN: decideDteIssue (pure) + tryAutoIssueDte (respects the
          // DTE_AUTO_ISSUE env gate; fail-soft, never blocks the response).
          // NEW vs. the automated rails: a transient PSE failure persists
          // the job to `dte_issue_queue` so the cron drain retries it —
          // the DTE is no longer silently lost when Bsale is down.
          const dteOutcome: Record<string, unknown> = { decided: false };
          try {
            const payerInfo = (current?.payerInfo ?? {}) as DteIssueRequest['payerInfo'];
            const planCode: string = tierId ?? 'unknown';
            if (ownerUid) {
              const decision = decideDteIssue({
                paymentId: `manual:${invoiceId}`,
                tenantId: ownerUid,
                payerInfo,
                amountClp: typeof current?.totals?.total === 'number' ? current.totals.total : 0,
                planCode,
                paymentGateway: 'manual',
                paidAt: paidAtIso,
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
              dteOutcome.decided = true;
              dteOutcome.shouldIssue = decision.shouldIssue;
              dteOutcome.documentKind = decision.documentKind;
              dteOutcome.reason = decision.reason;
              dteOutcome.idempotencyKey = decision.idempotencyKey;
              if (decision.shouldIssue && current) {
                const invoicePayload = buildDteQueueInvoicePayload(invoiceId, current, paidAtIso);
                try {
                  const { tryAutoIssueDte } = await import(
                    '../../../services/billing/invoice.js'
                  );
                  const invoiceForDte = {
                    ...current,
                    id: invoiceId,
                    status: 'paid' as const,
                    paidAt: paidAtIso,
                  } as unknown as Invoice;
                  const issueResult = await tryAutoIssueDte(invoiceForDte);
                  logger.info('dte_autoissue_result', {
                    source: 'mark-paid',
                    invoiceId,
                    ownerUid,
                    ok: issueResult.ok,
                    skipped: issueResult.skipped ?? null,
                    folio: issueResult.result?.folio ?? null,
                    errorMessage: issueResult.errorMessage ?? null,
                  });
                  dteOutcome.issued = issueResult.ok;
                  dteOutcome.skipped = issueResult.skipped ?? null;
                  dteOutcome.folio = issueResult.result?.folio ?? null;
                  // Deliberate-skip reasons ('disabled' gate, 'usd',
                  // 'invalid-status') are NOT queued. Transient failures
                  // (adapter error) and 'no-adapter' (credential outage) are.
                  if (shouldQueueDteRetry(issueResult)) {
                    const queued = await enqueueDteIssueJob(db, decision, invoicePayload, 'mark-paid');
                    dteOutcome.queued = queued;
                    logger.warn('dte_autoissue_queued_for_retry', { invoiceId, queued });
                  }
                } catch (issueErr) {
                  logger.error('dte_autoissue_invoke_failed', issueErr as Error, {
                    source: 'mark-paid',
                    invoiceId,
                  });
                  sentryCapture(issueErr, {
                    endpoint: 'billing.markPaid.dteAutoIssue.invoke',
                    tags: { invoiceId },
                  });
                  try {
                    const queued = await enqueueDteIssueJob(db, decision, invoicePayload, 'mark-paid');
                    dteOutcome.queued = queued;
                  } catch (queueErr) {
                    logger.error('dte_queue_enqueue_failed', queueErr as Error, { invoiceId });
                    sentryCapture(queueErr, { endpoint: 'billing.markPaid.dteQueue', tags: { invoiceId } });
                  }
                }
              }
            }
          } catch (dteErr) {
            logger.error('dte_autoissue_decision_failed', dteErr as Error, { invoiceId });
            sentryCapture(dteErr, { endpoint: 'billing.markPaid.dteAutoIssue', tags: { invoiceId } });
          }

          // Mirror /api/audit-log behavior — write directly via Admin SDK so
          // we stamp the same fields without an extra HTTP hop. Identity
          // comes from the VERIFIED token (callerUid/callerEmail), never the
          // body. Awaited per CLAUDE.md #14; failure is severe but must not
          // fail the user-facing action.
          try {
            await db.collection('audit_logs').add({
              action: 'billing.mark-paid',
              module: 'billing',
              details: {
                invoiceId,
                total: current?.totals?.total,
                currency: current?.totals?.currency,
                subscriptionActivation,
                cycle,
                ownerUid,
                tierId,
                dte: dteOutcome,
              },
              userId: callerUid,
              userEmail: callerEmail,
              projectId: null,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              ip: req.ip ?? null,
              userAgent: req.header('user-agent') ?? null,
            });
          } catch (auditErr) {
            logger.error('audit_event_failed', auditErr as Error, { invoiceId, action: 'billing.mark-paid' });
            sentryCapture(auditErr, { endpoint: 'billing.markPaid.audit', tags: { invoiceId } });
          }

          return { subscriptionActivation, dte: dteOutcome };
        },
      );

      if (outcome.kind === 'in-flight') {
        // Another admin's mark-paid is mid-flight — refuse instead of
        // double-activating; the client can re-poll the invoice status.
        return res.status(409).json({ error: 'Mark-paid already in progress' });
      }
      if (outcome.kind === 'duplicate') {
        // Defensive: lock says done but the status check above missed it
        // (e.g. invoice update lagged). Same shape as the alreadyPaid path.
        return res.json({ success: true, alreadyPaid: true });
      }
      return res.json({
        success: true,
        subscriptionActivation: outcome.result.subscriptionActivation,
      });
    } catch (error: any) {
      logger.error('billing_mark_paid_failed', error, { uid: callerUid, invoiceId });
      sentryCapture(error, { endpoint: '/api/billing/invoice/:id/mark-paid', tags: { method: 'POST', uid: callerUid, invoiceId } });
      return res.status(500).json({
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
}
