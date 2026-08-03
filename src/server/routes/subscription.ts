// Praeventio Guard — Round 22 (audit fix CRITICAL #1):
// /api/subscription/upgrade endpoint con verificación de pago.
//
// Cierra la brecha de escalada de privilegios documentada en el audit
// AUDITORIA_GUARDIAN_PRAEVENTIO.md (DT-01 / DT-05): el contexto
// `SubscriptionContext.upgradePlan()` escribía `users/{uid}.subscription.planId`
// directamente vía cliente SDK sin verificar pago. Cualquier usuario
// autenticado podía auto-asignarse el plan Ilimitado (â‰ˆ $5M CLP/mes).
//
// Esta ruta es la ÃšNICA forma legítima de promover un plan desde el
// cliente. Verifica que existe un invoice `status: 'paid'` propiedad del
// caller con un `lineItems[].tierId` o `tierId` que coincida con el plan
// solicitado. Si no, 403. Si sí, actualiza vía Admin SDK (que bypassa
// las rules del cliente) y emite audit log.
//
// El back-end de Webpay (`billing.ts`) y el IPN de MercadoPago
// (`mercadoPagoIpn.ts`) actualizan la suscripción automáticamente al
// confirmar el pago — este endpoint es el fallback para cuando el SPA
// quiere reflejar el upgrade en la UI inmediatamente, o para flujos
// manuales donde un admin marcó el invoice como paid vía
// `/api/billing/invoice/:id/mark-paid`.

import { Router } from "express";
import admin from "firebase-admin";
import { verifyAuth } from "../middleware/verifyAuth.js";
import { auditServerEvent } from "../middleware/auditLog.js";
import { captureRouteError } from "../middleware/captureRouteError.js";
import { logger } from "../../utils/logger.js";
import {
  SUBSCRIPTION_PLANS,
  isSubscriptionPlan,
  normalizeSubscriptionPlanId,
  subscriptionPlanMatchesPaidTier,
  resolveInvoiceCycle,
} from "../../services/pricing/subscriptionPlan.js";
import { normalizeSubscriptionProvider } from "../../services/pricing/subscriptionEntitlement.js";

export const subscriptionRouter = Router();

/**
 * Período de vigencia que una factura paid representa. Una factura solo
 * reactiva el plan dentro del período que compró: [referencia, referencia +
 * duración(cycle)]. Fuera de él está vencida y NO concede un período nuevo.
 *
 * - Referencia temporal: `paidAtIso` (lo escribe mark-paid) o `issuedAt`
 *   (buildInvoice). Sin referencia parseable → `null` (no verificable).
 * - Duración: annual = 365d, monthly (default) = 30d.
 *
 * P0 39baa66d-8182: antes, /upgrade aceptaba CUALQUIER invoice paid
 * histórico — una factura de hace un año reactivaba el plan indefinidamente.
 */
export function invoicePeriodExpiredMs(
  invoiceData: Record<string, unknown> | null | undefined,
): number | null {
  if (!invoiceData) return null;
  const referenceIso =
    typeof invoiceData.paidAtIso === 'string'
      ? invoiceData.paidAtIso
      : typeof invoiceData.issuedAt === 'string'
        ? invoiceData.issuedAt
        : null;
  if (!referenceIso || !Number.isFinite(Date.parse(referenceIso))) return null;
  const durationMs =
    invoiceData.cycle === 'annual' ? 365 * 24 * 3600_000 : 30 * 24 * 3600_000;
  return Date.parse(referenceIso) + durationMs;
}

/** Error interno — la tx de consumo detectó una factura ya consumida. */
class InvoiceConsumedError extends Error {
  constructor() {
    super('invoice already consumed');
    this.name = 'InvoiceConsumedError';
  }
}

/** Error interno — la tx de consumo detectó una factura vencida. */
class InvoiceExpiredInTxError extends Error {
  constructor() {
    super('invoice expired');
    this.name = 'InvoiceExpiredInTxError';
  }
}

subscriptionRouter.post("/upgrade", verifyAuth, async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) {
    return res.status(401).json({ error: "no_uid" });
  }

  const { planId } = req.body ?? {};
  if (!isSubscriptionPlan(planId)) {
    return res.status(400).json({ error: "invalid_plan", validPlans: SUBSCRIPTION_PLANS });
  }

  const db = admin.firestore();

  // Verify there's a paid invoice for this user with this tierId.
  // We do a broad query on (createdBy, status) and walk lineItems[].tierId
  // in-memory because Firestore can't index nested array fields directly.
  // Volume per-user is low (a paying customer has <50 lifetime invoices)
  // so this is well within latency budget.
  //
  // P0 39baa66d-8182: a paid invoice is NOT a perpetual entitlement key.
  // The invoice represents ONE purchased period — it must be (a) not yet
  // consumed (consumedAt absent) and (b) within its validity window
  // (issuedAt/paidAtIso + cycle). Otherwise a user who paid once could
  // re-run this endpoint after expiry and re-activate the plan forever.
  let paidTierId: string | null = null;
  // Capture the SAME invoice that matched the requested plan so we persist its
  // cycle (not the first paid invoice's) onto the subscription doc.
  let paidInvoiceData: Record<string, unknown> | null = null;
  let paidInvoiceRef: ReturnType<ReturnType<typeof db.collection>['doc']> | null = null;
  let paidPaymentMethod: unknown = null;
  let consumedMatch: boolean = false;
  let expiredMatch: boolean = false;
  let unverifiableMatch: boolean = false;
  const nowMs = Date.now();
  try {
    const paidInvoices = await db
      .collection("invoices")
      .where("createdBy", "==", uid)
      .where("status", "==", "paid")
      .get();

    for (const docSnap of paidInvoices.docs) {
      const data = docSnap.data();
      // Newest schema: lineItems is an array of { tierId, quantity, ... }
      const lineItems = Array.isArray(data?.lineItems) ? data.lineItems : [];
      const lineItem = lineItems.find((item: any) =>
        subscriptionPlanMatchesPaidTier(planId, item?.tierId),
      );
      const tierId = lineItem?.tierId ?? data?.tierId;
      const matchesPlan = Boolean(
        lineItem?.tierId
          ? true
          : subscriptionPlanMatchesPaidTier(planId, data?.tierId),
      );
      if (!matchesPlan) continue;

      // (a) idempotency — an invoice used for a previous upgrade is dead.
      if (data?.consumedAt) {
        consumedMatch = true;
        continue;
      }
      // (b) validity window — the purchased period must still be live.
      const periodEndMs = invoicePeriodExpiredMs(data);
      if (periodEndMs === null) {
        // No parseable issuedAt/paidAtIso: cannot prove the period is live.
        // Fail closed — never grant on unverifiable age.
        unverifiableMatch = true;
        continue;
      }
      if (nowMs > periodEndMs) {
        expiredMatch = true;
        continue;
      }

      paidTierId = tierId ?? null;
      paidInvoiceData = data;
      paidInvoiceRef = docSnap.ref as ReturnType<ReturnType<typeof db.collection>['doc']>;
      paidPaymentMethod = data?.paymentMethod;
      break;
    }

    if (!paidInvoiceRef || !paidInvoiceData) {
      logger.warn("subscription_upgrade_no_payment", { uid, planId });
      if (consumedMatch) {
        return res.status(403).json({
          error: "invoice_already_consumed",
          message: "This invoice has already been used to activate a plan.",
        });
      }
      if (expiredMatch) {
        return res.status(403).json({
          error: "invoice_expired",
          message: "The purchased period for this invoice has expired. Complete a new checkout.",
        });
      }
      if (unverifiableMatch) {
        return res.status(403).json({
          error: "invoice_unverifiable",
          message: "Invoice age could not be verified. Complete a new checkout.",
        });
      }
      return res.status(403).json({
        error: "no_paid_invoice_for_plan",
        message: "No paid invoice found for this plan. Complete a checkout first.",
      });
    }
  } catch (queryErr) {
    logger.error("subscription_upgrade_query_failed", queryErr as Error, {
      uid,
      planId,
    });
    return res.status(500).json({ error: "query_failed" });
  }

  const normalizedPlanId = normalizeSubscriptionPlanId(planId) ?? planId;

  const { cycle, source: cycleSource } = resolveInvoiceCycle(paidInvoiceData);
  if (cycleSource === "default" && paidInvoiceData != null) {
    logger.warn("billing_cycle_defaulted", { uid, rail: "subscription-upgrade" });
  }

  const paymentMethod = normalizeSubscriptionProvider(paidPaymentMethod);
  if (!paymentMethod) {
    logger.error("subscription_upgrade_unverifiable_provider", undefined, { uid, planId });
    return res.status(409).json({ error: "unverifiable_payment_provider" });
  }

  // Payment exists — update via Admin SDK (bypasses client rules).
  // The invoice consumption is ATOMIC with the grant: both happen inside
  // one transaction, so two concurrent /upgrade calls with the same
  // invoice cannot both win (Firestore retries the losing tx, which then
  // sees consumedAt and aborts). P0 39baa66d-8182 idempotency.
  try {
    await db.runTransaction(async (tx) => {
      const invoiceSnap = await tx.get(paidInvoiceRef!);
      const invoiceData = invoiceSnap.data();
      if (invoiceData?.consumedAt) {
        throw new InvoiceConsumedError();
      }
      const periodEndMs = invoicePeriodExpiredMs(invoiceData);
      if (periodEndMs === null || Date.now() > periodEndMs) {
        throw new InvoiceExpiredInTxError();
      }
      await tx.update(paidInvoiceRef!, {
        consumedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await tx.set(
        db.collection("users").doc(uid),
        {
          subscriptionPlan: normalizedPlanId,
          subscription: {
            planId: normalizedPlanId,
            tierId: paidTierId ?? normalizedPlanId,
            status: "active",
            paymentMethod,
            provider: paymentMethod,
            expiryDate: null,
            gracePeriodEnd: null,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            cycle,
          },
        },
        { merge: true },
      );
    });
  } catch (writeErr) {
    if (writeErr instanceof InvoiceConsumedError) {
      logger.warn("subscription_upgrade_invoice_consumed", { uid, planId });
      return res.status(403).json({
        error: "invoice_already_consumed",
        message: "This invoice has already been used to activate a plan.",
      });
    }
    if (writeErr instanceof InvoiceExpiredInTxError) {
      logger.warn("subscription_upgrade_invoice_expired_tx", { uid, planId });
      return res.status(403).json({
        error: "invoice_expired",
        message: "The purchased period for this invoice has expired. Complete a new checkout.",
      });
    }
    logger.error("subscription_upgrade_write_failed", writeErr as Error, {
      uid,
      planId,
    });
    return res.status(500).json({ error: "write_failed" });
  }

  // CLAUDE.md #14: the plan write above already succeeded (the user paid and
  // their subscription was applied). An audit-log failure here is severe but
  // MUST NOT 500 a successful upgrade — otherwise the user believes the payment
  // failed and retries / double-pays / contacts support. Capture for
  // observability and continue to the success response.
  try {
    await auditServerEvent(req, "subscription.upgraded", "subscription", {
      planId: normalizedPlanId,
      tierId: paidTierId ?? normalizedPlanId,
      method: "verified-payment",
      cycle,
    });
  } catch (auditErr) {
    logger.error("audit_event_failed", auditErr as Error, { uid, planId: normalizedPlanId });
    captureRouteError(auditErr, "subscription.upgraded.audit", { uid });
  }

  logger.info("subscription_upgraded", { uid, planId: normalizedPlanId, tierId: paidTierId });
  return res.status(200).json({ success: true, planId: normalizedPlanId });
});

export default subscriptionRouter;
