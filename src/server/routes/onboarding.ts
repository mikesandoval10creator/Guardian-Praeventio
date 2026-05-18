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
    });
  } catch (projErr) {
    logger.error('onboarding_project_create_failed', projErr as Error, { uid });
    captureRouteError(projErr, 'onboarding.project_create', { uid });
    return res.status(500).json({ error: 'project_create_failed' });
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

  await auditServerEvent(req, 'onboarding.completed', 'onboarding', {
    industry: payload.industry,
    countries: payload.countries,
    tier: payload.tier,
    projectId,
    invitedCount: invitedEmails.length,
    failedInvites: invitationFailures.length,
    csvProvided: !!payload.workersCsv,
  });

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
  });
});

export default onboardingRouter;
