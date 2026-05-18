// Praeventio Guard — §104 Panel de Confianza de Datos.
//
// Endpoint dedicado para `/api/sprint-k/:projectId/data-confidence`.
// Migrado del monolito `sprintK.ts` (2026-05-17) — Sprint K
// reformulation directive (docs/SPRINT_K_REFORMULATED.md).
//
// "Panel que muestra cuánto se puede confiar en los datos que está
//  usando el sistema para sugerir/decidir. Ayuda al prevencionista a
//  no creer ciegamente en IA si los datos son malos."
//
// Endpoints:
//   • GET  /:projectId/data-confidence              — snapshot completo
//   • POST /:projectId/data-confidence/dismiss/:id  — admin dismiss issue
//   • GET  /:projectId/data-confidence/recommendations — recos accionables
//
// Usa el servicio puro `services/dataConfidence/dataConfidencePanel.ts`
// para el cálculo determinístico del score 0..100.

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
  buildDataConfidenceReport,
  type ConfidenceInputs,
  type DataConfidenceReport,
} from '../../services/dataConfidence/dataConfidencePanel.js';

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────

export type DataConfidenceSeverity = 'low' | 'medium' | 'high' | 'critical';

export type DataConfidenceDomain =
  | 'workers'
  | 'incidents'
  | 'training'
  | 'epp'
  | 'permits'
  | 'audits';

export interface DataConfidenceIssue {
  id: string;
  domain: DataConfidenceDomain;
  collection: string;
  severity: DataConfidenceSeverity;
  count: number;
  description: string;
  dismissed: boolean;
  dismissedByUid?: string | null;
  dismissedAt?: string | null;
}

export interface DataConfidenceDomainScore {
  name: DataConfidenceDomain;
  score: number;
  observed: number;
  expected: number;
  staleDays: number;
  detail: string;
}

export interface DataConfidenceTrendPoint {
  date: string; // YYYY-MM-DD
  overallScore: number;
}

export interface DataConfidenceSnapshot {
  generatedAt: string;
  report: DataConfidenceReport;
  domains: DataConfidenceDomainScore[];
  topIssues: DataConfidenceIssue[];
  trend: DataConfidenceTrendPoint[];
}

interface StoredDataIssueDismissal {
  id: string;
  dismissedByUid: string;
  dismissedAt: string;
  reason?: string;
}

interface StoredDataConfidenceSnapshot {
  date: string;
  overallScore: number;
}

// ── Guard helper (replicado para route auto-contenido) ────────────────

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
  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// ── Dismiss role check ────────────────────────────────────────────────

const DATA_CONFIDENCE_DISMISS_ROLES: ReadonlySet<string> = new Set([
  'admin',
  'gerente',
  'prevention_lead',
  'prevention_manager',
]);

interface ReqUserLike {
  admin?: boolean;
  role?: string;
  roles?: string[];
}

function callerCanDismissDataIssue(user: ReqUserLike): boolean {
  if (user.admin === true) return true;
  if (typeof user.role === 'string' && DATA_CONFIDENCE_DISMISS_ROLES.has(user.role)) {
    return true;
  }
  const roles = Array.isArray(user.roles) ? user.roles : [];
  for (const r of roles) {
    if (typeof r === 'string' && DATA_CONFIDENCE_DISMISS_ROLES.has(r)) {
      return true;
    }
  }
  return false;
}

// ── Helpers numéricos ────────────────────────────────────────────────

function daysSince(
  iso: string | null | undefined,
  now: Date,
  fallbackDays = 999,
): number {
  if (!iso) return fallbackDays;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallbackDays;
  const ms = now.getTime() - d.getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

function severityFromCount(count: number, total: number): DataConfidenceSeverity {
  if (total <= 0) return 'low';
  const ratio = count / Math.max(total, 1);
  if (ratio >= 0.5) return 'critical';
  if (ratio >= 0.25) return 'high';
  if (ratio >= 0.1) return 'medium';
  return 'low';
}

function severityFromScore(score: number): DataConfidenceSeverity {
  if (score < 25) return 'critical';
  if (score < 50) return 'high';
  if (score < 75) return 'medium';
  return 'low';
}

// ── Inventory readers (Firestore safeRead pattern) ───────────────────

interface DomainInventory {
  total: number;
  withRequiredFields: number;
  withAuditLog: number;
  latestUpdate: string | null;
}

async function readDomain(
  db: admin.firestore.Firestore,
  base: string,
  collection: string,
  requiredFieldCheck: (doc: Record<string, unknown>) => boolean,
): Promise<DomainInventory> {
  try {
    const snap = await db.collection(`${base}/${collection}`).limit(2000).get();
    const docs = snap.docs.map((d) => d.data() as Record<string, unknown>);
    let withRequiredFields = 0;
    let withAuditLog = 0;
    let latestUpdate: string | null = null;
    for (const doc of docs) {
      if (requiredFieldCheck(doc)) withRequiredFields++;
      if (Array.isArray(doc.auditLog) && (doc.auditLog as unknown[]).length > 0) {
        withAuditLog++;
      }
      const updatedAt = typeof doc.updatedAt === 'string' ? doc.updatedAt : null;
      if (updatedAt && (!latestUpdate || updatedAt > latestUpdate)) {
        latestUpdate = updatedAt;
      }
    }
    return { total: docs.length, withRequiredFields, withAuditLog, latestUpdate };
  } catch (err) {
    logger.warn?.(`sprintK.dataConfidence.read.${collection}.failed`, err);
    return { total: 0, withRequiredFields: 0, withAuditLog: 0, latestUpdate: null };
  }
}

// ── Endpoint 1: GET snapshot ─────────────────────────────────────────

router.get('/:projectId/data-confidence', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'project_id_required' });
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const now = new Date();
    const base = `tenants/${g.tenantId}/projects/${projectId}`;

    // Lee inventarios en paralelo (todos con fallback graceful).
    const [workers, epp, incidents, training, permits, audits] = await Promise.all([
      readDomain(db, base, 'workers', (d) => typeof d.role === 'string' && (d.role as string).length > 0),
      readDomain(db, base, 'epp_items', (d) => typeof d.expirationDate === 'string' && (d.expirationDate as string).length > 0),
      readDomain(db, base, 'incidents', (d) => typeof d.rootCause === 'string' && (d.rootCause as string).length > 0),
      readDomain(db, base, 'training_records', (d) => typeof d.approverUid === 'string' && (d.approverUid as string).length > 0),
      readDomain(db, base, 'work_permits', (d) => typeof d.signedByUid === 'string' && (d.signedByUid as string).length > 0),
      readDomain(db, base, 'audits', (d) => typeof d.completedAt === 'string' && (d.completedAt as string).length > 0),
    ]);

    // Compone ConfidenceInputs y delega al servicio puro.
    const inputs: ConfidenceInputs = {
      coverage: {
        workersExpected: Math.max(workers.total, 1),
        workersPresent: workers.total,
        eppItemsExpected: Math.max(epp.total, 1),
        eppItemsPresent: epp.total,
        documentsRequired: Math.max(audits.total + permits.total, 1),
        documentsPresent: audits.total + permits.total,
      },
      freshness: {
        workersLastUpdateDays: daysSince(workers.latestUpdate, now),
        eppInventoryLastUpdateDays: daysSince(epp.latestUpdate, now),
        incidentsLastWriteDays: daysSince(incidents.latestUpdate, now),
        documentsLastReviewDays: daysSince(audits.latestUpdate, now),
      },
      completeness: {
        workersWithFullProfileRatio: workers.total > 0 ? workers.withRequiredFields / workers.total : 0,
        eppWithExpirationRatio: epp.total > 0 ? epp.withRequiredFields / epp.total : 0,
        incidentsWithRootCauseRatio: incidents.total > 0 ? incidents.withRequiredFields / incidents.total : 0,
        documentsWithApproverRatio: training.total > 0 ? training.withRequiredFields / training.total : 0,
      },
      traceability: {
        workersWithAuditLogRatio: workers.total > 0 ? workers.withAuditLog / workers.total : 0,
        eppWithAuditLogRatio: epp.total > 0 ? epp.withAuditLog / epp.total : 0,
        incidentsWithAuditLogRatio: incidents.total > 0 ? incidents.withAuditLog / incidents.total : 0,
        documentsWithAuditLogRatio: audits.total > 0 ? audits.withAuditLog / audits.total : 0,
      },
      concordance: {
        inconsistenciesCount: 0,
        totalEntitiesScanned: workers.total + epp.total + incidents.total + audits.total,
      },
    };

    const report = buildDataConfidenceReport(inputs);

    // Per-domain breakdown.
    const domains: DataConfidenceDomainScore[] = [
      {
        name: 'workers',
        score: workers.total > 0 ? Math.round((workers.withRequiredFields / workers.total) * 100) : 0,
        observed: workers.withRequiredFields,
        expected: workers.total,
        staleDays: daysSince(workers.latestUpdate, now),
        detail: `${workers.withRequiredFields} de ${workers.total} con cargo asignado`,
      },
      {
        name: 'epp',
        score: epp.total > 0 ? Math.round((epp.withRequiredFields / epp.total) * 100) : 0,
        observed: epp.withRequiredFields,
        expected: epp.total,
        staleDays: daysSince(epp.latestUpdate, now),
        detail: `${epp.withRequiredFields} de ${epp.total} con fecha de vencimiento`,
      },
      {
        name: 'incidents',
        score: incidents.total > 0 ? Math.round((incidents.withRequiredFields / incidents.total) * 100) : 50,
        observed: incidents.withRequiredFields,
        expected: incidents.total,
        staleDays: daysSince(incidents.latestUpdate, now),
        detail: `${incidents.withRequiredFields} de ${incidents.total} con causa raíz cerrada`,
      },
      {
        name: 'training',
        score: training.total > 0 ? Math.round((training.withRequiredFields / training.total) * 100) : 50,
        observed: training.withRequiredFields,
        expected: training.total,
        staleDays: daysSince(training.latestUpdate, now),
        detail: `${training.withRequiredFields} de ${training.total} con aprobador asignado`,
      },
      {
        name: 'permits',
        score: permits.total > 0 ? Math.round((permits.withRequiredFields / permits.total) * 100) : 50,
        observed: permits.withRequiredFields,
        expected: permits.total,
        staleDays: daysSince(permits.latestUpdate, now),
        detail: `${permits.withRequiredFields} de ${permits.total} con firma`,
      },
      {
        name: 'audits',
        score: audits.total > 0 ? Math.round((audits.withRequiredFields / audits.total) * 100) : 50,
        observed: audits.withRequiredFields,
        expected: audits.total,
        staleDays: daysSince(audits.latestUpdate, now),
        detail: `${audits.withRequiredFields} de ${audits.total} cerradas`,
      },
    ];

    // Top issues from domain scores (ordered by severity).
    const issuesRaw: DataConfidenceIssue[] = domains
      .filter((d) => d.score < 75 && d.expected > 0)
      .map((d) => ({
        id: `${d.name}.score`,
        domain: d.name,
        collection: d.name,
        severity: severityFromScore(d.score),
        count: d.expected - d.observed,
        description: d.detail,
        dismissed: false,
      }));

    // Cargar dismissals para marcar issues filtrados.
    let topIssues = issuesRaw;
    try {
      const dismissalsSnap = await db.collection(`${base}/data_confidence_dismissals`).limit(50).get();
      const dismissals = new Map<string, StoredDataIssueDismissal>();
      for (const d of dismissalsSnap.docs) {
        const data = d.data() as StoredDataIssueDismissal;
        dismissals.set(data.id, data);
      }
      topIssues = issuesRaw.map((issue) => {
        const dismissed = dismissals.get(issue.id);
        if (dismissed) {
          return {
            ...issue,
            dismissed: true,
            dismissedByUid: dismissed.dismissedByUid,
            dismissedAt: dismissed.dismissedAt,
          };
        }
        return issue;
      });
    } catch (err) {
      logger.warn?.('sprintK.dataConfidence.dismissals.read_failed', err);
    }

    // Trend rolling 30 días desde snapshots históricos.
    let trend: DataConfidenceTrendPoint[] = [];
    try {
      const trendSnap = await db
        .collection(`${base}/data_confidence_snapshots`)
        .orderBy('date', 'desc')
        .limit(30)
        .get();
      trend = trendSnap.docs
        .map((d) => d.data() as StoredDataConfidenceSnapshot)
        .filter((s) => typeof s.date === 'string' && typeof s.overallScore === 'number' && Number.isFinite(s.overallScore))
        .map((s) => ({
          date: s.date,
          overallScore: Math.max(0, Math.min(100, Math.round(s.overallScore))),
        }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    } catch (err) {
      logger.warn?.('sprintK.dataConfidence.trend.read_failed', err);
    }

    // Persist today's snapshot.
    const todayBucket = now.toISOString().slice(0, 10);
    try {
      await db
        .collection(`${base}/data_confidence_snapshots`)
        .doc(todayBucket)
        .set(
          { date: todayBucket, overallScore: report.overallScore },
          { merge: true },
        );
      if (!trend.some((p) => p.date === todayBucket)) {
        trend.push({ date: todayBucket, overallScore: report.overallScore });
      }
    } catch (err) {
      logger.warn?.('sprintK.dataConfidence.snapshot.write_failed', err);
    }

    const snapshot: DataConfidenceSnapshot = {
      generatedAt: now.toISOString(),
      report,
      domains,
      topIssues: topIssues.slice(0, 10),
      trend,
    };

    return res.json(snapshot);
  } catch (err) {
    logger.error?.('sprintK.dataConfidence.snapshot.error', err);
    captureRouteError(err, 'sprintK.dataConfidence.snapshot');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── Endpoint 2: POST dismiss ─────────────────────────────────────────

const dismissDataIssueSchema = z.object({
  reason: z.string().min(1).max(2000).optional(),
});

router.post(
  '/:projectId/data-confidence/dismiss/:issueId',
  verifyAuth,
  validate(dismissDataIssueSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, issueId } = req.params;
    if (!projectId || !issueId) return res.status(400).json({ error: 'invalid_params' });
    const body = req.body as z.infer<typeof dismissDataIssueSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!callerCanDismissDataIssue(req.user! as ReqUserLike)) {
      return res.status(403).json({
        error: 'forbidden',
        reason: 'caller_lacks_data_confidence_dismiss_role',
      });
    }
    // Defense in depth: server validates issueId against a known shape
    // ("<domain>.<seed>") so attackers can't write arbitrary doc ids.
    if (!/^[a-z_]+\.[a-z_]+$/.test(issueId)) {
      return res.status(400).json({ error: 'invalid_issue_id' });
    }
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const payload: StoredDataIssueDismissal = {
        id: issueId,
        dismissedByUid: callerUid,
        dismissedAt: now,
        reason: body.reason,
      };
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/data_confidence_dismissals`)
        .doc(issueId)
        .set(cleaned, { merge: true });
      return res.status(200).json({ ok: true, dismissal: payload });
    } catch (err) {
      logger.error?.('sprintK.dataConfidence.dismiss.error', err);
      captureRouteError(err, 'sprintK.dataConfidence.dismiss');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── Endpoint 3: GET recommendations ──────────────────────────────────

interface DataConfidenceRecommendation {
  id: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  action: string;
  target: number;
  domain: DataConfidenceDomain;
}

router.get('/:projectId/data-confidence/recommendations', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'project_id_required' });
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const base = `tenants/${g.tenantId}/projects/${projectId}`;
    const now = new Date().toISOString();

    const safeReadFlagged = async (
      label: string,
      col: string,
      filter: (doc: Record<string, unknown>) => boolean,
    ): Promise<{ total: number; flagged: number }> => {
      try {
        const snap = await db.collection(`${base}/${col}`).limit(2000).get();
        let flagged = 0;
        for (const d of snap.docs) {
          const data = d.data() as Record<string, unknown>;
          if (filter(data)) flagged++;
        }
        return { total: snap.size, flagged };
      } catch (err) {
        logger.warn?.(`sprintK.dataConfidence.recos.${label}.failed`, err);
        return { total: 0, flagged: 0 };
      }
    };

    const [workers, epp, incidents, trainings] = await Promise.all([
      safeReadFlagged('workers', 'workers', (d) => !d.role || (typeof d.role === 'string' && (d.role as string).length === 0)),
      safeReadFlagged('epp', 'epp_items', (d) => !d.expirationDate || (typeof d.expirationDate === 'string' && (d.expirationDate as string).length === 0)),
      safeReadFlagged('incidents', 'incidents', (d) => !d.rootCause || (typeof d.rootCause === 'string' && (d.rootCause as string).length === 0)),
      safeReadFlagged('training', 'training_records', (d) => !d.approverUid || (typeof d.approverUid === 'string' && (d.approverUid as string).length === 0)),
    ]);

    const recommendations: DataConfidenceRecommendation[] = [];
    if (workers.flagged > 0) {
      recommendations.push({
        id: 'reco_workers_role',
        priority: workers.flagged >= 10 ? 'high' : 'medium',
        title: `Completa ${workers.flagged} workers sin cargo asignado`,
        action: 'Asigna cargo y cuadrilla a los trabajadores marcados.',
        target: workers.flagged,
        domain: 'workers',
      });
    }
    if (epp.flagged > 0) {
      recommendations.push({
        id: 'reco_epp_expiration',
        priority: epp.flagged >= 20 ? 'high' : 'medium',
        title: `Agrega fecha de vencimiento a ${epp.flagged} EPP`,
        action: 'Actualiza el inventario con la fecha real de caducidad por ítem.',
        target: epp.flagged,
        domain: 'epp',
      });
    }
    if (incidents.flagged > 0) {
      recommendations.push({
        id: 'reco_incidents_root_cause',
        priority: incidents.flagged >= 5 ? 'high' : 'medium',
        title: `Cierra causa raíz en ${incidents.flagged} incidentes`,
        action: 'Completa el análisis RCA y persiste la causa raíz.',
        target: incidents.flagged,
        domain: 'incidents',
      });
    }
    if (trainings.flagged > 0) {
      recommendations.push({
        id: 'reco_training_approver',
        priority: 'medium',
        title: `Asigna aprobador a ${trainings.flagged} capacitaciones`,
        action: 'Define el supervisor responsable de aprobar la capacitación.',
        target: trainings.flagged,
        domain: 'training',
      });
    }

    return res.json({ generatedAt: now, recommendations });
  } catch (err) {
    logger.error?.('sprintK.dataConfidence.recos.error', err);
    captureRouteError(err, 'sprintK.dataConfidence.recos');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
