// Self-service onboarding: all persisted invariants commit atomically with a
// durable receipt. Only email delivery and audit sinks remain best-effort.

import { Router } from "express";
import admin from "firebase-admin";
import { verifyAuth } from "../middleware/verifyAuth.js";
import {
  provisionOnboarding,
  OnboardingConflict,
  type OnboardingPayload,
} from "../services/onboardingProvisioning.js";
import { auditServerEvent } from "../middleware/auditLog.js";
import { logger } from "../../utils/logger.js";
import { captureRouteError } from "../middleware/captureRouteError.js";
import { EmailService } from "../../services/email/resendService.js";
import { projectInvitationTemplate } from "../../services/email/templates.js";
import { TIERS } from "../../services/pricing/tiers.js";

import { SII_ACTIVIDADES_ECONOMICAS } from "../../data/sii/actividadesEconomicas.js";
export const onboardingRouter = Router();

const VALID_INDUSTRIES = new Set([
  "mining",
  "construction",
  "manufacturing",
  "oil-gas",
  "agriculture",
  "retail",
  "healthcare",
  "education",
  "finance",
  "transport",
  "services",
  "public",
]);

const VALID_COUNTRIES = new Set(["CL", "AR", "PE", "CO", "MX", "BR", "EN"]);

const VALID_TIER_IDS: Set<string> = new Set<string>(
  TIERS.map((t) => t.id as string),
);

function validatePayload(
  body: unknown,
): { ok: true; data: OnboardingPayload } | { ok: false; error: string } {
  if (!body || typeof body !== "object")
    return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  if (typeof b.industry !== "string" || !VALID_INDUSTRIES.has(b.industry))
    return { ok: false, error: "invalid_industry" };
  if (
    !Array.isArray(b.countries) ||
    b.countries.length === 0 ||
    b.countries.length > VALID_COUNTRIES.size
  )
    return { ok: false, error: "invalid_countries" };
  for (const c of b.countries) {
    if (typeof c !== "string" || !VALID_COUNTRIES.has(c))
      return { ok: false, error: `invalid_country:${c}` };
  }
  if (typeof b.tier !== "string" || !VALID_TIER_IDS.has(b.tier))
    return { ok: false, error: "invalid_tier" };
  if (
    typeof b.projectName !== "string" ||
    b.projectName.trim().length < 2 ||
    b.projectName.length > 200
  )
    return { ok: false, error: "invalid_project_name" };
  if (b.inviteEmails != null && !Array.isArray(b.inviteEmails))
    return { ok: false, error: "invalid_invite_emails" };
  if (b.workersCsv != null && typeof b.workersCsv !== "string")
    return { ok: false, error: "invalid_workers_csv" };

  if (
    typeof b.workersCsv === "string" &&
    Buffer.byteLength(b.workersCsv, "utf8") > 512 * 1024
  )
    return { ok: false, error: "workers_csv_too_large" };
  const rawEmails = b.inviteEmails ?? [];
  if (!Array.isArray(rawEmails) || rawEmails.length > 50)
    return { ok: false, error: "too_many_invite_emails" };
  const inviteEmails: string[] = [];
  for (const rawEmail of rawEmails) {
    if (typeof rawEmail !== "string" || rawEmail.length > 254)
      return { ok: false, error: "invalid_invite_email" };
    const email = rawEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))
      return { ok: false, error: "invalid_invite_email" };
    if (!inviteEmails.includes(email)) inviteEmails.push(email);
  }

  // Optional SII rubro: must exist in the verified catalogue. The GP-*
  // sector is derived HERE from that catalogue row — a client-supplied
  // sectorId is ignored (never trust client identity/classification).
  let siiCode: number | null = null;
  let sectorId: string | null = null;
  if (b.siiCode != null) {
    if (typeof b.siiCode !== "number" || !Number.isInteger(b.siiCode))
      return { ok: false, error: "invalid_sii_code" };
    const actividad = SII_ACTIVIDADES_ECONOMICAS.find(
      (e) => e.codigo === b.siiCode,
    );
    if (!actividad) return { ok: false, error: "invalid_sii_code" };
    siiCode = actividad.codigo;
    sectorId = actividad.sectorId;
  }

  // Optional estimated headcount: positive integer with a sanity ceiling.
  let estimatedWorkers: number | null = null;
  if (b.estimatedWorkers != null) {
    if (
      typeof b.estimatedWorkers !== "number" ||
      !Number.isInteger(b.estimatedWorkers) ||
      b.estimatedWorkers < 1 ||
      b.estimatedWorkers > 1_000_000
    ) {
      return { ok: false, error: "invalid_estimated_workers" };
    }
    estimatedWorkers = b.estimatedWorkers;
  }

  return {
    ok: true,
    data: {
      industry: b.industry,
      countries: [...new Set(b.countries as string[])].sort(),
      tier: b.tier,
      inviteEmails: inviteEmails.sort(),
      projectName: b.projectName.trim(),
      workersCsv: typeof b.workersCsv === "string" ? b.workersCsv : null,
      siiCode,
      sectorId,
      estimatedWorkers,
    },
  };
}

onboardingRouter.post("/onboarding/complete", verifyAuth, async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: "no_uid" });
  const validation = validatePayload(req.body);
  if (validation.ok === false)
    return res.status(400).json({ error: validation.error });
  const payload = validation.data;

  let provisioned;
  try {
    provisioned = await provisionOnboarding(admin.firestore(), uid, payload);
  } catch (err) {
    if (err instanceof OnboardingConflict)
      return res.status(409).json({ error: err.reason });
    logger.error("onboarding_provisioning_failed", err as Error, { uid });
    captureRouteError(err, "onboarding.provisioning", { uid });
    return res.status(500).json({ error: "persist_failed" });
  }
  // The durable per-user receipt, not the optional HTTP header, protects
  // concurrent requests, lost responses and retries across browser reloads.
  if (provisioned.replayed) return res.status(200).json(provisioned.result);
  const { projectId, seededRisks, seededObligations } = provisioned.result;

  if (provisioned.promoted) {
    try {
      await auditServerEvent(
        req,
        "onboarding.owner_role_promoted",
        "onboarding",
        {
          newRole: "gerente",
          reason: "tenant_owner_onboarding",
        },
      );
    } catch (err) {
      logger.error("audit_event_failed", err as Error, { uid });
      captureRouteError(err, "onboarding.role_promote_audit", { uid });
    }
  }
  if (seededRisks > 0 || seededObligations > 0) {
    try {
      await auditServerEvent(
        req,
        "onboarding.projectSeeded",
        "onboarding",
        {
          projectId,
          siiCode: payload.siiCode,
          sectorId: payload.sectorId,
          estimatedWorkers: payload.estimatedWorkers,
          riskSeeds: seededRisks,
          obligationSeeds: seededObligations,
        },
        { projectId },
      );
    } catch (err) {
      logger.error("audit_event_failed", err as Error, {
        action: "onboarding.projectSeeded",
        projectId,
      });
      captureRouteError(err, "onboarding.seed_audit", { uid, projectId });
    }
  }

  // Persisted invitations are authoritative. Only the winning request attempts
  // email; delivery remains best-effort, NOT an exactly-once provider guarantee.
  // The committed result never depends on whether Resend is available.
  try {
    const emailService = EmailService.fromEnv();
    if (emailService) {
      for (const { email, token } of provisioned.invitations) {
        try {
          const html = projectInvitationTemplate({
            projectName: payload.projectName,
            inviterName: req.user?.email || "tu equipo",
            invitedRole: "operario",
            token,
          });
          const sent = await emailService.send({
            to: email,
            subject: `Te invitaron a ${payload.projectName} en Praeventio`,
            html,
          });
          if (!sent.ok)
            logger.warn("onboarding_email_failed", { uid, projectId });
        } catch (err) {
          logger.warn("onboarding_email_failed", { uid, projectId });
          captureRouteError(err, "onboarding.invitation_email", {
            uid,
            projectId,
          });
        }
      }
    }
  } catch (err) {
    logger.warn("onboarding_email_unavailable", { uid, projectId });
    captureRouteError(err, "onboarding.invitation_email", { uid, projectId });
  }

  try {
    await auditServerEvent(req, "onboarding.completed", "onboarding", {
      industry: payload.industry,
      countries: payload.countries,
      tier: payload.tier,
      projectId,
      invitedCount: provisioned.result.invitedEmails.length,
      failedInvites: 0,
      csvProvided: !!payload.workersCsv,
      siiCode: payload.siiCode,
      sectorId: payload.sectorId,
      estimatedWorkers: payload.estimatedWorkers,
      seededRisks,
      seededObligations,
    });
  } catch (err) {
    logger.error("audit_event_failed", err as Error, {
      action: "onboarding.completed",
      projectId,
    });
    captureRouteError(err, "onboarding.completion_audit", { uid, projectId });
  }
  logger.info("onboarding_completed", {
    uid,
    projectId,
    tier: payload.tier,
    invitedCount: provisioned.result.invitedEmails.length,
  });
  return res.status(200).json(provisioned.result);
});

export default onboardingRouter;
