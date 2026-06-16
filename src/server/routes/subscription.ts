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
import { logger } from "../../utils/logger.js";
import {
  SUBSCRIPTION_PLANS,
  isSubscriptionPlan,
  normalizeSubscriptionPlanId,
  subscriptionPlanMatchesPaidTier,
  cycleFromInvoiceDoc,
} from "../../services/pricing/subscriptionPlan.js";

export const subscriptionRouter = Router();

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
  let paidTierId: string | null = null;
  // Capture the SAME invoice that matched the requested plan so we persist its
  // cycle (not the first paid invoice's) onto the subscription doc.
  let paidInvoiceData: Record<string, unknown> | null = null;
  try {
    const paidInvoices = await db
      .collection("invoices")
      .where("createdBy", "==", uid)
      .where("status", "==", "paid")
      .get();

    const hasPaidForPlan = paidInvoices.docs.some((docSnap) => {
      const data = docSnap.data();
      // Newest schema: lineItems is an array of { tierId, quantity, ... }
      const lineItems = Array.isArray(data?.lineItems) ? data.lineItems : [];
      const lineItem = lineItems.find((item: any) =>
        subscriptionPlanMatchesPaidTier(planId, item?.tierId),
      );
      if (lineItem?.tierId) {
        paidTierId = lineItem.tierId;
        paidInvoiceData = data;
        return true;
      }
      // Legacy schema: top-level tierId
      if (subscriptionPlanMatchesPaidTier(planId, data?.tierId)) {
        paidTierId = data.tierId;
        paidInvoiceData = data;
        return true;
      }
      return false;
    });

    if (!hasPaidForPlan) {
      logger.warn("subscription_upgrade_no_payment", { uid, planId });
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

  // Payment exists — update via Admin SDK (bypasses client rules).
  try {
    await db.collection("users").doc(uid).set(
      {
        subscriptionPlan: normalizedPlanId,
        subscription: {
          planId: normalizedPlanId,
          tierId: paidTierId ?? normalizedPlanId,
          status: "active",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          cycle: cycleFromInvoiceDoc(paidInvoiceData),
        },
      },
      { merge: true },
    );
  } catch (writeErr) {
    logger.error("subscription_upgrade_write_failed", writeErr as Error, {
      uid,
      planId,
    });
    return res.status(500).json({ error: "write_failed" });
  }

  await auditServerEvent(req, "subscription.upgraded", "subscription", {
    planId: normalizedPlanId,
    tierId: paidTierId ?? normalizedPlanId,
    method: "verified-payment",
  });

  logger.info("subscription_upgraded", { uid, planId: normalizedPlanId, tierId: paidTierId });
  return res.status(200).json({ success: true, planId: normalizedPlanId });
});

export default subscriptionRouter;
