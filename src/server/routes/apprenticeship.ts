// Praeventio Guard — §244-250 Aprendices + Mentoría + Autorización Progresiva.
//
// Endpoint dedicado para `/api/sprint-k/:projectId/apprentices*` y
// `/api/sprint-k/:projectId/mentors/availability`. Migrado del monolito
// (2026-05-17) — Sprint K reformulation.
//
// 5 endpoints:
//   GET  /:projectId/apprentices                     → lista
//   POST /:projectId/apprentices                     → registrar (cap mentor=3)
//   POST /:projectId/apprentices/:uid/authorize      → subir nivel autorización
//   POST /:projectId/apprentices/:uid/expose         → registrar exposición
//   GET  /:projectId/mentors/availability            → carga actual mentores

import { randomBytes } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────

export const APPRENTICE_ROLES = [
  'aprendiz',
  'nuevo_ingreso',
  'practicante',
  'trabajador_general',
] as const;

export type ApprenticeRole = (typeof APPRENTICE_ROLES)[number];
export type ApprenticeAuthLevel = 'none' | 'observer' | 'supervised' | 'autonomous';
export type ApprenticeExposureOutcome = 'success' | 'partial' | 'unsafe';

export interface ApprenticeRecentExposure {
  id: string;
  taskKind: string;
  recordedAt: string;
  supervisedBy: string;
  outcome: ApprenticeExposureOutcome;
}

export interface StoredApprentice {
  workerUid: string;
  mentorUid: string;
  role: ApprenticeRole;
  startDate: string;
  currentLevel: ApprenticeAuthLevel;
  taskAuthorizations: Record<string, ApprenticeAuthLevel>;
  progress: number;
  recentExposures: ApprenticeRecentExposure[];
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

interface StoredExposure {
  id: string;
  workerUid: string;
  taskKind: string;
  supervisedBy: string;
  outcome: ApprenticeExposureOutcome;
  recordedAt: string;
  notes?: string;
  createdAt: string;
  createdBy: string;
}

// ── Guard ─────────────────────────────────────────────────────────────

async function resolveTenantId(
  _callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  return null;
}

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<{ tenantId: string } | null> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return null;
    }
    throw err;
  }
  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// ── Endpoint 1: GET list apprentices ──────────────────────────────────

router.get('/:projectId/apprentices', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'project_id_required' });
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const snap = await db
      .collection(`tenants/${g.tenantId}/projects/${projectId}/apprentices`)
      .limit(500)
      .get();
    const apprentices = snap.docs.map((d) => ({
      ...(d.data() as Omit<StoredApprentice, 'workerUid'>),
      workerUid: d.id,
    }));
    return res.json({ apprentices });
  } catch (err) {
    logger.error?.('sprintK.apprentices.list.error', err);
    captureRouteError(err, 'sprintK.apprentices.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── Endpoint 2: POST register apprentice ──────────────────────────────

const registerSchema = z.object({
  uid: z.string().min(1).max(120),
  mentorUid: z.string().min(1).max(120),
  role: z.enum(APPRENTICE_ROLES).default('aprendiz'),
  startDate: z.string().min(10),
});

router.post(
  '/:projectId/apprentices',
  verifyAuth,
  validate(registerSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!projectId) return res.status(400).json({ error: 'project_id_required' });
    const body = req.body as z.infer<typeof registerSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const apprenticeRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/apprentices`)
        .doc(body.uid);

      // §245 — mentor load cap: 3 simultáneos máximo.
      const currentLoadSnap = await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/apprentices`)
        .where('mentorUid', '==', body.mentorUid)
        .get()
        .catch(() => null);
      if (currentLoadSnap && currentLoadSnap.size >= 3) {
        const alreadyAssigned = currentLoadSnap.docs.some((d) => d.id === body.uid);
        if (!alreadyAssigned) {
          return res.status(409).json({
            error: 'mentor_at_capacity',
            mentorUid: body.mentorUid,
            currentLoad: currentLoadSnap.size,
          });
        }
      }

      const payload: StoredApprentice = {
        workerUid: body.uid,
        mentorUid: body.mentorUid,
        role: body.role,
        startDate: body.startDate,
        currentLevel: 'none',
        taskAuthorizations: {},
        progress: 0,
        recentExposures: [],
        createdAt: now,
        createdBy: callerUid,
      };
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await apprenticeRef.set(cleaned, { merge: true });
      return res.status(201).json({ ok: true, apprentice: payload });
    } catch (err) {
      logger.error?.('sprintK.apprentices.register.error', err);
      captureRouteError(err, 'sprintK.apprentices.register');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── Endpoint 3: POST authorize (level up) ─────────────────────────────

const authorizeSchema = z.object({
  taskKind: z.string().min(1).max(200),
  toLevel: z.enum(['observer', 'supervised', 'autonomous']),
  signedByUid: z.string().min(1).max(120),
  evidence: z.string().min(1).max(2000),
});

router.post(
  '/:projectId/apprentices/:uid/authorize',
  verifyAuth,
  validate(authorizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, uid } = req.params;
    if (!projectId || !uid) return res.status(400).json({ error: 'invalid_params' });
    const body = req.body as z.infer<typeof authorizeSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const apprenticeRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/apprentices`)
        .doc(uid);
      // CLAUDE.md #19: this is a read-modify-write on the same apprentice — the
      // get() of the apprentice + the two set()s (authorizations subdoc + the
      // parent doc's taskAuthorizations/progress/currentLevel) must run inside a
      // transaction. Otherwise two concurrent authorizes for the same apprentice
      // could read the same base state and race to an inconsistent
      // taskAuthorizations/progress/currentLevel. The validation reads run
      // inside the txn and surface their outcome via a discriminated result so
      // the 404/403 paths still map to clean HTTP responses.
      type AuthorizeResult =
        | { kind: 'not_found' }
        | { kind: 'signer_mismatch' }
        | { kind: 'ok'; currentLevel: ApprenticeAuthLevel; progress: number };
      const result = await db.runTransaction<AuthorizeResult>(async (txn) => {
        const snap = await txn.get(apprenticeRef);
        if (!snap.exists) {
          return { kind: 'not_found' };
        }
        const apprentice = snap.data() as StoredApprentice;
        // Server-trusted: mentorUid debe coincidir con signedByUid claimed
        // (anti-impersonation — el mentor está registrado en el aprendiz).
        if (apprentice.mentorUid !== body.signedByUid) {
          return { kind: 'signer_mismatch' };
        }
        const now = new Date().toISOString();
        const updatedAuthorizations = {
          ...apprentice.taskAuthorizations,
          [body.taskKind]: body.toLevel,
        };
        // Progress: simple ratio entre tasks autorizadas y total (mínimo 5
        // tasks para considerar el aprendizaje completo).
        const authorizedCount = Object.values(updatedAuthorizations).filter(
          (l) => l === 'supervised' || l === 'autonomous',
        ).length;
        const progress = Math.min(100, Math.round((authorizedCount / 5) * 100));
        // Codex P2 fix: derivar currentLevel del MÁXIMO de todas las
        // autorizaciones, no del último cambio. Una autorización lower
        // para una tarea nueva no debe degradar el nivel global del
        // aprendiz si ya tenía autonomous en otra tarea.
        const levelOrder: Record<ApprenticeAuthLevel, number> = {
          none: 0,
          observer: 1,
          supervised: 2,
          autonomous: 3,
        };
        let maxLevel: ApprenticeAuthLevel = 'none';
        for (const l of Object.values(updatedAuthorizations)) {
          if (levelOrder[l as ApprenticeAuthLevel] > levelOrder[maxLevel]) {
            maxLevel = l as ApprenticeAuthLevel;
          }
        }
        const currentLevel: ApprenticeAuthLevel = maxLevel;
        // Codex P2 fix: persistir authorization en subcollection para
        // audit trail (signedByUid, evidence, recordedBy por cada
        // cambio de nivel).
        const authId = `auth_${Date.now()}_${randomBytes(4).toString('hex')}`;
        txn.set(apprenticeRef.collection('authorizations').doc(authId), {
          id: authId,
          taskKind: body.taskKind,
          toLevel: body.toLevel,
          signedByUid: body.signedByUid,
          evidence: body.evidence,
          recordedBy: callerUid,
          recordedAt: now,
        });
        txn.set(
          apprenticeRef,
          {
            taskAuthorizations: updatedAuthorizations,
            progress,
            currentLevel,
            updatedAt: now,
          },
          { merge: true },
        );
        return { kind: 'ok', currentLevel, progress };
      });
      if (result.kind === 'not_found') {
        return res.status(404).json({ error: 'apprentice_not_found' });
      }
      if (result.kind === 'signer_mismatch') {
        return res.status(403).json({ error: 'signer_not_assigned_mentor' });
      }
      return res.json({
        ok: true,
        workerUid: uid,
        taskKind: body.taskKind,
        toLevel: body.toLevel,
        currentLevel: result.currentLevel,
        progress: result.progress,
      });
    } catch (err) {
      logger.error?.('sprintK.apprentices.authorize.error', err);
      captureRouteError(err, 'sprintK.apprentices.authorize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── Endpoint 4: POST expose (registrar exposición a tarea) ────────────

const exposeSchema = z.object({
  taskKind: z.string().min(1).max(200),
  supervisedBy: z.string().min(1).max(120),
  outcome: z.enum(['success', 'partial', 'unsafe']),
  recordedAt: z.string().min(10).optional(),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/apprentices/:uid/expose',
  verifyAuth,
  validate(exposeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, uid } = req.params;
    if (!projectId || !uid) return res.status(400).json({ error: 'invalid_params' });
    const body = req.body as z.infer<typeof exposeSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const apprenticeRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/apprentices`)
        .doc(uid);
      const snap = await apprenticeRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'apprentice_not_found' });
      }
      const id = `exp_${Date.now()}_${randomUUID()}`;
      const exposure: StoredExposure = {
        id,
        workerUid: uid,
        taskKind: body.taskKind,
        supervisedBy: body.supervisedBy,
        outcome: body.outcome,
        recordedAt: body.recordedAt ?? now,
        notes: body.notes,
        createdAt: now,
        createdBy: callerUid,
      };
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(exposure)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await apprenticeRef.collection('exposures').doc(id).set(cleaned);
      // Touch parent for cache invalidation.
      await apprenticeRef.set({ updatedAt: now }, { merge: true });
      return res.status(201).json({ ok: true, exposure });
    } catch (err) {
      logger.error?.('sprintK.apprentices.expose.error', err);
      captureRouteError(err, 'sprintK.apprentices.expose');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── Endpoint 5: GET mentor availability ───────────────────────────────

router.get('/:projectId/mentors/availability', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'project_id_required' });
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const snap = await db
      .collection(`tenants/${g.tenantId}/projects/${projectId}/apprentices`)
      .limit(500)
      .get()
      .catch(() => null);
    const apprentices = snap
      ? snap.docs.map((d) => ({
          ...(d.data() as Omit<StoredApprentice, 'workerUid'>),
          workerUid: d.id,
        }))
      : [];

    const byMentor = new Map<
      string,
      { mentorUid: string; apprenticeUids: string[]; load: number }
    >();
    for (const a of apprentices) {
      const entry = byMentor.get(a.mentorUid) ?? {
        mentorUid: a.mentorUid,
        apprenticeUids: [],
        load: 0,
      };
      entry.apprenticeUids.push(a.workerUid);
      entry.load = entry.apprenticeUids.length;
      byMentor.set(a.mentorUid, entry);
    }

    const MAX = 3;
    const mentors = Array.from(byMentor.values()).map((m) => ({
      mentorUid: m.mentorUid,
      apprenticeUids: m.apprenticeUids,
      currentLoad: m.load,
      maxLoad: MAX,
      available: m.load < MAX,
      availableSlots: Math.max(0, MAX - m.load),
    }));
    mentors.sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return a.currentLoad - b.currentLoad;
    });

    return res.json({ mentors, maxLoad: MAX });
  } catch (err) {
    logger.error?.('sprintK.mentors.availability.error', err);
    captureRouteError(err, 'sprintK.mentors.availability');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
