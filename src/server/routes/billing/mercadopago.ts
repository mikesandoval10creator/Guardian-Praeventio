// Praeventio Guard — billing split step 2 (2026-06-11, deuda D3).
//
// MercadoPago (LATAM PE/AR/CO/MX/BR) domain routes, moved VERBATIM from
// `src/server/routes/billing.ts` (handlers untouched — imports only):
//   • Round 15 per-country currency/price constants,
//   • POST /api/billing/checkout/mercadopago  (Round 15 R2),
//   • POST /api/billing/webhook/mercadopago   (IPN, Round 18/19, OIDC+HMAC).

import type { Router } from 'express';
import admin from 'firebase-admin';
import { randomUUID } from 'node:crypto';

import { verifyAuth } from '../../middleware/verifyAuth.js';
import { idempotencyKey } from '../../middleware/idempotencyKey.js';
import { logger } from '../../../utils/logger.js';
// Sprint 22 Bucket AA — request-scoped tracing on the billing dispatch path.
import { tracedAsync } from '../../../services/observability/tracing.js';
import { resolveBillingTier } from './pricing.js';
import { auditServerEvent } from '../../middleware/auditLog.js';
import {
  mercadoPagoAdapter,
  MercadoPagoAdapterError,
  type MercadoPagoCurrencyId,
} from '../../../services/billing/mercadoPagoAdapter.js';
import {
  verifyMpIpnAnyFormat,
  verifyMercadoPagoIpnOidc,
  processMercadoPagoIpn,
} from '../../../services/billing/mercadoPagoIpn.js';
// Sprint 49 D.8.b — DTE auto-issue orchestrator (pure decision). See
// dteAutoIssueOrchestrator.ts header.
import {
  decideDteIssue,
  type DteIssueRequest,
} from '../../../services/dte/dteAutoIssueOrchestrator.js';
import {
  MP_CURRENCY_BY_COUNTRY,
  type LatamCurrency,
} from '../../../services/billing/currency.js';
import { sentryCapture } from './shared.js';

// ────────────────────────────────────────────────────────────────────────────
// Round 15 — MercadoPago checkout (LATAM: PE/AR/CO/MX/BR).
// ────────────────────────────────────────────────────────────────────────────

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

export function registerMercadoPagoRoutes(billingApiRouter: Router): void {
  // POST /api/billing/checkout/mercadopago — Round 15 R2. LATAM checkout
  // (PE/AR/CO/MX/BR). Auth-gated; idempotent at the invoice layer. Round 16
  // will add the matching IPN webhook with OIDC verification similar to
  // RTDN — until then MP payments must be reconciled via /mark-paid (same
  // admin fallback used for transferencia bancaria).
  billingApiRouter.post('/checkout/mercadopago', verifyAuth, idempotencyKey(), async (req, res) => {
    const callerUid = req.user!.uid;
    const callerEmail: string | null = req.user!.email ?? null;

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
        preference = await tracedAsync(
          'billing.checkout.mercadopago',
          { invoiceId, country, currency: expectedCurrency, tierKey: body.tierKey },
          () => mercadoPagoAdapter.createPreference({
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
        // that we don't outright 401 here — MP could be in the middle of
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
      // Sprint 28 H18 — audit success and replay for MP webhooks.
      if (result.idempotencyKind === 'duplicate') {
        await auditServerEvent(req, 'billing.webhook.replay', 'billing', {
          replay: true,
          source: 'mercadopago',
          txn: paymentId ?? null,
          invoiceId: result.invoiceId || null,
        }).then((ok: boolean) => {
          // P0 informe 2026-06-12: auditServerEvent nunca lanza — boolean.
          if (!ok) logger.error('billing_audit_write_failed', new Error('audit_write_failed'), { event: 'billing.webhook.replay', source: 'mercadopago', txn: paymentId ?? null });
        });
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
        }).then((ok: boolean) => {
          if (!ok) logger.error('billing_audit_write_failed', new Error('audit_write_failed'), { event: 'billing.webhook.success', source: 'mercadopago', txn: paymentId ?? null });
        });

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
                    '../../../services/billing/invoice.js'
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
}
