// Praeventio Guard — billing split step 2 (2026-06-11, deuda D3).
//
// Invoice administration routes, moved VERBATIM from
// `src/server/routes/billing.ts` (handlers untouched — imports only):
//   • POST /api/billing/invoice/:id/mark-paid  (admin manual fallback),
//   • GET  /api/billing/invoice/:id            (owner-only status poll).
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
// Sprint 49 D.8.b — DTE auto-issue orchestrator (pure decision). The wire
// here only DECIDES + logs; queue persistence / PSE dispatch lands in
// Sprint 50. See dteAutoIssueOrchestrator.ts header.
import {
  decideDteIssue,
  type DteIssueRequest,
} from '../../../services/dte/dteAutoIssueOrchestrator.js';
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
