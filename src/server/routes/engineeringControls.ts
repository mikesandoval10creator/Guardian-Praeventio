// Praeventio Guard — §42-44 Inventario Controles de Ingeniería + Jerarquía ISO 31000.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/engineering-controls*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// 3 endpoints:
//   GET  /:projectId/engineering-controls[?level=...&riskCategory=...]
//        → list (filtra por level + riskCategory, incluye 'general' como
//          cross-cutting; surface partial_read_failure warning)
//   POST /:projectId/engineering-controls
//        → crear control (transacción con check existe; 409 si dup id)
//   POST /:projectId/engineering-controls/:id/verify
//        → registrar verificación (sólo 'pass' avanza lastVerifiedAt)
//
// Storage path: `tenants/{tid}/projects/{pid}/engineering_controls/{id}`.
// Jerarquía ISO 31000 / 45001:
//   elimination > substitution > engineering > administrative > epp
//
// Codex P1+P2 fixes preservados (PR #319 rounds 1-2):
//   - Transacción create con duplicate detection (409 con stable code)
//   - verifierUid del caller autenticado, NUNCA del body (anti-impersonate)
//   - lastVerifiedAt sólo avanza en 'pass' (fail/observation registran
//     historial pero no resetean vigencia)
//   - riskCategory 'general' actúa como cross-cutting para todos los filtros

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

// ── Types + schemas ───────────────────────────────────────────────────

type EngControlHierarchyLevel =
  | 'elimination'
  | 'substitution'
  | 'engineering'
  | 'administrative'
  | 'epp';

const ENG_CTRL_LEVELS: ReadonlySet<EngControlHierarchyLevel> = new Set([
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'epp',
]);

interface StoredEngineeringControl {
  id: string;
  level: EngControlHierarchyLevel;
  riskCategory: string;
  name: string;
  description: string;
  responsibleUid: string;
  verificationFrequencyDays: number;
  createdAt: string;
  createdBy: string;
  lastVerifiedAt: string | null;
  verifications: Array<{
    verifierUid: string;
    verifiedAt: string;
    result: 'pass' | 'observation' | 'fail';
    evidence?: string;
  }>;
}

class EngineeringControlDuplicateError extends Error {
  readonly controlId: string;
  constructor(controlId: string) {
    super(`engineering control already exists: ${controlId}`);
    this.name = 'EngineeringControlDuplicateError';
    this.controlId = controlId;
  }
}

// ── GET /:projectId/engineering-controls ──────────────────────────────

router.get(
  '/:projectId/engineering-controls',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      let partialReadFailure = false;
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`engineeringControls.read.${label}.failed`, err);
          partialReadFailure = true;
          return [];
        }
      };

      const db = admin.firestore();
      const colRef = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/engineering_controls`,
      );

      const rawLevel =
        typeof req.query.level === 'string' ? req.query.level : 'all';
      const levelParam: 'all' | EngControlHierarchyLevel =
        rawLevel === 'all'
          ? 'all'
          : rawLevel === 'admin'
            ? 'administrative'
            : ENG_CTRL_LEVELS.has(rawLevel as EngControlHierarchyLevel)
              ? (rawLevel as EngControlHierarchyLevel)
              : 'all';
      const riskCategory =
        typeof req.query.riskCategory === 'string'
          ? req.query.riskCategory
          : null;

      const controls = await safeRead('list', async () => {
        const snap = await colRef.get();
        return snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<StoredEngineeringControl, 'id'>),
        }));
      });

      const filtered = controls.filter((c) => {
        if (levelParam !== 'all' && c.level !== levelParam) return false;
        if (
          riskCategory &&
          c.riskCategory !== riskCategory &&
          c.riskCategory !== 'general'
        )
          return false;
        return true;
      });

      return res.json({
        controls: filtered,
        ...(partialReadFailure ? { warning: 'partial_read_failure' } : {}),
      });
    } catch (err) {
      logger.error?.('engineeringControls.list.error', err);
      captureRouteError(err, 'engineeringControls.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/engineering-controls ─────────────────────────────

const engineeringControlCreateSchema = z.object({
  id: z.string().min(1),
  level: z.enum([
    'elimination',
    'substitution',
    'engineering',
    'administrative',
    'epp',
  ]),
  riskCategory: z.string().min(1).max(200),
  name: z.string().min(3).max(300),
  description: z.string().min(3).max(4000),
  responsibleUid: z.string().min(1),
  verificationFrequencyDays: z.number().int().positive().max(3650),
});

router.post(
  '/:projectId/engineering-controls',
  verifyAuth,
  validate(engineeringControlCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<
      typeof engineeringControlCreateSchema
    >;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const doc: StoredEngineeringControl = {
        id: body.id,
        level: body.level,
        riskCategory: body.riskCategory,
        name: body.name,
        description: body.description,
        responsibleUid: body.responsibleUid,
        verificationFrequencyDays: body.verificationFrequencyDays,
        createdAt: new Date().toISOString(),
        createdBy: callerUid,
        lastVerifiedAt: null,
        verifications: [],
      };
      const ref = admin
        .firestore()
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/engineering_controls`,
        )
        .doc(body.id);
      const db = admin.firestore();
      try {
        await db.runTransaction(async (txn) => {
          const existing = await txn.get(ref);
          if (existing.exists) {
            throw new EngineeringControlDuplicateError(body.id);
          }
          txn.create(ref, doc);
        });
      } catch (err) {
        if (err instanceof EngineeringControlDuplicateError) {
          return res.status(409).json({
            error: 'engineering_control_duplicate_id',
            controlId: err.controlId,
          });
        }
        const code = (err as { code?: number | string } | null)?.code;
        if (code === 6 || code === 'ALREADY_EXISTS') {
          return res.status(409).json({
            error: 'engineering_control_duplicate_id',
            controlId: body.id,
          });
        }
        throw err;
      }
      return res.status(201).json({ ok: true, control: doc });
    } catch (err) {
      logger.error?.('engineeringControls.create.error', err);
      captureRouteError(err, 'engineeringControls.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/engineering-controls/:id/verify ──────────────────

const engineeringControlVerifySchema = z.object({
  result: z.enum(['pass', 'observation', 'fail']),
  evidence: z.string().max(4000).optional(),
});

router.post(
  '/:projectId/engineering-controls/:id/verify',
  verifyAuth,
  validate(engineeringControlVerifySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<
      typeof engineeringControlVerifySchema
    >;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const ref = admin
        .firestore()
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/engineering_controls`,
        )
        .doc(id);

      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'control_not_found' });
      }
      const now = new Date().toISOString();
      const entry = {
        verifierUid: callerUid,
        verifiedAt: now,
        result: body.result,
        ...(body.evidence ? { evidence: body.evidence } : {}),
      };
      const updatePayload: {
        verifications: admin.firestore.FieldValue;
        lastVerifiedAt?: string;
      } = {
        verifications: admin.firestore.FieldValue.arrayUnion(entry),
      };
      if (body.result === 'pass') {
        updatePayload.lastVerifiedAt = now;
      }
      await ref.update(updatePayload);
      return res.status(200).json({ ok: true, entry });
    } catch (err) {
      logger.error?.('engineeringControls.verify.error', err);
      captureRouteError(err, 'engineeringControls.verify');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
