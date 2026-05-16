// Praeventio Guard â€” Round 16 R5 Phase 1 split.
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
// Round 14 (A5 audit) â€” projectId-from-body is membership-checked so a
// caller on project A cannot pollute project B's compliance trail. The check
// reuses the pure `assertProjectMember(uid, projectId, db)` helper from
// `src/services/auth/projectMembership.ts`. We keep the inline check here
// (rather than the new `assertProjectMemberFromBody()` middleware wrapper)
// because the route also accepts the absence of a projectId, and the
// downstream Firestore write needs the validated `projectId ?? null`.
//
// Mounted at `/api` in server.ts. Final path preserved:
//   â€¢ POST /api/audit-log
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
import { captureRouteError } from '../middleware/captureRouteError.js';

const router = Router();

router.post('/audit-log', verifyAuth, async (req, res) => {
  const callerUid = req.user.uid;
  const callerEmail: string | null = req.user.email ?? null;
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

  // Round 14 â€” A5 audit found projectId-from-body without membership check.
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
    captureRouteError(error, 'audit.log_write', { uid: callerUid, action });
    res.status(500).json({
      error: 'Audit log write failed',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

// ─── GET /api/audit-log ─────────────────────────────────────────────────────
// Codex fake fix §2.2 (2026-05-15): antes la página AuditTrail.tsx
// mostraba 5 entradas hardcoded tras `setTimeout(1500)`. Esto era
// "false completeness" peligrosa para compliance (ISO 45001 §10.2 exige
// audit trail real). Este endpoint expone los audit_logs persistidos
// por el POST de arriba, scoped al tenant + opcionalmente al project.
//
// Query params:
//   ?projectId=PID  — filtra por proyecto (membresía verificada)
//   ?limit=N        — max 100, default 50
//   ?module=NAME    — filtra por módulo
//   ?since=ISO_DATE — solo entradas posteriores
router.get('/audit-log', verifyAuth, async (req, res) => {
  const callerUid = req.user.uid;
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  const moduleFilter = typeof req.query.module === 'string' ? req.query.module : undefined;
  const sinceIso = typeof req.query.since === 'string' ? req.query.since : undefined;
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));

  // Membership check si se pidió un projectId específico
  if (projectId) {
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
    let query = admin
      .firestore()
      .collection('audit_logs')
      .orderBy('timestamp', 'desc')
      .limit(limit);

    if (projectId) {
      query = query.where('projectId', '==', projectId) as typeof query;
    } else {
      // Sin projectId → solo logs del propio usuario (no exponer trail de otros)
      query = query.where('userId', '==', callerUid) as typeof query;
    }

    if (moduleFilter) {
      query = query.where('module', '==', moduleFilter) as typeof query;
    }

    if (sinceIso) {
      const sinceDate = new Date(sinceIso);
      if (!Number.isNaN(sinceDate.getTime())) {
        query = query.where(
          'timestamp',
          '>=',
          admin.firestore.Timestamp.fromDate(sinceDate),
        ) as typeof query;
      }
    }

    const snap = await query.get();
    const entries = snap.docs.map((doc) => {
      const data = doc.data();
      // ISO string para que el cliente no tenga que convertir Timestamps
      const ts = data.timestamp?.toDate?.() ?? null;
      return {
        id: doc.id,
        action: data.action,
        module: data.module,
        details: data.details ?? {},
        userId: data.userId,
        userEmail: data.userEmail ?? null,
        projectId: data.projectId ?? null,
        timestamp: ts ? ts.toISOString() : null,
        ip: data.ip ?? null,
      };
    });
    return res.json({ entries, count: entries.length });
  } catch (error: any) {
    logger.error('audit_log_read_failed', { uid: callerUid, projectId, message: error?.message });
    captureRouteError(error, 'audit.log_read', { uid: callerUid, projectId });
    return res.status(500).json({
      error: 'Audit log read failed',
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

export default router;
