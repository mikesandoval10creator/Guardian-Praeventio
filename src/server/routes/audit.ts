// Praeventio Guard — Round 16 R5 Phase 1 split.
//
// Generic /api/audit-log write endpoint used by the SPA to record
// user-initiated actions (sign-ins, downloads, role probes, etc.) with a
// shared schema:
//
//   { actor, action, module, details, projectId?, ts, ip, userAgent }
//
// The endpoint stamps the actor uid + email from the verified token (NOT from
// req.body), so a worker cannot impersonate someone else. action/module are
// validated; `details` is opaque (callers responsible for not putting secrets
// in there).
//
// Round 14 (A5 audit) — projectId-from-body is membership-checked so a
// caller on project A cannot pollute project B's compliance trail. The check
// reuses the pure `assertProjectMember(uid, projectId, db)` helper from
// `src/services/auth/projectMembership.ts`. We keep the inline check here
// (rather than the new `assertProjectMemberFromBody()` middleware wrapper)
// because the route also accepts the absence of a projectId, and the
// downstream Firestore write needs the validated `projectId ?? null`.
//
// Mounted at `/api` in server.ts. Final path preserved:
//   • POST /api/audit-log
//
// Phase 2 (billing) and Phase 3 (curriculum/projects) and Phase 4
// (oauth/gemini) deferred to Round 17/18.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { logger } from '../../utils/logger.js';

const router = Router();

router.post('/audit-log', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const callerEmail: string | null = (req as any).user.email ?? null;
  const { action, module: mod, details, projectId } = req.body ?? {};

  if (typeof action !== 'string' || action.length === 0 || action.length > 64) {
    return res.status(400).json({ error: 'Invalid action' });
  }
  if (typeof mod !== 'string' || mod.length === 0 || mod.length > 64) {
    return res.status(400).json({ error: 'Invalid module' });
  }
  if (
    projectId !== undefined &&
    projectId !== null &&
    (typeof projectId !== 'string' || projectId.length > 128)
  ) {
    return res.status(400).json({ error: 'Invalid projectId' });
  }

  // Round 14 — A5 audit found projectId-from-body without membership check.
  // Without this guard a worker on project A could write an audit entry
  // tagged to project B, polluting B's compliance trail. assertProjectMember
  // throws ProjectMembershipError(403) when uid is neither in members[] nor
  // is the project's createdBy.
  if (typeof projectId === 'string' && projectId.length > 0) {
    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      throw err;
    }
  }

  try {
    await admin.firestore().collection('audit_logs').add({
      action,
      module: mod,
      details: details ?? {},
      userId: callerUid,
      userEmail: callerEmail,
      projectId: projectId ?? null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('audit_log_write_failed', { uid: callerUid, action, message: error?.message });
    res.status(500).json({
      error: 'Audit log write failed',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

export default router;
