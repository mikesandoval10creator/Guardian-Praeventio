// Praeventio Guard — Round 18 Phase 3 split.
//
// Project membership + invitation endpoints extracted from server.ts. The
// 6 routes are split across TWO routers because one set lives under
// `/api/projects/:id/...` and the other under `/api/invitations/...`.
//
// Mount strategy (in server.ts):
//   • app.use('/api/projects', projectsRouter)           ← 4 routes
//   • app.use('/api/invitations', invitationsRouter)     ← 2 routes
//
// Final paths preserved verbatim — DO NOT change:
//   • POST   /api/projects/:id/invite
//   • GET    /api/projects/:id/members
//   • DELETE /api/projects/:id/members/:uid
//   • DELETE /api/projects/:id/invite
//   • GET    /api/invitations/info/:token        (public)
//   • POST   /api/invitations/:token/accept      (verifyAuth)
//
// Authorization model:
//   • Project surfaces: caller must be the project's `createdBy` OR have
//     gerente/admin role. We do NOT use `assertProjectMemberFromParam`
//     here because the existing semantics distinguish "creator" from
//     "member" — only creators can invite/remove. The members LIST
//     endpoint allows any project member (or gerente/admin) to read.
//   • Invitation accept: the caller's email must match the invited email.

import { Router } from 'express';
import admin from 'firebase-admin';
import crypto from 'crypto';
import { Resend } from 'resend';

import { verifyAuth } from '../middleware/verifyAuth.js';

const resend = new Resend(process.env.RESEND_API_KEY);

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
  const callerUid = (req as any).user.uid;
  const { invitedEmail, invitedRole } = req.body;

  if (!invitedEmail || !invitedRole) {
    return res.status(400).json({ error: 'invitedEmail and invitedRole are required' });
  }

  try {
    const projectDoc = await admin.firestore().collection('projects').doc(projectId).get();
    if (!projectDoc.exists) return res.status(404).json({ error: 'Project not found' });

    const projectData = projectDoc.data()!;
    if (projectData.createdBy !== callerUid) {
      const callerRecord = await admin.auth().getUser(callerUid);
      if (
        callerRecord.customClaims?.role !== 'gerente' &&
        callerRecord.customClaims?.role !== 'admin'
      ) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Only the project creator can invite members' });
      }
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

    // Send invitation email — failure does NOT block the response
    try {
      const callerRecord = await admin.auth().getUser(callerUid);
      const inviterName = callerRecord.displayName || callerRecord.email || 'Tu equipo';
      await resend.emails.send({
        from: 'Praeventio Guard <noreply@praeventio.net>',
        to: invitedEmail,
        subject: `${inviterName} te invitó a "${projectData.name || 'un proyecto'}" en Praeventio`,
        html: buildInviteEmailHtml({
          projectName: projectData.name || 'un proyecto',
          inviterName,
          role: invitedRole,
          token,
        }),
      });
    } catch (emailErr) {
      console.warn('Email delivery failed (invitation stored successfully):', emailErr);
    }

    res.json({ success: true, inviteId: inviteRef.id, token, expiresAt });
  } catch (error: any) {
    console.error('Error creating invitation:', error);
    res.status(500).json({
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
  const callerUid = (req as any).user.uid;

  try {
    const projectDoc = await admin.firestore().collection('projects').doc(projectId).get();
    if (!projectDoc.exists) return res.status(404).json({ error: 'Project not found' });

    const projectData = projectDoc.data()!;
    const memberUids: string[] = projectData.members || [];
    const memberRoles: Record<string, string> = projectData.memberRoles || {};

    if (!memberUids.includes(callerUid)) {
      const callerRecord = await admin.auth().getUser(callerUid);
      if (
        callerRecord.customClaims?.role !== 'gerente' &&
        callerRecord.customClaims?.role !== 'admin'
      ) {
        return res.status(403).json({ error: 'Forbidden: Not a project member' });
      }
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

    res.json({ success: true, members: memberDetails, pendingInvitations: invitations });
  } catch (error: any) {
    console.error('Error listing project members:', error);
    res.status(500).json({
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
  const callerUid = (req as any).user.uid;

  try {
    const projectDoc = await admin.firestore().collection('projects').doc(projectId).get();
    if (!projectDoc.exists) return res.status(404).json({ error: 'Project not found' });

    const projectData = projectDoc.data()!;

    const isCreator = projectData.createdBy === callerUid;
    const isSelf = callerUid === targetUid;
    if (!isCreator && !isSelf) {
      const callerRecord = await admin.auth().getUser(callerUid);
      if (
        callerRecord.customClaims?.role !== 'gerente' &&
        callerRecord.customClaims?.role !== 'admin'
      ) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Only the project creator can remove members' });
      }
    }

    if (targetUid === projectData.createdBy) {
      return res.status(400).json({ error: 'Cannot remove the project creator' });
    }

    await admin.firestore().collection('projects').doc(projectId).update({
      members: admin.firestore.FieldValue.arrayRemove(targetUid),
      [`memberRoles.${targetUid}`]: admin.firestore.FieldValue.delete(),
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error removing project member:', error);
    res.status(500).json({
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
  const callerUid = (req as any).user.uid;
  const { inviteId } = req.body;

  if (!inviteId) {
    return res.status(400).json({ error: 'inviteId is required' });
  }

  try {
    const projectDoc = await admin.firestore().collection('projects').doc(projectId).get();
    if (!projectDoc.exists) return res.status(404).json({ error: 'Project not found' });

    const projectData = projectDoc.data()!;
    const isCreator = projectData.createdBy === callerUid;
    if (!isCreator) {
      const callerRecord = await admin.auth().getUser(callerUid);
      if (
        callerRecord.customClaims?.role !== 'gerente' &&
        callerRecord.customClaims?.role !== 'admin'
      ) {
        return res
          .status(403)
          .json({ error: 'Forbidden: Only the project creator can cancel invitations' });
      }
    }

    const inviteDoc = await admin.firestore().collection('invitations').doc(inviteId).get();
    if (!inviteDoc.exists) return res.status(404).json({ error: 'Invitation not found' });
    if (inviteDoc.data()!.projectId !== projectId) {
      return res.status(403).json({ error: 'Invitation does not belong to this project' });
    }

    await inviteDoc.ref.delete();
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error canceling invitation:', error);
    res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    });
  }
});

export default projectsRouter;

// ───────────────────────────────────────────────────────────────────────────
// Invitations router — separate mount because URLs live under
// /api/invitations/... NOT /api/projects/...
// ───────────────────────────────────────────────────────────────────────────
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
    res.json({
      projectName: invite.projectName || 'un proyecto',
      invitedRole: invite.invitedRole,
      invitedEmail: invite.invitedEmail,
      expiresAt: invite.expiresAt,
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/invitations/:token/accept  — invited user accepts
invitationsRouter.post('/:token/accept', verifyAuth, async (req, res) => {
  const { token } = req.params;
  const callerUid = (req as any).user.uid;
  const callerEmail = (req as any).user.email;

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

    const projectRef = admin.firestore().collection('projects').doc(invite.projectId);
    await projectRef.update({
      members: admin.firestore.FieldValue.arrayUnion(callerUid),
      [`memberRoles.${callerUid}`]: invite.invitedRole,
    });

    await inviteDoc.ref.update({ status: 'accepted', acceptedAt: new Date().toISOString() });

    res.json({ success: true, projectId: invite.projectId, role: invite.invitedRole });
  } catch (error: any) {
    console.error('Error accepting invitation:', error);
    res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    });
  }
});
