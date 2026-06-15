// Praeventio Guard — Round 18 Phase 3 split.
//
// Project membership + invitation endpoints extracted from server.ts. The
// 6 routes are split across TWO routers because one set lives under
// `/api/projects/:id/...` and the other under `/api/invitations/...`.
//
// Mount strategy (in server.ts):
//   • app.use('/api/projects', projectsRouter)           â† 4 routes
//   • app.use('/api/invitations', invitationsRouter)     â† 2 routes
//
// Final paths preserved verbatim — DO NOT change:
//   • POST   /api/projects/:id/invite
//   • GET    /api/projects/:id/members
//   • DELETE /api/projects/:id/members/:uid
//   • DELETE /api/projects/:id/invite
//   • GET    /api/invitations/info/:token        (public)
//   • POST   /api/invitations/:token/accept      (verifyAuth)
//
// Authorization model (B17, Fase 5 — per-project membership):
//   • Management surfaces (invite / remove-member / cancel-invite): the
//     caller must be the project's `createdBy` OR a MEMBER OF THIS PROJECT
//     whose per-project role (`memberRoles[uid]`) is `gerente`/`admin`.
//     Previously these gated on the caller's GLOBAL `gerente`/`admin`
//     custom claim, which let a gerente of ANY project manage EVERY
//     project (cross-project IDOR). The privilege now derives from the
//     per-project `memberRoles` map, never a global claim.
//   • The members LIST endpoint allows any member of this project to read.
//   • Self-leave: a member may always remove THEMSELVES.
//   • Invitation accept: the caller's email must match the invited email.

import { Router } from 'express';
import admin from 'firebase-admin';
import crypto from 'crypto';
import { Resend } from 'resend';

import { verifyAuth } from '../middleware/verifyAuth.js';
import { auditServerEvent } from '../middleware/auditLog.js';
// Sprint 22 Bucket Y — centralized email service. We keep the legacy
// `resend` instance below for backwards compatibility with any inline
// callers, but new sends route through `EmailService` so we get a
// uniform `{ ok, error }` envelope, automatic plain-text fallback, and
// consistent From identity. The new template lives in
// `services/email/templates.ts` and replaces the previous inline HTML
// when env-driven service is available.
import { EmailService } from '../../services/email/resendService.js';
import { projectInvitationTemplate } from '../../services/email/templates.js';
// 16th wave (Bucket B) analytics: server-side wire-points for
// `project.member.invited`, `project.member.accepted`, and
// `project.member.removed`. The `serverAnalytics` adapter mirrors the
// browser surface but runs on Node primitives only — same pattern as
// `auth.role.granted/revoked` from the 15th wave Bucket D admin routes.
import { serverAnalytics } from '../../services/analytics/serverAdapter.js';
import type { Role as AnalyticsRole } from '../../services/analytics/types.js';
import { getErrorTracker } from '../../services/observability/index.js';
import { logger } from '../../utils/logger.js';
// Tier-gating server-side, Fase 1 (report-only) — docs/security/
// TIER-GATING-SERVER-SIDE-SPEC.md. Inviting a member grows a project's app
// seats; we log (never block) when that would exceed the project OWNER's plan
// cap, to validate the caps table in prod before enforcing. ADR 0021: this is
// a management/scale cap (adding a teammate), never a life-safety action.
import { readSubscriptionPlanId } from '../middleware/requireTier.js';
import { evaluateScaleCap } from '../../services/pricing/scaleCaps.js';

function sentryCapture(
  err: unknown,
  context: { endpoint?: string; trigger?: string; tags?: Record<string, string | number | boolean | null | undefined> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context as any,
    );
  } catch (e) {
    console.warn('[observability] capture failed', e);
  }
}

// Sprint 25 (CI fix) — same fallback as curriculum.ts; see note there.
const resend = new Resend(process.env.RESEND_API_KEY ?? 're_ci_placeholder');

/**
 * Map the granular domain role (`gerente`, `prevencionista`, `supervisor`,
 * `director_obra`, `medico_ocupacional`, `operario`, `contratista`) onto
 * the coarse analytics `Role` enum. Mirrors `mapToAnalyticsRole` in
 * `admin.ts` but inlined here to keep the projects route module
 * self-contained. `gerente` is mapped to `executive` (the catalog row 23
 * convention); unknown roles fall through to `worker` so dashboards stay
 * cardinality-bounded (TRACKING_PLAN §7).
 */
function mapDomainRole(role: unknown): AnalyticsRole {
  if (typeof role !== 'string') return 'worker';
  if (role === 'gerente') return 'executive';
  if (role === 'admin') return 'admin';
  if (role === 'prevencionista') return 'prevencionista';
  if (role === 'supervisor' || role === 'director_obra' || role === 'medico_ocupacional') {
    return 'supervisor';
  }
  return 'worker';
}

/**
 * Per-project authorization helpers (B17, Fase 5). Both read a project
 * document's `members`/`memberRoles`/`createdBy` fields and decide solely
 * from THIS project's state — never from a global custom claim. This closes
 * the cross-project IDOR where a `gerente`/`admin` claim on one project
 * granted management over every project.
 *
 * `PROJECT_MANAGEMENT_ROLES` is the set of per-project roles that may
 * manage membership (invite/remove/cancel). The project creator is always
 * allowed regardless of their recorded role.
 */
const PROJECT_MANAGEMENT_ROLES = new Set(['gerente', 'admin']);

interface ProjectAuthShape {
  createdBy?: string;
  members?: string[];
  memberRoles?: Record<string, string>;
}

/** True if the caller is the creator or appears in this project's members. */
function callerIsProjectMember(callerUid: string, projectData: ProjectAuthShape): boolean {
  if (projectData.createdBy === callerUid) return true;
  return Array.isArray(projectData.members) && projectData.members.includes(callerUid);
}

/**
 * True if the caller may manage membership of THIS project: the creator, or
 * a member whose per-project role is in `PROJECT_MANAGEMENT_ROLES`. A global
 * custom claim is intentionally NOT consulted — management is project-scoped.
 */
function callerCanManageProject(callerUid: string, projectData: ProjectAuthShape): boolean {
  if (projectData.createdBy === callerUid) return true;
  const members = projectData.members;
  if (!Array.isArray(members) || !members.includes(callerUid)) return false;
  const role = projectData.memberRoles?.[callerUid];
  return typeof role === 'string' && PROJECT_MANAGEMENT_ROLES.has(role);
}

function buildInviteEmailHtml({
  projectName,
  inviterName,
  role,
  token,
}: {
  projectName: string;
  inviterName: string;
  role: string;
  token: string;
}) {
  const appUrl = process.env.APP_URL || 'https://app.praeventio.net';
  const acceptUrl = `${appUrl}/invite?token=${token}`;
  const roleLabels: Record<string, string> = {
    gerente: 'Gerente de Prevención',
    prevencionista: 'Prevencionista de Riesgos',
    supervisor: 'Supervisor',
    director_obra: 'Director de Obra',
    medico_ocupacional: 'Médico Ocupacional',
    operario: 'Operario',
    contratista: 'Contratista',
  };
  const roleLabel = roleLabels[role] || role;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invitación a Praeventio</title></head><body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f4f4f5;color:#18181b">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <tr><td style="background:#09090b;padding:32px 40px;text-align:center">
      <span style="font-size:24px;font-weight:900;color:#10b981;letter-spacing:-1px">PRAEVENTIO</span>
      <span style="font-size:10px;font-weight:700;color:#6b7280;display:block;letter-spacing:4px;margin-top:2px">GUARD</span>
    </td></tr>
    <tr><td style="padding:40px">
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:900;color:#09090b">Fuiste invitado a un proyecto</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#71717a"><strong style="color:#09090b">${inviterName}</strong> te invitó a unirte a <strong style="color:#09090b">"${projectName}"</strong> como <strong style="color:#10b981">${roleLabel}</strong>.</p>
      <div style="text-align:center;margin:32px 0">
        <a href="${acceptUrl}" style="display:inline-block;background:#10b981;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:10px;letter-spacing:0.5px">Aceptar Invitación</a>
      </div>
      <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;text-align:center">Si no esperabas esta invitación, puedes ignorar este email.</p>
      <p style="margin:8px 0 0;font-size:11px;color:#d4d4d8;text-align:center;word-break:break-all">O copia este enlace: ${acceptUrl}</p>
    </td></tr>
    <tr><td style="background:#f9fafb;padding:20px 40px;text-align:center">
      <p style="margin:0;font-size:11px;color:#a1a1aa">© ${new Date().getFullYear()} Praeventio Guard · Plataforma de Prevención de Riesgos</p>
    </td></tr>
  </table></td></tr></table>
</body></html>`;
}

const projectsRouter = Router();

// POST /api/projects/:id/invite  — project creator sends an invitation
projectsRouter.post('/:id/invite', verifyAuth, async (req, res) => {
  const projectId = req.params.id;
  const callerUid = req.user!.uid;
  const { invitedEmail, invitedRole } = req.body;

  if (!invitedEmail || !invitedRole) {
    return res.status(400).json({ error: 'invitedEmail and invitedRole are required' });
  }

  try {
    const projectDoc = await admin.firestore().collection('projects').doc(projectId).get();
    if (!projectDoc.exists) return res.status(404).json({ error: 'Project not found' });

    const projectData = projectDoc.data()!;
    if (!callerCanManageProject(callerUid, projectData)) {
      return res
        .status(403)
        .json({ error: 'Forbidden: Only the project creator or a gerente/admin member can invite members' });
    }

    // Check if user is already a member
    const existingMembers: string[] = projectData.members || [];
    try {
      const invitedUser = await admin.auth().getUserByEmail(invitedEmail);
      if (existingMembers.includes(invitedUser.uid)) {
        return res.status(409).json({ error: 'User is already a member of this project' });
      }
    } catch {
      // User doesn't exist yet — invitation will add them when they register and accept
    }

    // Check for existing pending invitation
    const existingInvite = await admin
      .firestore()
      .collection('invitations')
      .where('projectId', '==', projectId)
      .where('invitedEmail', '==', invitedEmail)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!existingInvite.empty) {
      return res
        .status(409)
        .json({ error: 'A pending invitation already exists for this email' });
    }

    // Scale-gate (REPORT-ONLY, Fase 1): log — but never block — when adding
    // this seat would exceed the project owner's plan cap. The owner's plan
    // governs the project's seat budget (subscription is per-user; tenant=uid).
    // A cap-eval failure is swallowed: report-only must never affect invites.
    try {
      const ownerUid =
        typeof projectData.createdBy === 'string' ? projectData.createdBy : undefined;
      if (ownerUid) {
        const ownerPlan = await readSubscriptionPlanId(ownerUid);
        const currentSeats = Array.isArray(projectData.members)
          ? projectData.members.length
          : 0;
        const decision = evaluateScaleCap({
          plan: ownerPlan,
          kind: 'workers',
          current: currentSeats,
          delta: 1,
        });
        if (!decision.withinCap) {
          logger.warn('tier_gate_would_block', {
            gate: 'workers',
            mode: 'report-only',
            projectId,
            ownerUid,
            plan: decision.plan,
            cap: decision.cap,
            current: decision.current,
            projected: decision.projected,
          });
        }
      }
    } catch (capErr) {
      // Report-only must never affect the invite; log + Sentry for observability
      // (matches every other catch in this file — keep the full stack trace).
      logger.warn('scale_gate_eval_failed', {
        projectId,
        err: capErr instanceof Error ? capErr.message : String(capErr),
      });
      sentryCapture(capErr, {
        endpoint: '/api/projects/:id/invite',
        trigger: 'scale-gate-report-only',
        tags: { projectId },
      });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const inviteRef = await admin.firestore().collection('invitations').add({
      projectId,
      projectName: projectData.name || '',
      invitedEmail,
      invitedRole,
      invitedBy: callerUid,
      token,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt,
    });

    await auditServerEvent(req, 'projects.invite', 'projects', {
      projectId,
      inviteId: inviteRef.id,
      invitedEmail,
      invitedRole,
    }, { projectId });

    // Send invitation email — failure does NOT block the response.
    // Sprint 22 Bucket Y: prefer the centralized `EmailService` which
    // wraps Resend with a uniform error envelope and audit footer.
    // Falls back to the legacy inline path if `RESEND_API_KEY` is unset
    // (e.g. local dev) so the route still returns a token.
    try {
      const callerRecord = await admin.auth().getUser(callerUid);
      const inviterName = callerRecord.displayName || callerRecord.email || 'Tu equipo';
      const emailService = EmailService.fromEnv();
      const subject = `${inviterName} te invitó a "${projectData.name || 'un proyecto'}" en Praeventio`;
      if (emailService) {
        const result = await emailService.send({
          to: invitedEmail,
          subject,
          html: projectInvitationTemplate({
            projectName: projectData.name || 'un proyecto',
            inviterName,
            invitedRole,
            token,
            invitationId: inviteRef.id,
          }),
          tag: 'invitation',
        });
        if (result.ok === false) {
          logger.warn('invitation_email_delivery_failed', { err: String(result.error) });
        }
      } else {
        await resend.emails.send({
          from: 'Praeventio Guard <noreply@praeventio.net>',
          to: invitedEmail,
          subject,
          html: buildInviteEmailHtml({
            projectName: projectData.name || 'un proyecto',
            inviterName,
            role: invitedRole,
            token,
          }),
        });
      }
    } catch (emailErr) {
      logger.warn('invitation_email_delivery_failed', { err: emailErr instanceof Error ? emailErr.message : String(emailErr) });
    }

    // 16th wave (Bucket B) analytics: `project.member.invited` — fires
    // ONLY after the invitation row was successfully written to Firestore.
    // Email delivery failure does not block the analytics emit; the catalog
    // row reflects "invite link emitted" which is the Firestore write, not
    // the email side-effect. `target_role` is the closed-set analytics
    // `Role` enum mapped from the granular domain role.
    try {
      await serverAnalytics.track('project.member.invited', {
        target_role: mapDomainRole(invitedRole),
        invited_by_user_id_hash: callerUid,
        invite_channel: 'email',
      });
    } catch { /* analytics must never break user flow */ }

    return res.json({ success: true, inviteId: inviteRef.id, token, expiresAt });
  } catch (error: any) {
    logger.error('invitation_create_failed', error);
    sentryCapture(error, { endpoint: '/api/projects/:id/invite', tags: { method: 'POST', projectId, uid: callerUid } });
    return res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    });
  }
});

// GET /api/projects/:id/members  — list members with display info and roles
projectsRouter.get('/:id/members', verifyAuth, async (req, res) => {
  const projectId = req.params.id;
  const callerUid = req.user!.uid;

  try {
    const projectDoc = await admin.firestore().collection('projects').doc(projectId).get();
    if (!projectDoc.exists) return res.status(404).json({ error: 'Project not found' });

    const projectData = projectDoc.data()!;
    const memberUids: string[] = projectData.members || [];
    const memberRoles: Record<string, string> = projectData.memberRoles || {};

    if (!callerIsProjectMember(callerUid, projectData)) {
      return res.status(403).json({ error: 'Forbidden: Not a project member' });
    }

    const memberDetails = await Promise.all(
      memberUids.map(async (uid) => {
        try {
          const userRecord = await admin.auth().getUser(uid);
          return {
            uid,
            displayName: userRecord.displayName || userRecord.email || uid,
            email: userRecord.email || '',
            photoURL: userRecord.photoURL || null,
            role: memberRoles[uid] || 'operario',
            isCreator: uid === projectData.createdBy,
          };
        } catch {
          return {
            uid,
            displayName: uid,
            email: '',
            photoURL: null,
            role: memberRoles[uid] || 'operario',
            isCreator: false,
          };
        }
      }),
    );

    // Include pending invitations
    const pendingInvites = await admin
      .firestore()
      .collection('invitations')
      .where('projectId', '==', projectId)
      .where('status', '==', 'pending')
      .get();

    const invitations = pendingInvites.docs.map((doc) => ({
      id: doc.id,
      invitedEmail: doc.data().invitedEmail,
      invitedRole: doc.data().invitedRole,
      createdAt: doc.data().createdAt,
      expiresAt: doc.data().expiresAt,
    }));

    return res.json({ success: true, members: memberDetails, pendingInvitations: invitations });
  } catch (error: any) {
    logger.error('project_members_list_failed', error);
    sentryCapture(error, { endpoint: '/api/projects/:id/members', tags: { method: 'GET', projectId, uid: callerUid } });
    return res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    });
  }
});

// DELETE /api/projects/:id/members/:uid  — remove a member
projectsRouter.delete('/:id/members/:uid', verifyAuth, async (req, res) => {
  const { id: projectId, uid: targetUid } = req.params;
  const callerUid = req.user!.uid;

  try {
    const projectDoc = await admin.firestore().collection('projects').doc(projectId).get();
    if (!projectDoc.exists) return res.status(404).json({ error: 'Project not found' });

    const projectData = projectDoc.data()!;

    const isSelf = callerUid === targetUid;
    if (!isSelf && !callerCanManageProject(callerUid, projectData)) {
      return res
        .status(403)
        .json({ error: 'Forbidden: Only the project creator or a gerente/admin member can remove members' });
    }

    if (targetUid === projectData.createdBy) {
      return res.status(400).json({ error: 'Cannot remove the project creator' });
    }

    await admin.firestore().collection('projects').doc(projectId).update({
      members: admin.firestore.FieldValue.arrayRemove(targetUid),
      [`memberRoles.${targetUid}`]: admin.firestore.FieldValue.delete(),
    });

    await auditServerEvent(req, 'projects.memberRemove', 'projects', {
      projectId,
      targetUid,
    }, { projectId });

    // 16th wave (Bucket B) analytics: `project.member.removed` — fires after
    // the Firestore arrayRemove succeeded so the analytics row reflects the
    // committed mutation rather than a hypothetical attempt. The catalog
    // requires hashed identifiers (`*_user_id_hash`); we emit raw uids here
    // because server-side hashing every event would bottleneck the route
    // (same trade-off as `auth.role.revoked` at line ~117 of admin.ts).
    // `removal_reason` is omitted because the API doesn't carry one yet — a
    // future PATCH could add a `reason` body field and forward it.
    try {
      await serverAnalytics.track('project.member.removed', {
        target_user_id_hash: targetUid,
        removed_by_user_id_hash: callerUid,
      });
    } catch { /* analytics must never break user flow */ }

    return res.json({ success: true });
  } catch (error: any) {
    logger.error('project_member_remove_failed', error);
    sentryCapture(error, { endpoint: '/api/projects/:id/members/:uid', tags: { method: 'DELETE', projectId, targetUid, uid: callerUid } });
    return res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    });
  }
});

// DELETE /api/projects/:id/invite  — project creator cancels a pending invitation
projectsRouter.delete('/:id/invite', verifyAuth, async (req, res) => {
  const projectId = req.params.id;
  const callerUid = req.user!.uid;
  const { inviteId } = req.body;

  if (!inviteId) {
    return res.status(400).json({ error: 'inviteId is required' });
  }

  try {
    const projectDoc = await admin.firestore().collection('projects').doc(projectId).get();
    if (!projectDoc.exists) return res.status(404).json({ error: 'Project not found' });

    const projectData = projectDoc.data()!;
    if (!callerCanManageProject(callerUid, projectData)) {
      return res
        .status(403)
        .json({ error: 'Forbidden: Only the project creator or a gerente/admin member can cancel invitations' });
    }

    const inviteDoc = await admin.firestore().collection('invitations').doc(inviteId).get();
    if (!inviteDoc.exists) return res.status(404).json({ error: 'Invitation not found' });
    if (inviteDoc.data()!.projectId !== projectId) {
      return res.status(403).json({ error: 'Invitation does not belong to this project' });
    }

    await inviteDoc.ref.delete();

    await auditServerEvent(req, 'projects.inviteCancel', 'projects', {
      projectId,
      inviteId,
    }, { projectId });

    return res.json({ success: true });
  } catch (error: any) {
    logger.error('invitation_cancel_failed', error);
    sentryCapture(error, { endpoint: '/api/projects/:id/invite', tags: { method: 'DELETE', projectId, uid: callerUid } });
    return res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    });
  }
});

export default projectsRouter;

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Invitations router — separate mount because URLs live under
// /api/invitations/... NOT /api/projects/...
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const invitationsRouter = Router();

// GET /api/invitations/info/:token  — public, returns safe invite preview (no auth required)
invitationsRouter.get('/info/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const snapshot = await admin
      .firestore()
      .collection('invitations')
      .where('token', '==', token)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (snapshot.empty)
      return res.status(404).json({ error: 'Invitation not found or already used' });
    const invite = snapshot.docs[0].data();
    if (new Date(invite.expiresAt) < new Date())
      return res.status(410).json({ error: 'Invitation has expired' });
    // Return only safe, non-sensitive fields
    return res.json({
      projectName: invite.projectName || 'un proyecto',
      invitedRole: invite.invitedRole,
      invitedEmail: invite.invitedEmail,
      expiresAt: invite.expiresAt,
    });
  } catch (error: any) {
    sentryCapture(error, { endpoint: '/api/invitations/info/:token', tags: { method: 'GET' } });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/invitations/:token/accept  — invited user accepts
invitationsRouter.post('/:token/accept', verifyAuth, async (req, res) => {
  const { token } = req.params;
  const callerUid = req.user!.uid;
  const callerEmail = req.user!.email;
  // Optional client-supplied projectId — when present it MUST match the
  // invitation's projectId. This blocks cross-tenant write attacks where a
  // crafted projectId could otherwise bypass the invitation's intended target.
  const claimedProjectId: string | undefined =
    typeof req.body?.projectId === 'string' ? req.body.projectId : undefined;

  try {
    const snapshot = await admin
      .firestore()
      .collection('invitations')
      .where('token', '==', token)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Invitation not found or already used' });
    }

    const inviteDoc = snapshot.docs[0];
    const invite = inviteDoc.data();

    if (invite.invitedEmail !== callerEmail) {
      return res
        .status(403)
        .json({ error: 'This invitation was sent to a different email address' });
    }

    if (new Date(invite.expiresAt) < new Date()) {
      await inviteDoc.ref.update({ status: 'expired' });
      return res.status(410).json({ error: 'Invitation has expired' });
    }

    if (!invite.projectId || typeof invite.projectId !== 'string') {
      return res.status(404).json({ error: 'Invitation has no associated project' });
    }

    // Cross-tenant write defense: if the client passes a projectId, it MUST
    // match the invitation's projectId. The URL/body cannot override the
    // invitation's actual target.
    if (claimedProjectId !== undefined && claimedProjectId !== invite.projectId) {
      return res
        .status(403)
        .json({ error: 'Invitation projectId does not match request projectId' });
    }

    const projectRef = admin.firestore().collection('projects').doc(invite.projectId);

    // Run validate-and-write in a transaction so the project-existence check
    // and the arrayUnion mutation are atomic. Without this, a project could
    // be deleted between the read and write, or a stale read could be used
    // to write to a non-existent project.
    await admin.firestore().runTransaction(async (tx) => {
      const projectSnap = await tx.get(projectRef);
      if (!projectSnap.exists) {
        const err: any = new Error('Project not found');
        err.statusCode = 404;
        throw err;
      }
      const inviteSnap = await tx.get(inviteDoc.ref);
      const inviteFresh = inviteSnap.data() as any;
      if (!inviteSnap.exists || !inviteFresh || inviteFresh.status !== 'pending') {
        const err: any = new Error('Invitation not found or already used');
        err.statusCode = 404;
        throw err;
      }
      // Re-validate inside the tx in case of concurrent mutation.
      if (inviteFresh.projectId !== invite.projectId) {
        const err: any = new Error('Invitation project mismatch');
        err.statusCode = 403;
        throw err;
      }
      tx.update(projectRef, {
        members: admin.firestore.FieldValue.arrayUnion(callerUid),
        [`memberRoles.${callerUid}`]: invite.invitedRole,
      });
      tx.update(inviteDoc.ref, {
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
      });
    });

    await auditServerEvent(req, 'projects.inviteAccept', 'projects', {
      projectId: invite.projectId,
      inviteId: inviteDoc.id,
      acceptedRole: invite.invitedRole,
    }, { projectId: invite.projectId });

    // 16th wave (Bucket B) analytics: `project.member.accepted` — fires
    // after the transaction committed (so we never emit on a rolled-back
    // accept). The catalog optional `accept_latency_seconds` is the time
    // between invite emission and acceptance; we compute it from the
    // invitation's `createdAt` (best-effort — falls back to `undefined`
    // when the field is missing or unparseable, which keeps the dashboard
    // honest about historical rows that lack the timestamp).
    try {
      const createdAt = typeof invite.createdAt === 'string' ? Date.parse(invite.createdAt) : NaN;
      const latency = Number.isFinite(createdAt) && createdAt > 0
        ? Math.max(0, Math.floor((Date.now() - createdAt) / 1000))
        : undefined;
      await serverAnalytics.track('project.member.accepted', {
        accepted_role: mapDomainRole(invite.invitedRole),
        ...(latency !== undefined ? { accept_latency_seconds: latency } : {}),
      });
    } catch { /* analytics must never break user flow */ }

    return res.json({ success: true, projectId: invite.projectId, role: invite.invitedRole });
  } catch (error: any) {
    if (error && typeof error.statusCode === 'number') {
      return res.status(error.statusCode).json({ error: error.message });
    }
    logger.error('invitation_accept_failed', error);
    sentryCapture(error, { endpoint: '/api/invitations/:token/accept', tags: { method: 'POST', uid: callerUid } });
    return res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    });
  }
});
