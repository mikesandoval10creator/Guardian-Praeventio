// SPDX-License-Identifier: MIT
// Sprint 15 â€” Organic structure (Crew/Process/Task) write endpoints.
//
// All routes require `verifyAuth`. Routes that touch a specific project are
// gated by `assertProjectMemberFromBody` (membership for the body's
// projectId). Reads happen client-side via Firestore subscriptions gated by
// `firestore.rules`; the server's job is to be the single writer for crews
// and processes (so positive XP economy can never be tampered with from a
// client). Tasks accept member writes since Firestore rules already pin
// shape.
//
// On-the-wire paths (mounted via `app.use('/api', organicRouter)`):
//   â€¢ POST /api/crews
//   â€¢ POST /api/crews/:id/members
//   â€¢ POST /api/processes
//   â€¢ POST /api/processes/:id/close
//   â€¢ POST /api/processes/:id/tasks
//   â€¢ POST /api/tasks/:id/done

import { Router } from 'express';
import admin from 'firebase-admin';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { assertProjectMemberFromBody } from '../middleware/assertProjectMemberMiddleware.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  computeProcessCloseXp,
  baseXpForProcessType,
  checkStatusTransition,
} from '../../services/organic/processService.js';
import type { ProcessType, ProcessStatus } from '../../types/organic.js';
import { sentryAdapter } from '../../services/observability/sentryAdapter.js';

const router = Router();

// 60 req/15min keyed on uid is plenty for a planning UI.
const organicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas operaciones. Intenta de nuevo mÃ¡s tarde.' },
});

const VALID_PROCESS_TYPES: ProcessType[] = [
  'concreto', 'fachada', 'movimiento_tierras', 'soldadura', 'mantenimiento',
  'demolicion', 'instalacion_electrica', 'pintura', 'topografia', 'transporte', 'otro',
];

router.post('/crews', verifyAuth, organicLimiter, assertProjectMemberFromBody(), async (req, res) => {
  const uid = req.user!.uid;
  const { projectId, name, memberUids } = req.body ?? {};
  if (typeof projectId !== 'string' || !projectId) {
    return res.status(400).json({ error: 'projectId required' });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }
  if (!Array.isArray(memberUids) || memberUids.some((u) => typeof u !== 'string')) {
    return res.status(400).json({ error: 'memberUids must be string[]' });
  }
  try {
    const db = admin.firestore();
    const docRef = await db.collection('crews').add({
      projectId,
      name: name.trim(),
      memberUids: [...new Set(memberUids)],
      createdAt: new Date().toISOString(),
      createdBy: uid,
      totalProcessesCompleted: 0,
      daysWithoutIncident: 0,
      xp: 0,
      lastIncidentAt: null,
    });
    return res.status(201).json({ success: true, id: docRef.id });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'internal' });
  }
});

router.post('/crews/:id/members', verifyAuth, organicLimiter, async (req, res) => {
  const uid = req.user!.uid;
  const crewId = req.params.id;
  const { memberUid } = req.body ?? {};
  if (typeof memberUid !== 'string' || !memberUid) {
    return res.status(400).json({ error: 'memberUid required' });
  }
  try {
    const db = admin.firestore();
    const ref = db.collection('crews').doc(crewId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'crew not found' });
    const crew = snap.data() as { projectId: string; memberUids: string[] };
    await assertProjectMember(uid, crew.projectId, db);
    if (!crew.memberUids.includes(memberUid)) {
      await ref.update({ memberUids: [...crew.memberUids, memberUid] });
    }
    return res.json({ success: true });
  } catch (err: any) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    return res.status(500).json({ error: err?.message ?? 'internal' });
  }
});

router.post('/processes', verifyAuth, organicLimiter, assertProjectMemberFromBody(), async (req, res) => {
  const { crewId, projectId, type, name, description, plannedEndDate } = req.body ?? {};
  if (typeof crewId !== 'string' || !crewId) {
    return res.status(400).json({ error: 'crewId required' });
  }
  if (typeof projectId !== 'string' || !projectId) {
    return res.status(400).json({ error: 'projectId required' });
  }
  if (!VALID_PROCESS_TYPES.includes(type)) {
    return res.status(400).json({ error: 'invalid type' });
  }
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }
  try {
    const db = admin.firestore();
    const docRef = await db.collection('processes').add({
      crewId,
      projectId,
      type,
      name: name.trim(),
      description: typeof description === 'string' ? description : '',
      startedAt: new Date().toISOString(),
      endedAt: null,
      plannedEndDate: typeof plannedEndDate === 'string' ? plannedEndDate : null,
      status: 'active',
      complianceScore: 100,
      incidentsDuringProcess: 0,
      alertsResponded: 0,
      xpAwardedAtClose: null,
    });
    return res.status(201).json({ success: true, id: docRef.id });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'internal' });
  }
});

router.post('/processes/:id/close', verifyAuth, organicLimiter, async (req, res) => {
  const uid = req.user!.uid;
  const processId = req.params.id;
  const { complianceScore } = req.body ?? {};
  if (typeof complianceScore !== 'number' || !Number.isFinite(complianceScore)) {
    return res.status(400).json({ error: 'complianceScore must be a number' });
  }
  try {
    const db = admin.firestore();
    const procRef = db.collection('processes').doc(processId);
    const procSnap = await procRef.get();
    if (!procSnap.exists) return res.status(404).json({ error: 'process not found' });
    const proc = procSnap.data() as {
      projectId: string; crewId: string; type: ProcessType;
      alertsResponded: number; status: string;
    };
    await assertProjectMember(uid, proc.projectId, db);
    if (proc.status === 'completed' || proc.status === 'aborted') {
      return res.status(409).json({ error: 'already terminal' });
    }
    const xp = computeProcessCloseXp(proc.type, complianceScore, proc.alertsResponded);
    const endedAt = new Date().toISOString();
    await procRef.update({
      status: 'completed',
      endedAt,
      complianceScore: Math.max(0, Math.min(100, complianceScore)),
      xpAwardedAtClose: xp,
    });
    // Award crew XP atomically.
    const crewRef = db.collection('crews').doc(proc.crewId);
    await db.runTransaction(async (tx) => {
      const cs = await tx.get(crewRef);
      if (!cs.exists) return;
      const c = cs.data() as { xp: number; totalProcessesCompleted: number };
      tx.update(crewRef, {
        xp: (c.xp ?? 0) + xp,
        totalProcessesCompleted: (c.totalProcessesCompleted ?? 0) + 1,
      });
    });
    return res.json({ success: true, xpAwarded: xp, baseXp: baseXpForProcessType(proc.type) });
  } catch (err: any) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    return res.status(500).json({ error: err?.message ?? 'internal' });
  }
});

router.post('/processes/:id/status', verifyAuth, organicLimiter, async (req, res) => {
  // Sprint 16 â€” pause/resume support for ProcessDetailModal.
  // Sprint 17a â€” uses pure `checkStatusTransition` guard, audits the
  // transition, and emits a Sentry breadcrumb for ops visibility.
  const uid = req.user!.uid;
  const processId = req.params.id;
  const { status } = req.body ?? {};
  if (status !== 'active' && status !== 'paused') {
    return res.status(400).json({ error: 'status must be active|paused' });
  }
  try {
    const db = admin.firestore();
    const ref = db.collection('processes').doc(processId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'process not found' });
    const proc = snap.data() as { projectId: string; status: ProcessStatus };
    await assertProjectMember(uid, proc.projectId, db);

    const check = checkStatusTransition(proc.status, status as ProcessStatus);
    if (check.ok === false) {
      if (check.reason === 'terminal') {
        return res.status(409).json({ error: 'process is terminal' });
      }
      if (check.reason === 'noop') {
        return res.json({ success: true, status, noop: true });
      }
      return res.status(400).json({ error: 'invalid status transition' });
    }

    await ref.update({ status });

    // Sprint 17a â€” audit + ops breadcrumb. Both are best-effort: a logging
    // failure must never block the user-facing state change.
    try {
      await db.collection('audit_logs').add({
        action: 'process.status_change',
        module: 'organic',
        details: { processId, from: proc.status, to: status },
        userId: uid,
        projectId: proc.projectId,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch {
      /* non-fatal */
    }
    try {
      sentryAdapter.addBreadcrumb({
        category: 'organic.process',
        level: 'info',
        message: `process ${processId} ${proc.status} -> ${status}`,
        timestamp: new Date(),
        data: { processId, from: proc.status, to: status, projectId: proc.projectId },
      });
    } catch {
      /* non-fatal */
    }

    return res.json({ success: true, status });
  } catch (err: any) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    return res.status(500).json({ error: err?.message ?? 'internal' });
  }
});

router.post('/processes/:id/tasks', verifyAuth, organicLimiter, async (req, res) => {
  const uid = req.user!.uid;
  const processId = req.params.id;
  const { description, date, assignedUids } = req.body ?? {};
  if (typeof description !== 'string' || !description.trim()) {
    return res.status(400).json({ error: 'description required' });
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  try {
    const db = admin.firestore();
    const procSnap = await db.collection('processes').doc(processId).get();
    if (!procSnap.exists) return res.status(404).json({ error: 'process not found' });
    const proc = procSnap.data() as { projectId: string; crewId: string };
    await assertProjectMember(uid, proc.projectId, db);
    const docRef = await db.collection('tasks').add({
      processId,
      crewId: proc.crewId,
      projectId: proc.projectId,
      description: description.trim(),
      date,
      assignedUids: Array.isArray(assignedUids) ? assignedUids.filter((u) => typeof u === 'string') : [],
      status: 'pending',
      completedAt: null,
    });
    return res.status(201).json({ success: true, id: docRef.id });
  } catch (err: any) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    return res.status(500).json({ error: err?.message ?? 'internal' });
  }
});

/**
 * Sprint 16 â€” POST /api/predictive-alerts/ack
 *   body: { projectId, crewId, generatorId }
 *
 * Marks a predictive alert as "Atendida" by the calling user's crew,
 * increments `processes.alertsResponded` for any active process owned
 * by the crew, and awards 30 XP (XP_AMOUNTS.evadir_riesgo_predictivo)
 * to the crew. Always positive â€” alerts NEVER deduct XP.
 */
router.post('/predictive-alerts/ack', verifyAuth, organicLimiter, async (req, res) => {
  const uid = req.user!.uid;
  const { projectId, crewId, generatorId } = req.body ?? {};
  if (typeof projectId !== 'string' || !projectId) {
    return res.status(400).json({ error: 'projectId required' });
  }
  if (typeof crewId !== 'string' || !crewId) {
    return res.status(400).json({ error: 'crewId required' });
  }
  if (typeof generatorId !== 'string' || !generatorId) {
    return res.status(400).json({ error: 'generatorId required' });
  }
  try {
    const db = admin.firestore();
    await assertProjectMember(uid, projectId, db);

    const crewRef = db.collection('crews').doc(crewId);
    let xpAwarded = 0;
    await db.runTransaction(async (tx) => {
      const cs = await tx.get(crewRef);
      if (!cs.exists) return;
      const c = cs.data() as { xp: number; projectId: string };
      if (c.projectId !== projectId) return; // tenant guard
      tx.update(crewRef, { xp: (c.xp ?? 0) + 30 });
      xpAwarded = 30;
    });

    // Best-effort: increment alertsResponded on any active process for
    // this crew so the close-XP formula picks up the bonus too.
    try {
      const procs = await db
        .collection('processes')
        .where('crewId', '==', crewId)
        .where('status', '==', 'active')
        .limit(1)
        .get();
      if (!procs.empty) {
        const ref = procs.docs[0].ref;
        await ref.update({
          alertsResponded: admin.firestore.FieldValue.increment(1),
        });
      }
    } catch {
      // non-fatal
    }

    // Audit trail (lightweight): record the ack event so the dashboard
    // can show "respondida por la cuadrilla X a las Y".
    try {
      await db.collection('predictive_alert_acks').add({
        projectId,
        crewId,
        generatorId,
        ackedBy: uid,
        ackedAt: admin.firestore.FieldValue.serverTimestamp(),
        xpAwarded,
      });
    } catch {
      // non-fatal
    }

    return res.json({ success: true, xpAwarded, reason: 'evadir_riesgo_predictivo' });
  } catch (err: any) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    return res.status(500).json({ error: err?.message ?? 'internal' });
  }
});

router.post('/tasks/:id/done', verifyAuth, organicLimiter, async (req, res) => {
  const uid = req.user!.uid;
  const taskId = req.params.id;
  try {
    const db = admin.firestore();
    const ref = db.collection('tasks').doc(taskId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'task not found' });
    const t = snap.data() as { projectId: string };
    await assertProjectMember(uid, t.projectId, db);
    await ref.update({ status: 'done', completedAt: new Date().toISOString() });
    return res.json({ success: true });
  } catch (err: any) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    return res.status(500).json({ error: err?.message ?? 'internal' });
  }
});

export default router;
