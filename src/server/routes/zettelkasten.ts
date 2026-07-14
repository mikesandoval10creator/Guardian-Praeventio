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
//   • verifyAuth â†’ uid del token (no del body)
//   • assertProjectMember(uid, projectId) â†’ 403 cross-tenant
//   • zettelkastenWriteLimiter (limiters.ts) â†’ 30 req / 15 min por uid
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
import { VALID_ZK_NODE_TYPES } from './zettelkastenNodeTypes.js';
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
// §2.15 (cierre Fase C.3, 2026-05-21) — wire del canonical materializer.
// Antes el server escribía SOLO a `zettelkasten_nodes/{id}` (legacy global),
// mientras `UniversalKnowledgeContext` + `useRiskEngine` leían `nodes/{id}` y
// `RiskNodeMarkers` leía `tenants/{tid}/zettelkasten_nodes/{id}`. Tres
// colecciones competing → un nodo creado por Bernoulli no aparecía en KG ni
// Digital Twin. El materializer (Sprint 39 Fase D.8.c) ya existía como
// función pura pero NO estaba wireado a runtime.
//
// Ahora el server hace **dual-write transitorio**:
//   1. `zettelkasten_nodes/{id}` — legacy, sin cambio (backwards compat).
//   2. `nodes/{tenantId}_{projectId}_{zkNodeId}` — canonical materializado.
//
// `UniversalKnowledgeContext.tsx:108` ya lee `nodes` filtrando por
// projectId → recibe automáticamente los canonicals. `RiskNodeMarkers.tsx`
// se migra en commit aparte (mismo PR) para leer `nodes` con filtro
// tenantId+projectId en lugar de la subcolección anidada legacy.
import {
  materializeNode,
  canonicalNodePath,
} from '../../services/zettelkasten/canonical/materializer.js';
import type { RiskNodePayload } from '../../services/zettelkasten/types.js';
// §B.8 wire (2026-05-29) — advisory Risk→EPP→Training control suggestions.
// suggestEdgesForRisk es PURO/determinístico (tabla regulatoria, no LLM).
import { suggestEdgesForRisk } from '../../services/zettelkasten/riskOrchestrator.js';
// §ZK-1 wire (2026-05-29) — advisory backlinks summary + hub-detection.
import { buildEdgeStore } from '../../services/zettelkasten/edgeStoreFirestore.js';
import { getRelatedNodes } from '../../services/zettelkasten/edges.js';
import {
  summarizeBacklinks,
  topReferencingNodes,
} from '../../services/zettelkasten/backlinks.js';
// Alpha41 ZK-8 wire — consultas estructuradas cypher-lite sobre el grafo,
// SIN LLM: parser + ejecutor local sobre getRelatedNodes.
import {
  parsePatternQuery,
  runStructuredQuery,
  GraphQueryParseError,
  type QueryableNode,
} from '../../services/zettelkasten/structuredQuery.js';

const router = Router();

const VALID_SEVERITIES = new Set(['info', 'low', 'medium', 'high', 'critical']);
// Canonical allowlist shared with the supertest mirror (test-server.ts) so the
// two can never drift — see src/server/routes/zettelkastenNodeTypes.ts.
const VALID_TYPES = VALID_ZK_NODE_TYPES;

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
    const callerUid = req.user!.uid;
    const callerEmail: string | null = req.user!.email ?? null;
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
      // §2.15: resolver tenantId del proyecto una sola vez para el batch
      // entero. Si el proyecto doc no tiene tenantId (legacy), el
      // materializer cae al path sin tenant prefix (nodes/{projectId}_{id}).
      let projectTenantId: string | undefined;
      try {
        const projectSnap = await db.collection('projects').doc(projectId).get();
        if (projectSnap.exists) {
          const projectData = projectSnap.data() as { tenantId?: string } | undefined;
          if (typeof projectData?.tenantId === 'string' && projectData.tenantId.length > 0) {
            projectTenantId = projectData.tenantId;
          }
        }
      } catch (tenantErr) {
        logger.warn('zettelkasten_tenant_resolve_failed', {
          projectId,
          err: tenantErr instanceof Error ? tenantErr.message : String(tenantErr),
        });
        // Continúa sin tenantId — el materializer maneja el caso legacy.
      }

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

        // §2.15 — dual-write canonical. El materializer es función pura
        // (sin I/O); aquí persistimos el resultado en `nodes/{path}`.
        // Si materializer/persistence falla, NO bloqueamos la respuesta
        // del POST original — backwards compat es prioridad. Logueamos
        // como warning para que el equipo lo investigue sin alertar 5xx.
        try {
          const payload: RiskNodePayload = {
            title: node.title,
            description: node.description,
            type: node.type as RiskNodePayload['type'],
            severity: node.severity as RiskNodePayload['severity'],
            metadata: node.metadata as RiskNodePayload['metadata'],
            connections: node.connections,
            references: node.references,
          };
          const canonical = materializeNode({
            zkNodeId: node.idempotencyKey,
            payload,
            projectId,
            tenantId: projectTenantId,
            extraTags: ['server-dual-write'],
          });
          const canonicalPath = canonicalNodePath({
            tenantId: projectTenantId,
            projectId,
            zkNodeId: node.idempotencyKey,
          });
          await db.doc(canonicalPath).set(canonical, { merge: true });
        } catch (canonicalErr) {
          logger.warn('zettelkasten_canonical_dual_write_failed', {
            zkNodeId: node.idempotencyKey,
            projectId,
            tenantId: projectTenantId ?? null,
            err: canonicalErr instanceof Error ? canonicalErr.message : String(canonicalErr),
          });
          // Continuar — el doc legacy se escribió OK.
        }

        await db.collection('audit_logs').add({
          action: 'zettelkasten.node.write',
          module: 'zettelkasten',
          details: {
            nodeId: node.idempotencyKey,
            type: node.type,
            severity: node.severity,
            canonicalMaterialized: true,
            tenantResolved: projectTenantId !== undefined,
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

// â”€â”€â”€ Sprint 29 Bucket AA F-B — POST /api/zettelkasten/nl-query â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    const callerUid = req.user?.uid;
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

    // incident_vectors are indexed under the project's LOGICAL tenant: the
    // writer (incidents.ts) resolves `projects/{id}.tenantId` and indexes
    // `incident_vectors/{tenantId}/items`. searchIncidents' first arg is that
    // tenantId — NOT the projectId. Resolve it the same way the /backlinks
    // handler does. Without this the search read `incident_vectors/{projectId}`,
    // a path never written, so EVERY NL incident query silently returned [].
    const db = admin.firestore();
    let tenantId: string | null = null;
    try {
      const snap = await db.collection('projects').doc(projectId).get();
      const data = snap.exists
        ? (snap.data() as { tenantId?: string } | undefined)
        : undefined;
      if (typeof data?.tenantId === 'string' && data.tenantId.length > 0) {
        tenantId = data.tenantId;
      }
    } catch (err) {
      logger.warn('zettelkasten_nl_query_tenant_resolve_failed', { err: String(err) });
    }
    if (!tenantId) return res.status(404).json({ error: 'tenant_not_found' });

    try {
      const deps: IncidentRagDeps = {
        db: db as unknown as IncidentRagDeps['db'],
        embed: generateEmbedding,
        toVector: (vec) => admin.firestore.FieldValue.vector(vec),
      };
      const result = await searchIncidents(tenantId, query, topK ?? 5, deps);
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

// ── POST /risk-control-suggestions ────────────────────────────────────
//
// Advisory wire (Sprint 39 Fase B.8, 2026-05-29) del riskOrchestrator que
// estaba huérfano (0 consumers). Dado un descriptor de riesgo devuelve el
// EPP + capacitación que ese riesgo REQUIERE según DS 594 / DS 132 / DS 78
// / Ley 16.744 / Ley 20.949 + protocolos MINSAL, más los gaps de
// capacitación de los trabajadores asignados. Cada sugerencia trae su
// `rationale` (explicabilidad: es regla determinística, no LLM). NO escribe
// en Firestore y NO bloquea — sólo recomienda; el caller decide si
// materializa los edges vía POST /nodes. Por eso no lleva audit log
// (operación de sólo lectura) ni write-limiter.
const riskControlsSuggestSchema = z.object({
  projectId: z.string().min(1).max(256),
  riskType: z.string().min(1).max(512),
  industryPrefix: z.string().max(64).optional(),
  riskNodeId: z.string().max(256).optional(),
  assignedWorkers: z
    .array(
      z.object({
        uid: z.string().min(1).max(256),
        activeTrainings: z.array(z.string().max(128)).max(200),
      }),
    )
    .max(500)
    .optional(),
});

router.post(
  '/risk-control-suggestions',
  verifyAuth,
  validate(riskControlsSuggestSchema),
  async (req, res) => {
    const callerUid = req.user?.uid;
    if (!callerUid) return res.status(401).json({ error: 'unauthorized' });

    const { projectId, riskType, industryPrefix, riskNodeId, assignedWorkers } =
      req.body as z.infer<typeof riskControlsSuggestSchema>;

    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      throw err;
    }

    // Pure, deterministic compute — no Firestore write, no LLM.
    const suggestions = suggestEdgesForRisk({
      riskNodeId: riskNodeId ?? 'advisory',
      riskType,
      industryPrefix,
      assignedWorkers,
    });
    return res.json({ advisory: true, suggestions });
  },
);

// ── POST /backlinks ───────────────────────────────────────────────────
//
// Advisory wire (§ZK-1, 2026-05-29) del aggregator de backlinks que estaba
// huérfano (0 consumers). Dado un nodeId devuelve el resumen de backlinks
// bidireccionales (incoming/outgoing + breakdown por tipo de edge) y el
// ranking de nodos que más lo referencian (hub-detection). Read-only: lee
// edges vía el EdgeStore compartido, no escribe nada. Surfacea el panel
// "Referenciado por" + métricas de centralidad para la UI Risk Network.
const backlinksSchema = z.object({
  projectId: z.string().min(1).max(256),
  nodeId: z.string().min(1).max(256),
  topK: z.number().int().min(1).max(50).optional(),
});

router.post(
  '/backlinks',
  verifyAuth,
  validate(backlinksSchema),
  async (req, res) => {
    const callerUid = req.user?.uid;
    if (!callerUid) return res.status(401).json({ error: 'unauthorized' });

    const { projectId, nodeId, topK } = req.body as z.infer<
      typeof backlinksSchema
    >;

    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      throw err;
    }

    // Edges are tenant-scoped; resolve the logical tenant from the project doc.
    const db = admin.firestore();
    let tenantId: string | null = null;
    try {
      const snap = await db.collection('projects').doc(projectId).get();
      const data = snap.exists
        ? (snap.data() as { tenantId?: string } | undefined)
        : undefined;
      if (typeof data?.tenantId === 'string' && data.tenantId.length > 0) {
        tenantId = data.tenantId;
      }
    } catch (err) {
      logger.warn('zettelkasten_backlinks_tenant_resolve_failed', {
        err: String(err),
      });
    }
    if (!tenantId) return res.status(404).json({ error: 'tenant_not_found' });

    try {
      const store = buildEdgeStore(db);
      const related = await getRelatedNodes(store, nodeId, tenantId, {
        direction: 'both',
      });
      return res.json({
        nodeId,
        summary: summarizeBacklinks(related),
        topReferencing: topReferencingNodes(related, topK ?? 10),
        related: related.map((r) => ({
          nodeId: r.nodeId,
          via: r.via,
          direction: r.direction,
        })),
      });
    } catch (err) {
      logger.error?.('zettelkasten_backlinks_failed', { err: String(err) });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /structured-query ────────────────────────────────────────────
//
// Alpha41 ZK-8 — consulta estructurada cypher-lite sobre las aristas
// tipadas del grafo, p.ej.:
//   (:Control)-[:mitigates]->(:Riesgo) WHERE severity=critical
// Complementa /nl-query (RAG semántico): la auditoría preventiva necesita
// respuestas EXACTAS y deterministas — parser + ejecutor locales sobre
// getRelatedNodes, sin LLM ni embeddings. Read-only: nodos canónicos del
// proyecto (`nodes`, filtro por projectId igual que UniversalKnowledgeContext)
// + edges tenant-scoped vía el EdgeStore compartido.

// Cap defensivo del scan de nodos para no cargar grafos gigantes en memoria.
const STRUCTURED_QUERY_NODE_SCAN_LIMIT = 2000;

const structuredQuerySchema = z.object({
  projectId: z.string().min(1).max(256),
  pattern: z.string().min(1).max(1024),
  limit: z.number().int().min(1).max(200).optional(),
});

router.post(
  '/structured-query',
  verifyAuth,
  validate(structuredQuerySchema),
  async (req, res) => {
    const callerUid = req.user?.uid;
    if (!callerUid) return res.status(401).json({ error: 'unauthorized' });

    const { projectId, pattern, limit } = req.body as z.infer<
      typeof structuredQuerySchema
    >;

    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      throw err;
    }

    let parsed;
    try {
      parsed = parsePatternQuery(pattern);
    } catch (err) {
      if (err instanceof GraphQueryParseError) {
        return res.status(400).json({ error: 'invalid_pattern', reason: err.reason });
      }
      throw err;
    }

    // Edges are tenant-scoped; resolve the logical tenant from the project doc.
    const db = admin.firestore();
    let tenantId: string | null = null;
    try {
      const snap = await db.collection('projects').doc(projectId).get();
      const data = snap.exists
        ? (snap.data() as { tenantId?: string } | undefined)
        : undefined;
      if (typeof data?.tenantId === 'string' && data.tenantId.length > 0) {
        tenantId = data.tenantId;
      }
    } catch (err) {
      logger.warn('zettelkasten_structured_query_tenant_resolve_failed', {
        err: String(err),
      });
    }
    if (!tenantId) return res.status(404).json({ error: 'tenant_not_found' });

    try {
      const nodesSnap = await db
        .collection('nodes')
        .where('projectId', '==', projectId)
        .limit(STRUCTURED_QUERY_NODE_SCAN_LIMIT)
        .get();
      const nodes: QueryableNode[] = [];
      for (const doc of nodesSnap.docs) {
        const data = doc.data() as Record<string, unknown> | undefined;
        if (!data || typeof data.type !== 'string') continue;
        // Las aristas referencian el zkNodeId (campo `id` del canonical),
        // no el doc path compuesto `{tenantId}_{projectId}_{zkNodeId}`.
        const id = typeof data.id === 'string' && data.id.length > 0 ? data.id : doc.id;
        nodes.push({ ...data, id, type: data.type });
      }

      const store = buildEdgeStore(db);
      const matches = await runStructuredQuery(
        store,
        nodes,
        { ...parsed, limit: limit ?? parsed.limit },
        tenantId,
      );

      const pick = (n: QueryableNode) => ({
        id: n.id,
        type: n.type,
        title: typeof n.title === 'string' ? n.title : null,
        severity: typeof n.severity === 'string' ? n.severity : null,
      });
      return res.json({
        pattern,
        count: matches.length,
        matches: matches.map((m) => ({
          from: pick(m.from),
          to: pick(m.to),
          via: m.via,
          direction: m.direction,
          edgeType: m.edge.type,
        })),
      });
    } catch (err) {
      logger.error?.('zettelkasten_structured_query_failed', { err: String(err) });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /edges ───────────────────────────────────────────────────────
//
// Alpha41 ZK-5 — surface the project's TYPED edges to the graph explorer.
// `RiskNetworkExplorer` drew its links from `node.connections` (an untyped
// `string[]`), so the `zettelkasten_edges` the flows persist — carrying the
// edge TYPE (causes / mitigates / requires …) and DIRECTION (from → to) —
// were invisible in the UI.
//
// The reason they never lined up: an edge references the **zkNodeId** (the
// canonical node's inner `id` FIELD), while the client keys its nodes by the
// Firestore **doc id** (`{tenantId}_{projectId}_{zkNodeId}` once materialized).
// So we scan the project's nodes once, build `zkNodeId → docId`, and emit only
// the edges whose BOTH endpoints live in this project — already translated to
// the ids the explorer holds. Same reconciliation as /structured-query.
const EDGES_NODE_SCAN_LIMIT = 2000;
const EDGES_SCAN_LIMIT = 5000;

const edgesSchema = z.object({
  projectId: z.string().min(1).max(256),
});

router.post('/edges', verifyAuth, validate(edgesSchema), async (req, res) => {
  const callerUid = req.user?.uid;
  if (!callerUid) return res.status(401).json({ error: 'unauthorized' });

  const { projectId } = req.body as z.infer<typeof edgesSchema>;
  const db = admin.firestore();

  try {
    await assertProjectMember(callerUid, projectId, db);
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    throw err;
  }

  // Edges are tenant-scoped; resolve the logical tenant from the project doc.
  let tenantId: string | null = null;
  try {
    const snap = await db.collection('projects').doc(projectId).get();
    const data = snap.exists
      ? (snap.data() as { tenantId?: string } | undefined)
      : undefined;
    if (typeof data?.tenantId === 'string' && data.tenantId.length > 0) {
      tenantId = data.tenantId;
    }
  } catch (err) {
    logger.warn('zettelkasten_edges_tenant_resolve_failed', { err: String(err) });
  }
  if (!tenantId) return res.status(404).json({ error: 'tenant_not_found' });

  try {
    const nodesSnap = await db
      .collection('nodes')
      .where('projectId', '==', projectId)
      .limit(EDGES_NODE_SCAN_LIMIT)
      .get();

    const docIdByZkId = new Map<string, string>();
    for (const doc of nodesSnap.docs) {
      const data = doc.data() as Record<string, unknown> | undefined;
      const zkId =
        typeof data?.id === 'string' && data.id.length > 0 ? data.id : doc.id;
      docIdByZkId.set(zkId, doc.id);
    }

    const store = buildEdgeStore(db);
    const all = await store.listByTenant(tenantId, EDGES_SCAN_LIMIT);

    const edges = all.flatMap((e) => {
      const source = docIdByZkId.get(e.fromNodeId);
      const target = docIdByZkId.get(e.toNodeId);
      // Drop edges with an endpoint outside this project (cross-project, or a
      // node not materialized yet): the explorer has no node to attach them to.
      if (!source || !target) return [];
      return [{ source, target, type: e.type }];
    });

    return res.json({ edges });
  } catch (err) {
    logger.error?.('zettelkasten_edges_failed', { err: String(err) });
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
