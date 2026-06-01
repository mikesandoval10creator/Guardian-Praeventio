// Praeventio Guard — §185-190 Base de Conocimiento + Curador + Obsolescencia.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/knowledge-base*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// 4 endpoints:
//   GET  /:projectId/knowledge-base?category=X&search=Y
//   POST /:projectId/knowledge-base
//   POST /:projectId/knowledge-base/:id/use
//   POST /:projectId/knowledge-base/:id/flag-obsolete
//
// Storage: `tenants/{tid}/projects/{pid}/knowledge_base/{id}`.
// Tenant-scoped para reutilización entre proyectos del mismo tenant,
// filtrado server-side por proyecto seleccionado. Los artículos
// `sourceType: 'lesson'` enlazan de vuelta a F.12 sin duplicar storage.
//
// Búsqueda: léxica via `searchArticles()` del motor (client-side al
// endpoint — Firestore sin full-text nativo, queremos determinismo).
// Filtro por categoría: `kind` alias.
// `/use`: incremento atómico viewCount + bump lastReviewedAt.
// `/flag-obsolete`: marca isObsolete=true con auditoría.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
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

// ── Schemas + types ──────────────────────────────────────────────────

const kbCreateSchema = z.object({
  title: z.string().min(3).max(300),
  content: z.string().min(3).max(20_000),
  category: z
    .enum(['glossary', 'faq', 'procedure', 'guide', 'norm_summary'])
    .optional()
    .default('guide'),
  tags: z.array(z.string().min(1).max(100)).max(50).optional().default([]),
  sourceType: z
    .enum(['lesson', 'procedure', 'standard', 'experience'])
    .optional()
    .default('experience'),
});

const kbFlagObsoleteSchema = z.object({
  reason: z.string().min(3).max(2000),
});

type KbDoc = {
  id: string;
  kind: 'glossary' | 'faq' | 'procedure' | 'guide' | 'norm_summary';
  title: string;
  content: string;
  tags: string[];
  lastReviewedAt: string;
  viewCount: number;
  averageRating?: number;
  isObsolete: boolean;
  authorUid: string;
  sourceType?: 'lesson' | 'procedure' | 'standard' | 'experience';
  obsoleteReason?: string;
  obsoleteAt?: string;
};

// ── GET /:projectId/knowledge-base ────────────────────────────────────

router.get('/:projectId/knowledge-base', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const category =
      typeof req.query.category === 'string' &&
      req.query.category.length > 0
        ? req.query.category
        : null;
    const search =
      typeof req.query.search === 'string' &&
      req.query.search.length > 0
        ? req.query.search
        : null;

    const colRef = db
      .collection('tenants')
      .doc(g.tenantId)
      .collection('projects')
      .doc(projectId)
      .collection('knowledge_base');

    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`knowledgeBase.read.${label}.failed`, err);
        return [];
      }
    };

    const projectEntries = await safeRead<KbDoc>('project', async () => {
      const snap = await colRef.get();
      return snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          kind: (typeof data.kind === 'string'
            ? data.kind
            : 'guide') as KbDoc['kind'],
          title: typeof data.title === 'string' ? data.title : '',
          content: typeof data.content === 'string' ? data.content : '',
          tags: Array.isArray(data.tags) ? (data.tags as string[]) : [],
          lastReviewedAt:
            typeof data.lastReviewedAt === 'string'
              ? data.lastReviewedAt
              : new Date(0).toISOString(),
          viewCount:
            typeof data.viewCount === 'number' &&
            Number.isFinite(data.viewCount)
              ? data.viewCount
              : 0,
          averageRating:
            typeof data.averageRating === 'number'
              ? data.averageRating
              : undefined,
          isObsolete: Boolean(data.isObsolete),
          authorUid:
            typeof data.authorUid === 'string'
              ? data.authorUid
              : 'unknown',
          sourceType:
            typeof data.sourceType === 'string'
              ? (data.sourceType as KbDoc['sourceType'])
              : 'experience',
          obsoleteReason:
            typeof data.obsoleteReason === 'string'
              ? data.obsoleteReason
              : undefined,
          obsoleteAt:
            typeof data.obsoleteAt === 'string'
              ? data.obsoleteAt
              : undefined,
        };
      });
    });

    let entries = projectEntries;
    if (category) {
      entries = entries.filter((e) => e.kind === category);
    }

    if (search) {
      const { searchArticles } = await import(
        '../../services/knowledgeBase/knowledgeBaseService.js'
      );
      const results = searchArticles(entries, search, {
        excludeObsolete: false,
      });
      return res.json({
        entries: results,
        searched: true,
        category: category ?? null,
      });
    }

    return res.json({
      entries,
      searched: false,
      category: category ?? null,
    });
  } catch (err) {
    logger.error?.('knowledgeBase.list.error', err);
    captureRouteError(err, 'knowledgeBase.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /:projectId/knowledge-base ───────────────────────────────────

router.post(
  '/:projectId/knowledge-base',
  verifyAuth,
  validate(kbCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof kbCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const colRef = db
        .collection('tenants')
        .doc(g.tenantId)
        .collection('projects')
        .doc(projectId)
        .collection('knowledge_base');

      const now = new Date().toISOString();
      const docRef = colRef.doc();
      const entry = {
        id: docRef.id,
        kind: body.category,
        title: body.title,
        content: body.content,
        tags: body.tags,
        lastReviewedAt: now,
        viewCount: 0,
        isObsolete: false,
        authorUid: callerUid,
        sourceType: body.sourceType,
        createdAt: now,
      };
      await docRef.set(entry);
      await auditServerEvent(
        req,
        'knowledgeBase.create',
        'knowledgeBase',
        { projectId, tenantId: g.tenantId, entryId: docRef.id, category: body.category },
        { projectId },
      );
      return res.status(201).json({ entry });
    } catch (err) {
      logger.error?.('knowledgeBase.create.error', err);
      captureRouteError(err, 'knowledgeBase.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/knowledge-base/:id/use ───────────────────────────

router.post(
  '/:projectId/knowledge-base/:id/use',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection('tenants')
        .doc(g.tenantId)
        .collection('projects')
        .doc(projectId)
        .collection('knowledge_base')
        .doc(id);

      // CLAUDE.md #19: get + update on the same doc must be atomic.
      type R = { kind: 'not_found' } | { kind: 'ok' };
      const result = await db.runTransaction<R>(async (txn) => {
        const snap = await txn.get(docRef);
        if (!snap.exists) return { kind: 'not_found' };
        txn.update(docRef, {
          viewCount: admin.firestore.FieldValue.increment(1),
          lastReviewedAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        });
        return { kind: 'ok' };
      });
      if (result.kind === 'not_found') return res.status(404).json({ error: 'not_found' });
      await auditServerEvent(
        req,
        'knowledgeBase.use',
        'knowledgeBase',
        { projectId, tenantId: g.tenantId, entryId: id },
        { projectId },
      );
      return res.status(204).end();
    } catch (err) {
      logger.error?.('knowledgeBase.use.error', err);
      captureRouteError(err, 'knowledgeBase.use');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/knowledge-base/:id/flag-obsolete ─────────────────

router.post(
  '/:projectId/knowledge-base/:id/flag-obsolete',
  verifyAuth,
  validate(kbFlagObsoleteSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof kbFlagObsoleteSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection('tenants')
        .doc(g.tenantId)
        .collection('projects')
        .doc(projectId)
        .collection('knowledge_base')
        .doc(id);

      type R = { kind: 'not_found' } | { kind: 'ok' };
      const result = await db.runTransaction<R>(async (txn) => {
        const snap = await txn.get(docRef);
        if (!snap.exists) return { kind: 'not_found' };
        txn.update(docRef, {
          isObsolete: true,
          obsoleteReason: body.reason,
          obsoleteAt: new Date().toISOString(),
          obsoleteByUid: callerUid,
        });
        return { kind: 'ok' };
      });
      if (result.kind === 'not_found') return res.status(404).json({ error: 'not_found' });
      await auditServerEvent(
        req,
        'knowledgeBase.flagObsolete',
        'knowledgeBase',
        { projectId, tenantId: g.tenantId, entryId: id, reason: body.reason },
        { projectId },
      );
      return res.status(204).end();
    } catch (err) {
      logger.error?.('knowledgeBase.flagObsolete.error', err);
      captureRouteError(err, 'knowledgeBase.flagObsolete');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
