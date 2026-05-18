// Praeventio Guard — §90-91 Calidad de Proveedores + Ranking de Riesgo.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/suppliers*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// 5 endpoints:
//   GET  /:projectId/suppliers[?riskLevel=low|medium|high|all]
//   POST /:projectId/suppliers
//   POST /:projectId/suppliers/:id/incidents
//   POST /:projectId/suppliers/:id/audits
//   GET  /:projectId/suppliers/ranking
//
// Storage: `tenants/{tid}/projects/{pid}/suppliers/{id}`.
// Cada doc embed `incidents[]` y `audits[]` para mantener el read en
// una sola consulta. El scoring lo hace `supplierScoring` (determinístico).

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
import {
  rankSuppliersByScore,
  scoreSupplier,
  type SupplierKpis,
  type SupplierRecord,
  type ScoredSupplier,
} from '../../services/suppliers/supplierScoring.js';

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

// ── Types + helpers ───────────────────────────────────────────────────

const supplierRiskLevels = ['low', 'medium', 'high'] as const;
type SupplierRiskLevel = (typeof supplierRiskLevels)[number];

interface StoredSupplierIncident {
  id: string;
  occurredAt: string;
  severity: 'near_miss' | 'incident';
  description: string;
  recordedByUid: string;
}

interface StoredSupplierAudit {
  id: string;
  auditedAt: string;
  documentComplianceRatio: number;
  avgResponseHours: number;
  reputationScore: number;
  notes?: string;
  recordedByUid: string;
}

interface StoredSupplier {
  id: string;
  legalName: string;
  taxId: string;
  services: string[];
  criticalRoles: string[];
  active: boolean;
  registeredAt: string;
  registeredByUid: string;
  incidents: StoredSupplierIncident[];
  audits: StoredSupplierAudit[];
}

function latestAudit(
  audits: StoredSupplierAudit[],
): StoredSupplierAudit | null {
  if (audits.length === 0) return null;
  const sorted = [...audits].sort((a, b) =>
    b.auditedAt.localeCompare(a.auditedAt),
  );
  return sorted[0];
}

function latestIncidentAt(
  incidents: StoredSupplierIncident[],
): string | null {
  if (incidents.length === 0) return null;
  return incidents
    .map((i) => i.occurredAt)
    .sort((a, b) => b.localeCompare(a))[0];
}

function deriveKpis(
  s: StoredSupplier,
  now: number = Date.now(),
): SupplierKpis {
  const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(now - TWELVE_MONTHS_MS).toISOString();
  const recent = s.incidents.filter((i) => i.occurredAt >= cutoffIso);
  const incidents = recent.filter((i) => i.severity === 'incident').length;
  const nearMisses = recent.filter((i) => i.severity === 'near_miss').length;
  const audit = latestAudit(s.audits);
  const documentComplianceRatio = audit
    ? audit.documentComplianceRatio
    : 0.5;
  const avgResponseHours = audit ? audit.avgResponseHours : 24;
  const reputationScore = audit ? audit.reputationScore : 0.5;
  return {
    incidents,
    nearMisses,
    documentComplianceRatio,
    avgResponseHours,
    reputationScore,
  };
}

function riskLevelForScore(score: number): SupplierRiskLevel {
  if (score >= 75) return 'low';
  if (score >= 50) return 'medium';
  return 'high';
}

function deriveTrend(
  s: StoredSupplier,
  now: number = Date.now(),
): 'improving' | 'stable' | 'worsening' {
  const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
  const recentCut = new Date(now - TWELVE_MONTHS_MS).toISOString();
  const priorCut = new Date(now - 2 * TWELVE_MONTHS_MS).toISOString();
  const recent = s.incidents.filter(
    (i) => i.occurredAt >= recentCut,
  ).length;
  const prior = s.incidents.filter(
    (i) => i.occurredAt >= priorCut && i.occurredAt < recentCut,
  ).length;
  if (recent < prior) return 'improving';
  if (recent > prior) return 'worsening';
  return 'stable';
}

interface SupplierView {
  id: string;
  legalName: string;
  taxId: string;
  services: string[];
  criticalRoles: string[];
  active: boolean;
  registeredAt: string;
  score: number;
  riskLevel: SupplierRiskLevel;
  trend: 'improving' | 'stable' | 'worsening';
  lastIncidentAt: string | null;
  lastAuditAt: string | null;
  incidentCount: number;
  auditCount: number;
}

function toView(s: StoredSupplier): SupplierView {
  const kpis = deriveKpis(s);
  const record: SupplierRecord = {
    id: s.id,
    legalName: s.legalName,
    kpis,
  };
  let scored: ScoredSupplier;
  try {
    scored = scoreSupplier(record);
  } catch {
    scored = {
      id: s.id,
      legalName: s.legalName,
      score: 0,
      breakdown: {
        safetyPerformance: 0,
        documentCompliance: 0,
        responsiveness: 0,
        reputation: 0,
      },
    };
  }
  const audit = latestAudit(s.audits);
  return {
    id: s.id,
    legalName: s.legalName,
    taxId: s.taxId,
    services: s.services,
    criticalRoles: s.criticalRoles,
    active: s.active,
    registeredAt: s.registeredAt,
    score: scored.score,
    riskLevel: riskLevelForScore(scored.score),
    trend: deriveTrend(s),
    lastIncidentAt: latestIncidentAt(s.incidents),
    lastAuditAt: audit ? audit.auditedAt : null,
    incidentCount: s.incidents.length,
    auditCount: s.audits.length,
  };
}

async function readSuppliers(
  db: admin.firestore.Firestore,
  tenantId: string,
  projectId: string,
): Promise<StoredSupplier[]> {
  const snap = await db
    .collection(`tenants/${tenantId}/projects/${projectId}/suppliers`)
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      legalName: typeof data.legalName === 'string' ? data.legalName : '',
      taxId: typeof data.taxId === 'string' ? data.taxId : '',
      services: Array.isArray(data.services)
        ? (data.services as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          )
        : [],
      criticalRoles: Array.isArray(data.criticalRoles)
        ? (data.criticalRoles as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          )
        : [],
      active: typeof data.active === 'boolean' ? data.active : true,
      registeredAt:
        typeof data.registeredAt === 'string'
          ? data.registeredAt
          : new Date(0).toISOString(),
      registeredByUid:
        typeof data.registeredByUid === 'string'
          ? data.registeredByUid
          : 'unknown',
      incidents: Array.isArray(data.incidents)
        ? (data.incidents as StoredSupplierIncident[])
        : [],
      audits: Array.isArray(data.audits)
        ? (data.audits as StoredSupplierAudit[])
        : [],
    } as StoredSupplier;
  });
}

// ── GET /:projectId/suppliers ─────────────────────────────────────────

const supplierListQuerySchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high', 'all']).optional(),
});

router.get('/:projectId/suppliers', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const parsed = supplierListQuerySchema.safeParse({
    riskLevel:
      typeof req.query.riskLevel === 'string'
        ? req.query.riskLevel
        : undefined,
  });
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query' });
  }
  const filter = parsed.data.riskLevel ?? 'all';
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`suppliers.read.${label}.failed`, err);
        return [];
      }
    };
    const stored = await safeRead('suppliers', () =>
      readSuppliers(admin.firestore(), g.tenantId, projectId),
    );
    const views = stored.map(toView);
    const filtered =
      filter === 'all'
        ? views
        : views.filter((s) => s.riskLevel === filter);
    return res.json({ suppliers: filtered, total: views.length });
  } catch (err) {
    logger.error?.('suppliers.list.error', err);
    captureRouteError(err, 'suppliers.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /:projectId/suppliers ────────────────────────────────────────

const supplierCreateSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  name: z.string().min(2).max(200),
  taxId: z.string().min(2).max(40),
  services: z.array(z.string().min(1).max(80)).min(1).max(40),
  criticalRoles: z.array(z.string().min(1).max(120)).max(40).optional(),
  active: z.boolean().optional(),
});

router.post(
  '/:projectId/suppliers',
  verifyAuth,
  validate(supplierCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof supplierCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const collection = db.collection(
        `tenants/${g.tenantId}/projects/${projectId}/suppliers`,
      );
      const docRef = body.id ? collection.doc(body.id) : collection.doc();
      const supplier: StoredSupplier = {
        id: docRef.id,
        legalName: body.name,
        taxId: body.taxId,
        services: body.services,
        criticalRoles: body.criticalRoles ?? [],
        active: body.active ?? true,
        registeredAt: new Date().toISOString(),
        registeredByUid: callerUid,
        incidents: [],
        audits: [],
      };
      await docRef.set(supplier, { merge: false });
      return res
        .status(201)
        .json({ ok: true, supplier: toView(supplier) });
    } catch (err) {
      logger.error?.('suppliers.create.error', err);
      captureRouteError(err, 'suppliers.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/suppliers/:id/incidents ──────────────────────────

const supplierIncidentSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  occurredAt: z.string().min(10).max(40),
  severity: z.enum(['near_miss', 'incident']),
  description: z.string().min(3).max(2000),
});

router.post(
  '/:projectId/suppliers/:id/incidents',
  verifyAuth,
  validate(supplierIncidentSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof supplierIncidentSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/suppliers`,
        )
        .doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'supplier_not_found' });
      }
      const data = snap.data() as Partial<StoredSupplier>;
      const incidents = Array.isArray(data.incidents)
        ? data.incidents
        : [];
      const entry: StoredSupplierIncident = {
        id: body.id ?? db.collection('_ids').doc().id,
        occurredAt: body.occurredAt,
        severity: body.severity,
        description: body.description,
        recordedByUid: callerUid,
      };
      await docRef.set(
        {
          incidents: [...incidents, entry],
          lastIncidentAt: entry.occurredAt,
        },
        { merge: true },
      );
      return res.status(201).json({ ok: true, incident: entry });
    } catch (err) {
      logger.error?.('suppliers.incident.error', err);
      captureRouteError(err, 'suppliers.incident');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/suppliers/:id/audits ─────────────────────────────

const supplierAuditSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  auditedAt: z.string().min(10).max(40),
  documentComplianceRatio: z.number().min(0).max(1),
  avgResponseHours: z.number().min(0).max(720),
  reputationScore: z.number().min(0).max(1),
  notes: z.string().max(2000).optional(),
});

router.post(
  '/:projectId/suppliers/:id/audits',
  verifyAuth,
  validate(supplierAuditSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof supplierAuditSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(
          `tenants/${g.tenantId}/projects/${projectId}/suppliers`,
        )
        .doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'supplier_not_found' });
      }
      const data = snap.data() as Partial<StoredSupplier>;
      const audits = Array.isArray(data.audits) ? data.audits : [];
      const entry: StoredSupplierAudit = {
        id: body.id ?? db.collection('_ids').doc().id,
        auditedAt: body.auditedAt,
        documentComplianceRatio: body.documentComplianceRatio,
        avgResponseHours: body.avgResponseHours,
        reputationScore: body.reputationScore,
        notes: body.notes,
        recordedByUid: callerUid,
      };
      await docRef.set(
        {
          audits: [...audits, entry],
          lastAuditAt: entry.auditedAt,
        },
        { merge: true },
      );
      return res.status(201).json({ ok: true, audit: entry });
    } catch (err) {
      logger.error?.('suppliers.audit.error', err);
      captureRouteError(err, 'suppliers.audit');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/suppliers/ranking ─────────────────────────────────

router.get(
  '/:projectId/suppliers/ranking',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`suppliers.read.${label}.failed`, err);
          return [];
        }
      };
      const stored = await safeRead('suppliers_ranking', () =>
        readSuppliers(admin.firestore(), g.tenantId, projectId),
      );
      if (stored.length === 0) {
        return res.json({ ranking: [], total: 0 });
      }
      const records: SupplierRecord[] = stored.map((s) => ({
        id: s.id,
        legalName: s.legalName,
        kpis: deriveKpis(s),
      }));
      const scored = rankSuppliersByScore(records);
      const byId = new Map(stored.map((s) => [s.id, s]));
      const ranking = scored.map((sc, idx) => {
        const s = byId.get(sc.id)!;
        const view = toView(s);
        return {
          rank: idx + 1,
          ...view,
          breakdown: sc.breakdown,
        };
      });
      return res.json({ ranking, total: ranking.length });
    } catch (err) {
      logger.error?.('suppliers.ranking.error', err);
      captureRouteError(err, 'suppliers.ranking');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
