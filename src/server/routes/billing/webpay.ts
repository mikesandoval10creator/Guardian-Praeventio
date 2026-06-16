// Praeventio Guard — billing split step 2 (2026-06-11, deuda D3).
//
// Webpay (Transbank) domain routes, moved VERBATIM from
// `src/server/routes/billing.ts` (handlers untouched — imports only):
//   • POST /api/billing/checkout    (Webpay CL / manual-transfer B2B),
//   • GET  /billing/webpay/return   (Transbank browser return URL).
//
// The return route registers on the SEPARATE root-mounted webpay router —
// see the two-router rationale in `../billing.ts`. The path registered with
// Transbank's commerce config CANNOT change.

import type { Router } from 'express';
import admin from 'firebase-admin';
import { performance } from 'node:perf_hooks';

import { verifyAuth } from '../../middleware/verifyAuth.js';
import { idempotencyKey } from '../../middleware/idempotencyKey.js';
import { logger } from '../../../utils/logger.js';
// Sprint 22 Bucket AA — request-scoped tracing on the billing dispatch path.
import { tracedAsync } from '../../../services/observability/tracing.js';
import { buildInvoice } from '../../../services/billing/invoice.js';
import type {
  CheckoutRequest,
  CheckoutResponse,
} from '../../../services/billing/types.js';
import { resolveBillingTierUf } from './ufPricing.js';
import {
  OVERAGE_CLP_PER_WORKER_NET,
  OVERAGE_CLP_PER_PROJECT_NET,
  VALID_PAYMENT_METHODS,
  VALID_CURRENCIES,
} from './pricing.js';
import {
  webpayAdapter,
  acquireWebpayIdempotencyLock,
  finalizeWebpayIdempotencyLock,
  type WebpayReturnOutcome,
} from '../../../services/billing/webpayAdapter.js';
import { auditServerEvent } from '../../middleware/auditLog.js';
import { recordWebpayReturnLatency } from '../../../services/billing/webpayMetrics.js';
// Sprint 49 D.8.b — DTE auto-issue orchestrator (pure decision). The wire
// here only DECIDES + logs; queue persistence / PSE dispatch lands in
// Sprint 50. NO push directo a SII — provider Bsale/PSE intermedio
// (directiva 3 plan maestro). See dteAutoIssueOrchestrator.ts header.
import {
  decideDteIssue,
  type DteIssueRequest,
} from '../../../services/dte/dteAutoIssueOrchestrator.js';
import {
  normalizeSubscriptionPlanId,
  resolveInvoiceCycle,
  DEFAULT_SUBSCRIPTION_CYCLE,
  type BillingCycle,
} from '../../../services/pricing/subscriptionPlan.js';
import { sentryCapture } from './shared.js';

export function registerWebpayRoutes(
  billingApiRouter: Router,
  billingWebpayRouter: Router,
): void {
  // POST /api/billing/checkout — create invoice + redirect URL for Webpay
  // (Chile) o manual-transfer (B2B enterprise). USD checkout pasa por
  // manual-transfer (Stripe descartado §2.12); LATAM no-Chile vía
  // MercadoPago (endpoint separado `/checkout/mp`).
  billingApiRouter.post('/checkout', verifyAuth, idempotencyKey(), async (req, res) => {
    const callerUid = req.user!.uid;
    const callerEmail: string | null = req.user!.email ?? null;

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

      // §2.12 (Fase C.2): Stripe descartado. CLP usa webpay; USD usa
      // manual-transfer (B2B). LATAM non-CL pasa por endpoint MP separado.
      if (body.currency === 'USD' && body.paymentMethod === 'webpay') {
        return res.status(400).json({ error: 'USD requires manual-transfer' });
      }

      const tier = await resolveBillingTierUf(body.tierId, admin.firestore());
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
              returnUrl: `${process.env.APP_BASE_URL ?? ''}/billing/webpay/return`,
            }),
          );
          paymentUrl = tx.url;
          status = 'awaiting-payment';
        } catch (err) {
          logger.error('webpay_create_failed', err, { invoiceId: invoice.id });
          sentryCapture(err, { endpoint: 'billing.checkout.webpay', tags: { invoiceId: invoice.id } });
        }
      // §2.12 (Fase C.2): branch Stripe removido. MercadoPago vive en su
      // propio endpoint /checkout/mp. IAP nativo usa appleTransactionValidator
      // + googlePlayValidator. manual-transfer es fallback B2B.
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
      await auditServerEvent(req, 'billing.checkout', 'billing', {
        invoiceId: invoice.id,
        tierId: body.tierId,
        paymentMethod: body.paymentMethod,
        currency: body.currency,
        total: invoice.totals.total,
        status,
      });
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

  // ────────────────────────────────────────────────────────────────────────────
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
  //                (NOT 'cancelled' — card decline / user cancellation)
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
  // ────────────────────────────────────────────────────────────────────────────
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

    // Defense-in-depth (2026-06-16): fail CLOSED on its own rather than
    // depending solely on the validate-env boot gate. Without real WEBPAY creds
    // the adapter would commit against the public Transbank integration commerce
    // code — never mark an invoice paid on sandbox/default creds.
    if (!webpayAdapter.isConfigured()) {
      logger.error('webpay_return_unconfigured', {
        detail: 'WEBPAY_COMMERCE_CODE/WEBPAY_API_KEY absent — refusing to commit',
      });
      sentryCapture(new Error('webpay_return_unconfigured'), {
        endpoint: 'billing.webpay.return',
        tags: { stage: 'config-guard' },
      });
      recordWebpayReturnLatency({ outcome: 'failure', latencyMs: elapsed() });
      return res.redirect(302, redirectFor('rejected', null));
    }

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
          }).then((ok: boolean) => {
            // P0 informe 2026-06-12: antes `.catch(() => {})` silenciaba la
            // falla de audit. auditServerEvent nunca lanza — devuelve boolean.
            if (!ok) logger.error('billing_audit_write_failed', new Error('audit_write_failed'), { event: 'billing.webhook.replay', source: 'webpay', txn: tokenWs });
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

        // Round 22 — audit fix CRITICAL #2 (DT-02): activar suscripción
        // del usuario tras pago confirmado. Sin esto el invoice quedaba
        // 'paid' pero users/{uid}.subscription.planId nunca cambiaba.
        // Best-effort: no rompe el redirect si la actualización falla
        // (admin tiene /api/billing/invoice/:id/mark-paid como fallback).
        // Cycle resolved once from server-side invoice state, used for BOTH the
        // subscription write and the audit row. Hoisted so it survives the
        // try-block scope (the audit add below runs even if activation fails).
        let cycle: BillingCycle = DEFAULT_SUBSCRIPTION_CYCLE;
        try {
          const invoiceSnap = await invoiceRef.get();
          const invoiceData = invoiceSnap.data();
          const resolved = resolveInvoiceCycle(invoiceData);
          cycle = resolved.cycle;
          if (resolved.source === 'default' && invoiceData != null) {
            logger.warn('billing_cycle_defaulted', { invoiceId, rail: 'webpay' });
          }
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
                  cycle,
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
          // The invoice read failed → `cycle` is still the DEFAULT, so the audit
          // row below stamps the fallback, not a derived value. Emit a distinct
          // signal so a read blip isn't mistaken for a genuine monthly invoice.
          logger.warn('billing_cycle_unresolved', { invoiceId, rail: 'webpay' });
          sentryCapture(subErr, { endpoint: 'billing.webpay.subscriptionUpdate', tags: { invoiceId } });
        }

        await db.collection('audit_logs').add({
          action: 'billing.webpay-return.authorized',
          module: 'billing',
          details: { invoiceId, amount: commit.amount, authCode: commit.authorizationCode, cycle },
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
                  '../../../services/billing/invoice.js'
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
}
