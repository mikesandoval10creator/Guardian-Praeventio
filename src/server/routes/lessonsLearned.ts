// Praeventio Guard — F.12 Biblioteca de Lecciones Aprendidas.
//
// Endpoint dedicado para `/api/sprint-k/:projectId/lessons`. Migrado del
// monolito `sprintK.ts` (2026-05-18) por la directiva Sprint K reformulation
// (docs/SPRINT_K_REFORMULATED.md): cada feature Sprint K vive en su propio
// archivo de dominio.
//
// Wraps LessonsAdapter (services/lessonsLearned/lessonsFirestoreAdapter):
//   - `tenants/{tid}/lessons/{id}` con scope (`global` | `industry` |
//     `project` | `crew`) y riskCategories[] indexables.
//   - Indexable por `scope` y `riskCategory` (un campo de riskCategories).
//
// 2 endpoints:
//   GET  /:projectId/lessons[?scope=...|riskCategory=...]
//   POST /:projectId/lessons
//
// Aggregation rules:
//   - Sin query params → `listTopAdopted(10)` (las más reutilizadas).
//   - `?scope=...` → `listByScope(scope, 100)`.
//   - `?riskCategory=...` → `listByRiskCategory(category, 50)`.
//     Si ambos vienen, gana `riskCategory` (más específico).
//
// Tenant scope: el archivo de lecciones es **tenant-wide** (no por
// proyecto) — una lección capturada en proyecto A puede aplicarse en
// proyecto B del mismo tenant. Pero el acceso se gatea por
// `assertProjectMember`: solo miembros activos del proyecto consultan.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { LessonsAdapter } from '../../services/lessonsLearned/lessonsFirestoreAdapter.js';

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

// ── GET /:projectId/lessons ───────────────────────────────────────────

router.get('/:projectId/lessons', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new LessonsAdapter(admin.firestore() as any, g.tenantId);
    const scope = typeof req.query.scope === 'string' ? req.query.scope : null;
    const riskCategory =
      typeof req.query.riskCategory === 'string'
        ? req.query.riskCategory
        : null;

    let lessons;
    if (riskCategory) {
      lessons = await adapter.listByRiskCategory(riskCategory);
    } else if (
      scope === 'global' ||
      scope === 'industry' ||
      scope === 'project' ||
      scope === 'crew'
    ) {
      lessons = await adapter.listByScope(scope);
    } else {
      lessons = await adapter.listTopAdopted();
    }
    return res.json({ lessons });
  } catch (err) {
    logger.error?.('lessonsLearned.list.error', err);
    captureRouteError(err, 'lessonsLearned.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /:projectId/lessons ──────────────────────────────────────────

const lessonSchema = z.object({
  id: z.string().min(1),
  summary: z.string().min(3).max(2000),
  preventiveAction: z.string().min(3).max(2000),
  riskCategories: z.array(z.string().min(1)).max(50),
  tags: z.array(z.string().min(1)).max(50),
  scope: z.enum(['global', 'industry', 'project', 'crew']),
  industry: z.string().min(1).max(200).optional(),
  derivedFromIncidentId: z.string().min(1).optional(),
  publishedAt: z.string().min(10),
  adoptionCount: z.number().int().nonnegative(),
});

router.post(
  '/:projectId/lessons',
  verifyAuth,
  validate(lessonSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof lessonSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new LessonsAdapter(admin.firestore() as any, g.tenantId);
      await adapter.save(body);
      // Audit registro (la propia adopción / publicación queda en el doc;
      // este audit captura el actor para forensics).
      await admin
        .firestore()
        .collection(`tenants/${g.tenantId}/audit_logs`)
        .add({
          kind: 'lessons_learned.published',
          projectId,
          lessonId: body.id,
          actorUid: callerUid,
          scope: body.scope,
          riskCategories: body.riskCategories,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch(() => undefined);
      await auditServerEvent(req, 'lessonsLearned.create', 'lessonsLearned', {
        projectId,
        lessonId: body.id,
        scope: body.scope,
      }, { projectId });
      return res.status(201).json({ ok: true });
    } catch (err) {
      logger.error?.('lessonsLearned.create.error', err);
      captureRouteError(err, 'lessonsLearned.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
