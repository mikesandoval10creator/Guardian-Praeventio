// Praeventio Guard — F.6 Modo Sin Señal para Inspecciones (offline-first).
//
// Endpoints dedicados para `/api/sprint-k/:projectId/inspections*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// Bridges el servicio puro `offlineInspectionService` a una superficie
// CRUD project-scoped para sync diferida desde IndexedDB.
//
// Storage path: `tenants/{tid}/projects/{pid}/inspections/{id}`.
// One document per inspection session, observations en subarray.
//
// 4 endpoints:
//   GET  /:projectId/inspections[?status=all|in_progress|completed]
//        → listing top-200 ordenado newest-first (con missing-index
//          fallback a fetch+sort JS)
//   POST /:projectId/inspections                              → start
//   POST /:projectId/inspections/:id/observations             → append
//   POST /:projectId/inspections/:id/complete                 → close
//
// Codex P1+P2 fixes preservados (PR #322):
//   - No swallow filtered-read failures (FAILED_PRECONDITION-only fallback)
//   - Observations append vía Firestore transaction (sin race conditions)
//   - Idempotencia 3-way: same content → 200 dup, completed retry → 200,
//     content mismatch → 409 id_conflict, completed con nuevo id → 409

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

const router = Router();

// ── Guard helpers ─────────────────────────────────────────────────────

async function resolveTenantId(
  callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  const members = await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .where('uid', '==', callerUid)
    .limit(1)
    .get();
  if (!members.empty) {
    const tid = members.docs[0]?.data()?.tenantId;
    if (typeof tid === 'string') return tid;
  }
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
  const tenantId = await resolveTenantId(
    callerUid,
    projectId,
    admin.firestore(),
  );
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// ── Stored shapes ─────────────────────────────────────────────────────

const INSPECTION_STATUSES = ['in_progress', 'completed'] as const;
type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

interface StoredInspectionObservation {
  observationId: string;
  itemId?: string;
  notes?: string;
  photoStoragePath?: string;
  locationLatLng?: { lat: number; lng: number };
  recordedAt: string;
  recordedBy: string;
}

interface StoredInspection {
  id: string;
  templateId: string;
  responsibleUid: string;
  status: InspectionStatus;
  startedAt: string;
  startedBy: string;
  completedAt?: string;
  observations: StoredInspectionObservation[];
}

// ── GET /:projectId/inspections ───────────────────────────────────────

router.get('/:projectId/inspections', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const rawStatus =
      typeof req.query.status === 'string' ? req.query.status : 'all';
    const statusFilter: InspectionStatus | 'all' = (
      ['all', ...INSPECTION_STATUSES] as readonly string[]
    ).includes(rawStatus)
      ? (rawStatus as InspectionStatus | 'all')
      : 'all';

    const baseRef = db.collection(
      `tenants/${g.tenantId}/projects/${projectId}/inspections`,
    );

    const mapDocs = (
      snap: admin.firestore.QuerySnapshot,
    ): StoredInspection[] =>
      snap.docs.map((d) => {
        const data = d.data() as Omit<StoredInspection, 'id'>;
        return {
          id: d.id,
          ...data,
          observations: Array.isArray(data.observations)
            ? data.observations
            : [],
        };
      });

    const FAILED_PRECONDITION = 9;
    const isMissingIndexError = (err: unknown): boolean => {
      if (!err || typeof err !== 'object') return false;
      const e = err as { code?: number | string; message?: string };
      if (
        e.code === FAILED_PRECONDITION ||
        e.code === 'failed-precondition'
      ) {
        return true;
      }
      return (
        typeof e.message === 'string' &&
        /requires an index|FAILED_PRECONDITION/i.test(e.message)
      );
    };

    let inspections: StoredInspection[];
    try {
      let q: admin.firestore.Query = baseRef;
      if (statusFilter !== 'all') {
        q = q.where('status', '==', statusFilter);
      }
      const snap = await q.orderBy('startedAt', 'desc').limit(200).get();
      inspections = mapDocs(snap);
    } catch (err) {
      if (!isMissingIndexError(err)) {
        throw err;
      }
      logger.warn?.('offlineInspections.list.index_fallback', {
        statusFilter,
      });
      let q: admin.firestore.Query = baseRef;
      if (statusFilter !== 'all') {
        q = q.where('status', '==', statusFilter);
      }
      const snap = await q.limit(500).get();
      inspections = mapDocs(snap)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
        .slice(0, 200);
    }

    return res.json({ inspections });
  } catch (err) {
    logger.error?.('offlineInspections.list.error', err);
    captureRouteError(err, 'offlineInspections.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /:projectId/inspections (start) ──────────────────────────────

const inspectionStartSchema = z.object({
  id: z.string().min(1).max(120),
  templateId: z.string().min(1).max(200),
  responsibleUid: z.string().min(1).max(200),
  startedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/inspections',
  verifyAuth,
  validate(inspectionStartSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof inspectionStartSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/inspections`,
        )
        .doc(body.id);
      const existing = await docRef.get();
      if (existing.exists) {
        const data = existing.data() as Omit<StoredInspection, 'id'>;
        return res
          .status(200)
          .json({ ok: true, inspection: { id: existing.id, ...data } });
      }
      const now = body.startedAt ?? new Date().toISOString();
      const payload: StoredInspection = {
        id: body.id,
        templateId: body.templateId,
        responsibleUid: body.responsibleUid,
        status: 'in_progress',
        startedAt: now,
        startedBy: callerUid,
        observations: [],
      };
      await docRef.set(payload, { merge: true });
      return res.status(201).json({ ok: true, inspection: payload });
    } catch (err) {
      logger.error?.('offlineInspections.start.error', err);
      captureRouteError(err, 'offlineInspections.start');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/inspections/:id/observations ─────────────────────

const inspectionObservationSchema = z.object({
  observationId: z.string().min(1).max(200),
  itemId: z.string().min(1).max(200).optional(),
  notes: z.string().max(4000).optional(),
  photoStoragePath: z.string().min(1).max(500).optional(),
  locationLatLng: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
  recordedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/inspections/:inspectionId/observations',
  verifyAuth,
  validate(inspectionObservationSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, inspectionId } = req.params;
    const body = req.body as z.infer<typeof inspectionObservationSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/inspections`,
        )
        .doc(inspectionId);

      type ObservationCommitOutcome =
        | {
            kind: 'created';
            observation: StoredInspectionObservation;
            status: 201;
          }
        | {
            kind: 'duplicate';
            observation: StoredInspectionObservation;
            status: 200;
          }
        | { kind: 'not_found' }
        | { kind: 'completed_new_id' }
        | { kind: 'id_conflict' };

      const observationsEqual = (
        a: StoredInspectionObservation,
        b: StoredInspectionObservation,
      ): boolean => {
        if ((a.itemId ?? null) !== (b.itemId ?? null)) return false;
        if ((a.notes ?? null) !== (b.notes ?? null)) return false;
        if (
          (a.photoStoragePath ?? null) !==
          (b.photoStoragePath ?? null)
        ) {
          return false;
        }
        const aLoc = a.locationLatLng;
        const bLoc = b.locationLatLng;
        if (aLoc && bLoc) {
          if (aLoc.lat !== bLoc.lat || aLoc.lng !== bLoc.lng)
            return false;
        } else if (Boolean(aLoc) !== Boolean(bLoc)) {
          return false;
        }
        return true;
      };

      const outcome = await db.runTransaction<ObservationCommitOutcome>(
        async (tx) => {
          const snap = await tx.get(docRef);
          if (!snap.exists) {
            return { kind: 'not_found' };
          }
          const existing = snap.data() as Omit<StoredInspection, 'id'>;
          const prev = Array.isArray(existing.observations)
            ? existing.observations
            : [];
          const existingSameId = prev.find(
            (o: StoredInspectionObservation) =>
              o.observationId === body.observationId,
          );

          const candidate: StoredInspectionObservation = {
            observationId: body.observationId,
            recordedAt:
              body.recordedAt ??
              existingSameId?.recordedAt ??
              new Date().toISOString(),
            recordedBy: existingSameId?.recordedBy ?? callerUid,
            ...(body.itemId !== undefined
              ? { itemId: body.itemId }
              : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
            ...(body.photoStoragePath !== undefined
              ? { photoStoragePath: body.photoStoragePath }
              : {}),
            ...(body.locationLatLng !== undefined
              ? { locationLatLng: body.locationLatLng }
              : {}),
          };

          if (existing.status === 'completed') {
            if (existingSameId) {
              return {
                kind: 'duplicate',
                observation: existingSameId,
                status: 200,
              };
            }
            return { kind: 'completed_new_id' };
          }

          if (existingSameId) {
            if (observationsEqual(existingSameId, candidate)) {
              return {
                kind: 'duplicate',
                observation: existingSameId,
                status: 200,
              };
            }
            return { kind: 'id_conflict' };
          }

          const next = [...prev, candidate];
          tx.set(docRef, { observations: next }, { merge: true });
          return {
            kind: 'created',
            observation: candidate,
            status: 201,
          };
        },
      );

      if (outcome.kind === 'not_found') {
        return res.status(404).json({ error: 'inspection_not_found' });
      }
      if (outcome.kind === 'completed_new_id') {
        return res
          .status(409)
          .json({ error: 'inspection_already_completed' });
      }
      if (outcome.kind === 'id_conflict') {
        return res.status(409).json({ error: 'observation_id_conflict' });
      }
      return res
        .status(outcome.status)
        .json({ ok: true, observation: outcome.observation });
    } catch (err) {
      logger.error?.('offlineInspections.observation.error', err);
      captureRouteError(err, 'offlineInspections.observation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/inspections/:id/complete ─────────────────────────

const inspectionCompleteSchema = z.object({
  completedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/inspections/:inspectionId/complete',
  verifyAuth,
  validate(inspectionCompleteSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, inspectionId } = req.params;
    const body = req.body as z.infer<typeof inspectionCompleteSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/inspections`,
        )
        .doc(inspectionId);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'inspection_not_found' });
      }
      const existing = snap.data() as Omit<StoredInspection, 'id'>;
      if (existing.status === 'completed') {
        return res.status(200).json({
          ok: true,
          inspection: { id: snap.id, ...existing },
        });
      }
      const completedAt = body.completedAt ?? new Date().toISOString();
      await docRef.set(
        { status: 'completed', completedAt },
        { merge: true },
      );
      return res.status(200).json({
        ok: true,
        inspection: {
          id: snap.id,
          ...existing,
          status: 'completed',
          completedAt,
        },
      });
    } catch (err) {
      logger.error?.('offlineInspections.complete.error', err);
      captureRouteError(err, 'offlineInspections.complete');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
