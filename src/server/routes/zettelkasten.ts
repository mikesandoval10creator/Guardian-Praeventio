// Praeventio Guard — Sprint 11.
//
// POST /api/zettelkasten/nodes — server-side persistence for the 15
// Bernoulli-driven Zettelkasten node generators that fire client-side
// inside HazmatStorageDesigner, StructuralCalculator, VisionAnalyzer y
// BioAnalysis. Antes del Sprint 11 estos nodos se emitían sólo a
// `logger.info` (commit d121b9e); ahora cada llamada aterriza en
// `zettelkasten_nodes/{nodeId}` con su par `audit_logs/{...}` para
// trazabilidad.
//
// Membership y validación reutilizan el patrón de audit.ts:
//   • verifyAuth → uid del token (no del body)
//   • assertProjectMember(uid, projectId) → 403 cross-tenant
//   • zettelkastenWriteLimiter (limiters.ts) → 30 req / 15 min por uid
//   • Validación estricta de RiskNodePayload por nodo
//
// Cada documento incluye:
//   • payload (title, description, type, severity, metadata, connections, references)
//   • projectId (para reglas de lectura)
//   • createdBy (uid del token, no del body)
//   • createdAt (server timestamp)
//   • idempotencyKey (id determinista; permite upsert con set+merge)
//
// Las escrituras son idempotentes vía .doc(idempotencyKey).set(...) — el
// cliente deriva el id en `nodeIdFor` y reintentos de la cola offline no
// duplican filas.

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { zettelkastenWriteLimiter } from '../middleware/limiters.js';
// Sprint 28 Bucket B3 — Zod transversal middleware (audit hallazgo H17).
// Mounted as the FIRST barrier; the existing per-node `validateNode` helper
// stays as a defense-in-depth guard until Sprint 29.
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
// Sprint 22 Bucket AA — request-scoped tracing across the node-write batch.
import { tracedAsync } from '../../services/observability/tracing.js';
// Sprint 29 Bucket AA F-B — incident RAG service para /nl-query.
import { generateEmbedding } from '../../services/ragService.js';
import {
  searchIncidents,
  type IncidentRagDeps,
} from '../../services/incidents/incidentRagService.js';

const router = Router();

const VALID_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);
const VALID_TYPES = new Set([
  'hidrante-pressure',
  'misting-suppression',
  'scaffold-uplift',
  'confined-space-vent',
  'gas-leak-anomaly',
  'mining-extraction',
  'hazmat-pipe',
  'structural-wind',
  'respirator-fatigue',
  'pulmonary-altitude',
  'micro-wind-energy',
  'slope-stability',
  'slam-mesh',
  'dike-hydrostatic',
  'gas-dispersion',
  // Sprint 16 — wisdom-capsule learning node emitted by /api/wisdom-capsule.
  'safety-learning',
]);

const ID_REGEX = /^[A-Za-z0-9_\-:.]{1,256}$/;

interface ValidationOk {
  ok: true;
}
interface ValidationFail {
  ok: false;
  error: string;
}

function validateNode(node: any, idx: number): ValidationOk | ValidationFail {
  if (!node || typeof node !== 'object') {
    return { ok: false, error: `nodes[${idx}]: not an object` };
  }
  if (typeof node.title !== 'string' || node.title.length === 0 || node.title.length > 256) {
    return { ok: false, error: `nodes[${idx}].title invalid` };
  }
  if (typeof node.description !== 'string' || node.description.length === 0 || node.description.length > 4096) {
    return { ok: false, error: `nodes[${idx}].description invalid` };
  }
  if (typeof node.type !== 'string' || !VALID_TYPES.has(node.type)) {
    return { ok: false, error: `nodes[${idx}].type invalid` };
  }
  if (typeof node.severity !== 'string' || !VALID_SEVERITIES.has(node.severity)) {
    return { ok: false, error: `nodes[${idx}].severity invalid` };
  }
  if (!node.metadata || typeof node.metadata !== 'object' || Array.isArray(node.metadata)) {
    return { ok: false, error: `nodes[${idx}].metadata invalid` };
  }
  if (!Array.isArray(node.connections) || !node.connections.every((c: unknown) => typeof c === 'string' && c.length <= 256)) {
    return { ok: false, error: `nodes[${idx}].connections invalid` };
  }
  if (!Array.isArray(node.references) || !node.references.every((r: unknown) => typeof r === 'string' && r.length <= 256)) {
    return { ok: false, error: `nodes[${idx}].references invalid` };
  }
  if (typeof node.idempotencyKey !== 'string' || !ID_REGEX.test(node.idempotencyKey)) {
    return { ok: false, error: `nodes[${idx}].idempotencyKey invalid` };
  }
  return { ok: true };
}

// Sprint 28 Bucket B3 — minimal coarse-shape gate. Per-node validation
// continues to live in `validateNode` below (richer error messages, kept
// for backward compat). This schema only ensures `projectId` is present
// and `nodes` is a bounded array of objects so the legacy validator can
// safely iterate.
const zettelkastenWriteSchema = z.object({
  projectId: z.string().min(1).max(128),
  nodes: z.array(z.object({
    title: z.string().min(1).max(256),
    content: z.string().max(8192).optional(),
    description: z.string().min(1).max(4096),
    type: z.string().min(1),
    severity: z.string().min(1),
    metadata: z.record(z.string(), z.unknown()),
    connections: z.array(z.string().max(256)),
    references: z.array(z.string().max(256)),
    tags: z.array(z.string()).optional(),
    idempotencyKey: z.string().min(1).max(256),
  }).passthrough()).min(1).max(32),
});

router.post(
  '/nodes',
  verifyAuth,
  idempotencyKey(),
  zettelkastenWriteLimiter,
  validate(zettelkastenWriteSchema),
  async (req, res) => {
    const callerUid = (req as any).user.uid;
    const callerEmail: string | null = (req as any).user.email ?? null;
    // Sprint 29 H17: shape gate (projectId/nodes typeof + length) removed —
    // `zettelkastenWriteSchema` is the single source of truth. `validateNode`
    // stays: it enforces the ID_REGEX on idempotencyKey and other per-node
    // invariants the Zod schema's .passthrough() does not cover.
    const { projectId, nodes } = req.body as {
      projectId: string;
      nodes: Array<{
        title: string;
        content?: string;
        description: string;
        type: string;
        severity: string;
        metadata: Record<string, unknown>;
        connections: string[];
        references: string[];
        tags?: string[];
        idempotencyKey: string;
        [k: string]: unknown;
      }>;
    };

    for (let i = 0; i < nodes.length; i++) {
      const v: ValidationOk | ValidationFail = validateNode(nodes[i], i);
      if (v.ok === false) {
        return res.status(400).json({ error: v.error });
      }
    }

    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      throw err;
    }

    try {
      const db = admin.firestore();
      const written: string[] = await tracedAsync(
        'zettelkasten.nodes.write',
        { projectId, nodeCount: nodes.length, uid: callerUid },
        async () => {
      const result: string[] = [];
      for (const node of nodes) {
        const docRef = db.collection('zettelkasten_nodes').doc(node.idempotencyKey);
        await docRef.set(
          {
            title: node.title,
            description: node.description,
            type: node.type,
            severity: node.severity,
            metadata: node.metadata,
            connections: node.connections,
            references: node.references,
            projectId,
            createdBy: callerUid,
            createdByEmail: callerEmail,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            idempotencyKey: node.idempotencyKey,
          },
          { merge: true },
        );
        await db.collection('audit_logs').add({
          action: 'zettelkasten.node.write',
          module: 'zettelkasten',
          details: {
            nodeId: node.idempotencyKey,
            type: node.type,
            severity: node.severity,
          },
          userId: callerUid,
          userEmail: callerEmail,
          projectId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        });
        result.push(node.idempotencyKey);
      }
      return result;
        },
      );
      return res.json({ success: true, count: written.length, ids: written });
    } catch (error: any) {
      logger.error('zettelkasten_node_write_failed', {
        uid: callerUid,
        projectId,
        message: error?.message,
      });
      return res.status(500).json({
        error: 'Zettelkasten node write failed',
        details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
      });
    }
  },
);

// ─── Sprint 29 Bucket AA F-B — POST /api/zettelkasten/nl-query ──────────────
//
// Búsqueda en lenguaje natural sobre el histórico de incidentes del tenant
// (scope = projectId). Reusa verifyAuth + assertProjectMember + Zod via
// validate, igual que /nodes.

const nlQuerySchema = z.object({
  query: z.string().min(1).max(1024),
  projectId: z.string().min(1).max(128),
  topK: z.number().int().min(1).max(20).optional().default(5),
});

router.post(
  '/nl-query',
  verifyAuth,
  validate(nlQuerySchema),
  async (req, res) => {
    const callerUid = (req as any).user?.uid;
    if (!callerUid) return res.status(401).json({ error: 'unauthorized' });

    const { query, projectId, topK } = req.body as z.infer<typeof nlQuerySchema>;

    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      throw err;
    }

    try {
      const deps: IncidentRagDeps = {
        db: admin.firestore() as unknown as IncidentRagDeps['db'],
        embed: generateEmbedding,
        toVector: (vec) => admin.firestore.FieldValue.vector(vec),
      };
      const result = await searchIncidents(projectId, query, topK ?? 5, deps);
      return res.json(result);
    } catch (error: any) {
      logger.error('zettelkasten_nl_query_failed', {
        uid: callerUid,
        projectId,
        message: error?.message,
      });
      return res.status(500).json({
        error: 'NL query failed',
        details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
      });
    }
  },
);

export default router;
