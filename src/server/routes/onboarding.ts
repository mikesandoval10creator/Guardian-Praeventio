// Sprint 24 Bucket KK.3 — Self-service onboarding completion endpoint.
//
// `POST /api/onboarding/complete` finalizes the wizard for a brand-new
// tenant in a single transactional pass:
//
//   1. Persist tenant config (industry, countries, tier) on
//      `users/{uid}.tenantConfig` and mirror the tier into
//      `users/{uid}.subscription.planId` so the rest of the SPA picks it
//      up immediately. Note: this DOES NOT replace the
//      payment-verified `/api/subscription/upgrade` flow — for paid
//      tiers (anything above `gratis`) we leave a `pendingTier` flag
//      so billing can require an invoice before the upgrade is
//      considered active. The user can still use the app on `gratis`
//      meanwhile, but write paths gate on `subscription.planId`.
//   2. Create the first project under `tenants/{tenantId}/projects/{id}`
//      (we use uid as tenantId — single-tenant-per-uid is the current
//      data model; multi-tenant CSM is a separate Sprint).
//   3. Fire off team invitations (email side-effects best-effort, never
//      blocking the wizard response — same pattern as projects.ts).
//   4. Stash the optional workers CSV into `tenants/{tenantId}/imports/
//      onboarding-{ts}` for the JJ-bucket ETL worker to pick up
//      asynchronously. We deliberately do NOT call the ETL inline:
//      Bucket JJ owns those paths and may not exist yet.
//   5. Mark `users/{uid}.onboarded = true` so the App.tsx redirect
//      guard stops sending the user back to /onboarding.
//
// Failures in steps 3-4 are logged but do NOT fail the whole
// onboarding — the user has done their part and shouldn't be punished
// for a flaky email provider. Failures in steps 1, 2 or 5 are fatal
// because they leave the account in an unusable state.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { EmailService } from '../../services/email/resendService.js';
import { projectInvitationTemplate } from '../../services/email/templates.js';
import { TIERS } from '../../services/pricing/tiers.js';
import { SII_ACTIVIDADES_ECONOMICAS } from '../../data/sii/actividadesEconomicas.js';
// Épica Rubros SII slice 3 — pure seed builder (risk nodes + legal
// obligations from the rubro's preventive profile) + the CL pack whose
// thresholds drive the dotación obligations.
import { buildProjectSeeds } from '../../services/sii/projectSeeds.js';
import { CL_PACK } from '../../data/normativa/cl.js';

export const onboardingRouter = Router();

const VALID_INDUSTRIES = new Set([
  'mining',
  'construction',
  'manufacturing',
  'oil-gas',
  'agriculture',
  'retail',
  'healthcare',
  'education',
  'finance',
  'transport',
  'services',
  'public',
]);

const VALID_COUNTRIES = new Set(['CL', 'AR', 'PE', 'CO', 'MX', 'BR', 'EN']);

const VALID_TIER_IDS: Set<string> = new Set<string>(TIERS.map((t) => t.id as string));

interface OnboardingPayload {
  industry: string;
  countries: string[];
  tier: string;
  inviteEmails: string[];
  projectName: string;
  workersCsv: string | null;
  /** SII economic-activity code from the wizard autocomplete (optional). */
  siiCode: number | null;
  /**
   * GP-* sector DERIVED server-side from the verified SII catalogue —
   * the client-side mapping is never trusted (épica Rubros SII, slice 2).
   */
  sectorId: string | null;
  /** Estimated headcount from the wizard's dotación question (optional). */
  estimatedWorkers: number | null;
}

function validatePayload(body: unknown): { ok: true; data: OnboardingPayload } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'invalid_body' };
  const b = body as Record<string, unknown>;
  if (typeof b.industry !== 'string' || !VALID_INDUSTRIES.has(b.industry))
    return { ok: false, error: 'invalid_industry' };
  if (!Array.isArray(b.countries) || b.countries.length === 0)
    return { ok: false, error: 'invalid_countries' };
  for (const c of b.countries) {
    if (typeof c !== 'string' || !VALID_COUNTRIES.has(c))
      return { ok: false, error: `invalid_country:${c}` };
  }
  if (typeof b.tier !== 'string' || !VALID_TIER_IDS.has(b.tier))
    return { ok: false, error: 'invalid_tier' };
  if (typeof b.projectName !== 'string' || b.projectName.trim().length < 2)
    return { ok: false, error: 'invalid_project_name' };
  if (b.inviteEmails != null && !Array.isArray(b.inviteEmails))
    return { ok: false, error: 'invalid_invite_emails' };
  if (b.workersCsv != null && typeof b.workersCsv !== 'string')
    return { ok: false, error: 'invalid_workers_csv' };

  // Optional SII rubro: must exist in the verified catalogue. The GP-*
  // sector is derived HERE from that catalogue row — a client-supplied
  // sectorId is ignored (never trust client identity/classification).
  let siiCode: number | null = null;
  let sectorId: string | null = null;
  if (b.siiCode != null) {
    if (typeof b.siiCode !== 'number' || !Number.isInteger(b.siiCode))
      return { ok: false, error: 'invalid_sii_code' };
    const actividad = SII_ACTIVIDADES_ECONOMICAS.find((e) => e.codigo === b.siiCode);
    if (!actividad) return { ok: false, error: 'invalid_sii_code' };
    siiCode = actividad.codigo;
    sectorId = actividad.sectorId;
  }

  // Optional estimated headcount: positive integer with a sanity ceiling.
  let estimatedWorkers: number | null = null;
  if (b.estimatedWorkers != null) {
    if (
      typeof b.estimatedWorkers !== 'number' ||
      !Number.isInteger(b.estimatedWorkers) ||
      b.estimatedWorkers < 1 ||
      b.estimatedWorkers > 1_000_000
    ) {
      return { ok: false, error: 'invalid_estimated_workers' };
    }
    estimatedWorkers = b.estimatedWorkers;
  }

  return {
    ok: true,
    data: {
      industry: b.industry,
      countries: b.countries as string[],
      tier: b.tier,
      inviteEmails: Array.isArray(b.inviteEmails)
        ? (b.inviteEmails as unknown[]).filter((e): e is string => typeof e === 'string')
        : [],
      projectName: b.projectName.trim(),
      workersCsv: typeof b.workersCsv === 'string' ? b.workersCsv : null,
      siiCode,
      sectorId,
      estimatedWorkers,
    },
  };
}

onboardingRouter.post('/onboarding/complete', verifyAuth, idempotencyKey(), async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: 'no_uid' });

  const validation = validatePayload(req.body);
  if (validation.ok === false) {
    return res.status(400).json({ error: validation.error });
  }
  const payload = validation.data;

  const db = admin.firestore();
  const tenantId = uid; // single-tenant-per-user (current data model)
  const isPaidTier = payload.tier !== 'gratis';

  // â”€â”€ 1. Persist tenant config + mirror tier â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  try {
    await db.collection('users').doc(uid).set(
      {
        tenantConfig: {
          industry: payload.industry,
          countries: payload.countries,
          tier: payload.tier,
          // Épica Rubros SII slice 2 — written only when the wizard's
          // autocomplete/dotación were used (server-derived sectorId).
          ...(payload.siiCode != null
            ? { siiCode: payload.siiCode, sectorId: payload.sectorId }
            : {}),
          ...(payload.estimatedWorkers != null
            ? { estimatedWorkers: payload.estimatedWorkers }
            : {}),
          configuredAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        // For free tier we activate immediately. For paid tiers we
        // record the user's intent and let the payment flow flip
        // `subscription.planId` once an invoice clears.
        subscription: isPaidTier
          ? {
              planId: 'gratis',
              pendingTier: payload.tier,
              status: 'pending_payment',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }
          : {
              planId: 'gratis',
              status: 'active',
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
        onboarded: true,
        onboardedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  } catch (writeErr) {
    logger.error('onboarding_user_write_failed', writeErr as Error, { uid });
    captureRouteError(writeErr, 'onboarding.user_write', { uid });
    return res.status(500).json({ error: 'persist_failed' });
  }

  // â”€â”€ 2. Create first project â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let projectId: string;
  try {
    const projectRef = db
      .collection('tenants')
      .doc(tenantId)
      .collection('projects')
      .doc();
    projectId = projectRef.id;
    await projectRef.set({
      name: payload.projectName,
      ownerUid: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      members: { [uid]: { role: 'gerente', joinedAt: new Date().toISOString() } },
      industry: payload.industry,
      countries: payload.countries,
      source: 'onboarding-wizard',
      // Épica Rubros SII slice 3 — the rubro lives on the project too, not
      // only on users/{uid}.tenantConfig.
      ...(payload.siiCode != null
        ? { codigoActividadSii: payload.siiCode, sectorId: payload.sectorId }
        : {}),
      ...(payload.estimatedWorkers != null
        ? { estimatedWorkers: payload.estimatedWorkers }
        : {}),
    });

    // Slice 3 — also create the CANONICAL top-level `projects/{pid}` doc
    // (same id). The rest of the platform keys off this collection:
    // ProjectContext lists `projects` where members array-contains uid,
    // firestore.rules `isProjectMember()` and the server-side
    // `assertProjectMember()` both read `projects/{pid}.members` /
    // `.createdBy`. Without this mirror the onboarding project (and any
    // seed written for it) is invisible and unreadable in the SPA.
    // Every key used here is in the isValidProject() whitelist of
    // firestore.rules, so subsequent CLIENT updates keep passing rules;
    // the rubro fields ride inside the whitelisted `metadata` map.
    await db.collection('projects').doc(projectId).set({
      name: payload.projectName,
      // M-1: stamp the owning tenant. Single-tenant-per-user model → tenant == owner uid.
      tenantId: uid,
      industry: payload.industry,
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: uid,
      members: [uid],
      // Same default the Projects page form uses for a brand-new project.
      riskLevel: 'Medio',
      ...(payload.estimatedWorkers != null
        ? { workersCount: payload.estimatedWorkers }
        : {}),
      metadata: {
        origin: 'onboarding-wizard',
        ...(payload.siiCode != null
          ? { codigoActividadSii: payload.siiCode, sectorId: payload.sectorId }
          : {}),
      },
    });
  } catch (projErr) {
    logger.error('onboarding_project_create_failed', projErr as Error, { uid });
    captureRouteError(projErr, 'onboarding.project_create', { uid });
    return res.status(500).json({ error: 'project_create_failed' });
  }

  // â”€â”€ 2b. Seed rubro risks + dotación obligations (slice 3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // The preventive profile of the rubro becomes REAL initial records:
  //   - risk seeds → top-level `nodes` (the IPER module's read path:
  //     Matrix.tsx → useRiskEngine lists `nodes` by projectId). Written via
  //     Admin SDK server-side; readable by the creator through the
  //     member/author branches of the `nodes` rules.
  //   - obligation seeds → `projects/{pid}/legal_obligations` (the
  //     LegalCalendar page's read path; member-readable subcollection).
  // Deterministic ids make re-runs overwrite instead of duplicate.
  // Best-effort: a seed failure must not lose the onboarding the user just
  // completed — log + capture, but keep the 200.
  let seededRisks = 0;
  let seededObligations = 0;
  if (payload.siiCode != null || payload.estimatedWorkers != null) {
    try {
      // Dotación thresholds are Chilean law (Ley 16.744 / DS 44 via the CL
      // pack) — only seed obligations for tenants operating in CL. Risk
      // seeds are preventive content (not legal citations) and apply always.
      const operatesInChile = payload.countries.includes('CL');
      const seeds = buildProjectSeeds({
        projectId,
        siiCode: payload.siiCode,
        sectorId: payload.sectorId,
        workerCount: operatesInChile ? payload.estimatedWorkers : null,
        pack: CL_PACK,
        now: new Date(),
      });

      for (const seed of seeds.riskSeeds) {
        await db
          .collection('nodes')
          .doc(seed.id)
          .set({
            ...seed.doc,
            // Identity from the verified token — never client-supplied.
            metadata: { ...seed.doc.metadata, authorId: uid },
          });
        seededRisks += 1;
      }

      for (const seed of seeds.obligationSeeds) {
        await db
          .collection('projects')
          .doc(projectId)
          .collection('legal_obligations')
          .doc(seed.id)
          .set(seed.doc);
        seededObligations += 1;
      }

      if (seededRisks > 0 || seededObligations > 0) {
        // Audit invariant (rule #3/#14): one awaited row for the seeding
        // state change, uid/email stamped from the token by auditServerEvent.
        try {
          await auditServerEvent(
            req,
            'onboarding.projectSeeded',
            'onboarding',
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
        } catch (auditErr) {
          logger.error('audit_event_failed', auditErr as Error, {
            action: 'onboarding.projectSeeded',
            projectId,
          });
          captureRouteError(auditErr, 'onboarding.seed_audit', { uid, projectId });
        }
      }
    } catch (seedErr) {
      logger.warn('onboarding_seed_failed', {
        uid,
        projectId,
        err: (seedErr as Error)?.message,
      });
      captureRouteError(seedErr, 'onboarding.project_seed', { uid, projectId });
    }
  }

  // â”€â”€ 3. Team invitations (best-effort) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const invitedEmails: string[] = [];
  const invitationFailures: string[] = [];
  if (payload.inviteEmails.length > 0) {
    const emailService = EmailService.fromEnv();
    const inviterEmail = req.user?.email || 'tu equipo';
    for (const email of payload.inviteEmails) {
      try {
        const token = `onb-${projectId}-${Buffer.from(email).toString('base64url')}-${Date.now()}`;
        await db
          .collection('tenants')
          .doc(tenantId)
          .collection('projects')
          .doc(projectId)
          .collection('invitations')
          .doc(token)
          .set({
            email: email.toLowerCase(),
            status: 'pending',
            role: 'operario',
            invitedBy: uid,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'onboarding-wizard',
          });

        if (emailService) {
          try {
            const html = projectInvitationTemplate({
              projectName: payload.projectName,
              inviterName: inviterEmail,
              invitedRole: 'operario',
              token,
            });
            await emailService.send({
              to: email,
              subject: `Te invitaron a ${payload.projectName} en Praeventio`,
              html,
            });
          } catch (sendErr) {
            // The invitation row is the source of truth — a bad email
            // delivery shouldn't ditch the invite. The recipient can
            // still accept via direct link.
            logger.warn('onboarding_email_failed', {
              uid,
              email,
              err: (sendErr as Error)?.message,
            });
          }
        }
        invitedEmails.push(email);
      } catch (invErr) {
        invitationFailures.push(email);
        logger.warn('onboarding_invitation_failed', {
          uid,
          email,
          err: (invErr as Error)?.message,
        });
      }
    }
  }

  // â”€â”€ 4. Stash workers CSV for ETL pickup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (payload.workersCsv) {
    try {
      await db
        .collection('tenants')
        .doc(tenantId)
        .collection('imports')
        .doc(`onboarding-${Date.now()}`)
        .set({
          kind: 'workers-csv',
          projectId,
          uploadedBy: uid,
          status: 'pending',
          csv: payload.workersCsv,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    } catch (csvErr) {
      // CSV stash is best-effort — user can re-upload from the project
      // page.
      logger.warn('onboarding_csv_stash_failed', {
        uid,
        err: (csvErr as Error)?.message,
      });
    }
  }

  // Audit invariant (rule #3/#14): awaited + guarded. Onboarding already
  // succeeded at this point — an audit_logs failure is severe (compliance
  // trail: logged + Sentry) but must NOT turn the user's completed
  // onboarding into a 500. Mirrors the 'onboarding.projectSeeded' guard.
  try {
    await auditServerEvent(req, 'onboarding.completed', 'onboarding', {
      industry: payload.industry,
      countries: payload.countries,
      tier: payload.tier,
      projectId,
      invitedCount: invitedEmails.length,
      failedInvites: invitationFailures.length,
      csvProvided: !!payload.workersCsv,
      siiCode: payload.siiCode,
      sectorId: payload.sectorId,
      estimatedWorkers: payload.estimatedWorkers,
      seededRisks,
      seededObligations,
    });
  } catch (auditErr) {
    logger.error('audit_event_failed', auditErr as Error, {
      action: 'onboarding.completed',
      projectId,
    });
    captureRouteError(auditErr, 'onboarding.completion_audit', { uid, projectId });
  }

  logger.info('onboarding_completed', {
    uid,
    projectId,
    tier: payload.tier,
    invitedCount: invitedEmails.length,
  });

  return res.status(200).json({
    success: true,
    projectId,
    invitedEmails,
    invitationFailures,
    pendingPayment: isPaidTier,
    seededRisks,
    seededObligations,
  });
});

export default onboardingRouter;
