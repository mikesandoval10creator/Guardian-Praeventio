// Praeventio Guard — §211-213 Reportes Confidenciales / Ley Karin 21.643.
//
// Endpoint dedicado para `/api/sprint-k/:projectId/confidential-reports*`.
// Migrado del monolito `sprintK.ts` (2026-05-17) — Sprint K reformulation
// (docs/SPRINT_K_REFORMULATED.md).
//
// 3-layer anonimato (hash autor, no uid raw) + retaliation detector.
// Compliance: Ley 21.643 "Ley Karin" (prevención acoso laboral/sexual,
// vigente desde agosto 2024, modifica el Código del Trabajo).
//
// Endpoints:
//   POST /:projectId/confidential-reports               → crear reporte (anónimo posible)
//   GET  /:projectId/confidential-reports               → listar (gate por rol)
//   POST /:projectId/confidential-reports/:id/respond   → primera respuesta SLA 5 días
//   POST /:projectId/confidential-reports/:id/close     → cierre con outcome
//   GET  /:projectId/confidential-reports/retaliation-alerts → detector represalias

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { createHash } from 'node:crypto';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────

// Codex P1 fix: UI envía enums en inglés. Schema acepta los valores
// que la página ConfidentialReports.tsx realmente postea.
const CONFIDENTIAL_REPORT_KINDS = [
  'harassment',
  'safety',
  'discrimination',
  'violence',
  'conflict_of_interest',
  'other',
] as const;

const CONFIDENTIAL_REPORT_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

const CONFIDENTIAL_REPORT_STATUSES = [
  'open',
  'investigating',
  'resolved',
  'closed',
  'dismissed',
] as const;

export type ConfidentialReportKind = (typeof CONFIDENTIAL_REPORT_KINDS)[number];
export type ConfidentialReportSeverity = (typeof CONFIDENTIAL_REPORT_SEVERITIES)[number];
export type ConfidentialReportStatus = (typeof CONFIDENTIAL_REPORT_STATUSES)[number];

interface StoredConfidentialReport {
  id: string;
  projectId: string;
  kind: ConfidentialReportKind;
  severity: ConfidentialReportSeverity;
  narrative: string;
  evidence?: string;
  allowsIdentity: boolean;
  reporterAnonHash: string;
  reporterUid?: string;
  status: ConfidentialReportStatus;
  submittedAt: string;
  firstResponseDueAt: string;
  resolveDueAt: string;
  respondedAt?: string;
  closedAt?: string;
  resolution?: string;
  outcome?: 'substantiated' | 'unsubstantiated' | 'transferred';
}

interface StoredAdverseAction {
  workerUidHash: string;
  changeKind: 'termination' | 'salary_decrease' | 'shift_change' | 'role_change' | 'transfer';
  changedAt: string;
  notedByUid: string;
}

// Codex P2 fix: preservar la lista de roles que la versión monolítica
// aceptaba para no bloquear handlers existentes que ya tenían permiso.
const CONFIDENTIAL_HANDLER_ROLES: ReadonlySet<string> = new Set([
  'admin',
  'gerente',
  'prevention_lead',
  'comite_paritario',
  'rrhh',
  'confidential_handler',
  'legal_counsel',
  'hr_director',
  'prevencionista',
  'investigator',
]);

const CONFIDENTIAL_REPORTS_PATH = (tenantId: string) =>
  `tenants/${tenantId}/confidential_reports`;
const CONFIDENTIAL_ADVERSE_ACTIONS_PATH = (tenantId: string) =>
  `tenants/${tenantId}/confidential_adverse_actions`;

// ── Guard + helpers ───────────────────────────────────────────────────

async function resolveTenantId(
  callerUid: string,
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

/**
 * Codex P2 fix: honrar roles via Firebase custom claims (lo que
 * `verifyAuth` ya expone en `req.user.role`) además del fallback al
 * documento `users/{uid}`. El monolito usaba esta combinación.
 */
async function resolveRequesterRole(
  callerUid: string,
  reqUser?: { role?: string; roles?: string[]; admin?: boolean },
): Promise<{ role: string; roles: string[]; isAdmin: boolean }> {
  const claimRole = typeof reqUser?.role === 'string' ? reqUser.role : '';
  const claimRoles = Array.isArray(reqUser?.roles) ? reqUser!.roles! : [];
  const claimAdmin = reqUser?.admin === true;
  if (claimRole || claimRoles.length > 0 || claimAdmin) {
    return { role: claimRole, roles: claimRoles, isAdmin: claimAdmin };
  }
  try {
    const userDoc = await admin.firestore().collection('users').doc(callerUid).get();
    if (!userDoc.exists) return { role: '', roles: [], isAdmin: false };
    const data = userDoc.data() as Record<string, unknown>;
    const role = typeof data.role === 'string' ? data.role : '';
    const roles = Array.isArray(data.roles)
      ? (data.roles as unknown[]).filter((r): r is string => typeof r === 'string')
      : [];
    const isAdmin = data.admin === true;
    return { role, roles, isAdmin };
  } catch {
    return { role: '', roles: [], isAdmin: false };
  }
}

function isHandlerRole(role: { role: string; roles: string[]; isAdmin: boolean }): boolean {
  if (role.isAdmin) return true;
  if (role.role && CONFIDENTIAL_HANDLER_ROLES.has(role.role)) return true;
  for (const r of role.roles) {
    if (CONFIDENTIAL_HANDLER_ROLES.has(r)) return true;
  }
  return false;
}

function hashReporterAnon(callerUid: string, tenantId: string): string {
  // Stable hash so that the same reporter is detectable in retaliation
  // pattern detection without exposing the real uid.
  return createHash('sha256').update(`${tenantId}:${callerUid}`).digest('hex');
}

// ── Endpoint 1: POST create report ────────────────────────────────────

const createSchema = z.object({
  kind: z.enum(CONFIDENTIAL_REPORT_KINDS),
  severity: z.enum(CONFIDENTIAL_REPORT_SEVERITIES),
  narrative: z.string().min(10).max(8000),
  evidence: z.string().max(4000).optional(),
  allowsIdentity: z.boolean(),
  // Codex feedback: el client puede enviar reporterUid cuando
  // allowsIdentity=true. Lo aceptamos pero el server siempre re-deriva
  // desde callerUid (nunca confiar en el client para identidad).
  reporterUid: z.string().min(1).max(120).optional(),
});

router.post(
  '/:projectId/confidential-reports',
  verifyAuth,
  validate(createSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!projectId) return res.status(400).json({ error: 'project_id_required' });
    const body = req.body as z.infer<typeof createSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const now = new Date().toISOString();
      const id = `cr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const firstResponseDueAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const resolveDueAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const reporterAnonHash = hashReporterAnon(callerUid, g.tenantId);
      const payload: StoredConfidentialReport = {
        id,
        projectId,
        kind: body.kind,
        severity: body.severity,
        narrative: body.narrative,
        evidence: body.evidence,
        allowsIdentity: body.allowsIdentity === true,
        reporterAnonHash,
        status: 'open',
        submittedAt: now,
        firstResponseDueAt,
        resolveDueAt,
      };
      if (payload.allowsIdentity) payload.reporterUid = callerUid;
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (v !== undefined) cleaned[k] = v;
      }
      await db.collection(CONFIDENTIAL_REPORTS_PATH(g.tenantId)).doc(id).set(cleaned);
      return res.status(201).json({
        ok: true,
        report: payload,
        sla: {
          firstResponseDueAt,
          resolveDueAt,
          legalReference: 'Art. 7 Ley 21.643 — 5 días hábiles primera respuesta',
        },
      });
    } catch (err) {
      logger.error?.('sprintK.confidential.create.error', err);
      captureRouteError(err, 'sprintK.confidential.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── Endpoint 2: GET list (handler-only) ───────────────────────────────

// Codex P1 fix: reporters acceden a sus propios reports filtrados por
// reporterAnonHash. Handlers ven todos. La UI espera `role: 'investigator'
// | 'reporter'` para conmutar entre Inbox e "Mis reportes" tabs.
router.get('/:projectId/confidential-reports', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'project_id_required' });
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const callerRoleInfo = await resolveRequesterRole(callerUid, req.user as { role?: string; roles?: string[]; admin?: boolean });
    const isHandler = isHandlerRole(callerRoleInfo);
    const db = admin.firestore();
    const snap = await db
      .collection(CONFIDENTIAL_REPORTS_PATH(g.tenantId))
      .where('projectId', '==', projectId)
      .orderBy('submittedAt', 'desc')
      .limit(500)
      .get();
    const all = snap.docs.map((d) => d.data() as StoredConfidentialReport);
    if (isHandler) {
      return res.json({ reports: all, role: 'investigator' });
    }
    // Codex P1 fix: reporter ve solo sus propios reports (filtrado por
    // hash o reporterUid si dio identidad).
    const myHash = hashReporterAnon(callerUid, g.tenantId);
    const mine = all.filter(
      (r) => r.reporterAnonHash === myHash || r.reporterUid === callerUid,
    );
    return res.json({ reports: mine, role: 'reporter' });
  } catch (err) {
    logger.error?.('sprintK.confidential.list.error', err);
    captureRouteError(err, 'sprintK.confidential.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── Endpoint 3: POST respond ──────────────────────────────────────────

const respondSchema = z.object({ message: z.string().min(1).max(8000) });

router.post(
  '/:projectId/confidential-reports/:id/respond',
  verifyAuth,
  validate(respondSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    if (!projectId || !id) return res.status(400).json({ error: 'invalid_params' });
    const body = req.body as z.infer<typeof respondSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const callerRoleInfo = await resolveRequesterRole(callerUid, req.user as { role?: string; roles?: string[]; admin?: boolean });
      if (!isHandlerRole(callerRoleInfo)) {
        return res.status(403).json({ error: 'role_not_authorized_to_respond' });
      }
      const db = admin.firestore();
      const docRef = db.collection(CONFIDENTIAL_REPORTS_PATH(g.tenantId)).doc(id);
      const snap = await docRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'report_not_found' });
      const existing = snap.data() as StoredConfidentialReport;
      if (existing.projectId !== projectId) {
        return res.status(404).json({ error: 'report_not_found' });
      }
      const now = new Date().toISOString();
      const newStatus: ConfidentialReportStatus =
        existing.status === 'open' ? 'investigating' : existing.status;
      // Codex P2 fix: preservar history en subcollection (cada response
      // se appendea como audit event, no se sobreescribe).
      const auditId = `resp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      await docRef.collection('audit').doc(auditId).set({
        id: auditId,
        kind: 'response',
        actorUid: callerUid,
        role: callerRoleInfo.role || (callerRoleInfo.isAdmin ? 'admin' : 'investigator'),
        message: body.message,
        atStatus: newStatus,
        createdAt: now,
      });
      await docRef.set(
        {
          status: newStatus,
          respondedAt: existing.respondedAt ?? now,
          lastResponseMessage: body.message,
          lastResponseAt: now,
          lastResponseByUid: callerUid,
        },
        { merge: true },
      );
      return res.json({ ok: true, status: newStatus, respondedAt: now });
    } catch (err) {
      logger.error?.('sprintK.confidential.respond.error', err);
      captureRouteError(err, 'sprintK.confidential.respond');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── Endpoint 4: POST close ────────────────────────────────────────────

const closeSchema = z.object({
  resolution: z.string().min(1).max(8000),
  outcome: z.enum(['substantiated', 'unsubstantiated', 'transferred']).default('substantiated'),
});

router.post(
  '/:projectId/confidential-reports/:id/close',
  verifyAuth,
  validate(closeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    if (!projectId || !id) return res.status(400).json({ error: 'invalid_params' });
    const body = req.body as z.infer<typeof closeSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const callerRoleInfo = await resolveRequesterRole(callerUid, req.user as { role?: string; roles?: string[]; admin?: boolean });
      if (!isHandlerRole(callerRoleInfo)) {
        return res.status(403).json({ error: 'role_not_authorized_to_close' });
      }
      const db = admin.firestore();
      const docRef = db.collection(CONFIDENTIAL_REPORTS_PATH(g.tenantId)).doc(id);
      const snap = await docRef.get();
      if (!snap.exists) return res.status(404).json({ error: 'report_not_found' });
      const existing = snap.data() as StoredConfidentialReport;
      if (existing.projectId !== projectId) {
        return res.status(404).json({ error: 'report_not_found' });
      }
      const now = new Date().toISOString();
      const newStatus: ConfidentialReportStatus =
        body.outcome === 'substantiated' ? 'resolved' : 'closed';
      // Codex P2 fix: append closure event to history subcollection.
      const auditId = `close_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      await docRef.collection('audit').doc(auditId).set({
        id: auditId,
        kind: 'close',
        actorUid: callerUid,
        role: callerRoleInfo.role || (callerRoleInfo.isAdmin ? 'admin' : 'investigator'),
        resolution: body.resolution,
        outcome: body.outcome,
        atStatus: newStatus,
        createdAt: now,
      });
      await docRef.set(
        {
          status: newStatus,
          closedAt: now,
          resolution: body.resolution,
          outcome: body.outcome,
          closedByUid: callerUid,
        },
        { merge: true },
      );
      return res.json({ ok: true, status: newStatus, closedAt: now });
    } catch (err) {
      logger.error?.('sprintK.confidential.close.error', err);
      captureRouteError(err, 'sprintK.confidential.close');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── Endpoint 5: GET retaliation alerts ────────────────────────────────

router.get(
  '/:projectId/confidential-reports/retaliation-alerts',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!projectId) return res.status(400).json({ error: 'project_id_required' });
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const callerRoleInfo = await resolveRequesterRole(callerUid, req.user as { role?: string; roles?: string[]; admin?: boolean });
      if (!isHandlerRole(callerRoleInfo)) {
        return res.status(403).json({ error: 'role_not_authorized' });
      }
      const db = admin.firestore();
      const safeRead = async <T,>(fn: () => Promise<T[]>): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.('sprintK.confidential.retaliation.read_failed', err);
          return [];
        }
      };
      const reports = await safeRead<StoredConfidentialReport>(async () => {
        const snap = await db
          .collection(CONFIDENTIAL_REPORTS_PATH(g.tenantId))
          .where('projectId', '==', projectId)
          .orderBy('submittedAt', 'desc')
          .limit(500)
          .get();
        return snap.docs.map((d) => d.data() as StoredConfidentialReport);
      });
      const adverseActions = await safeRead<StoredAdverseAction>(async () => {
        const snap = await db
          .collection(CONFIDENTIAL_ADVERSE_ACTIONS_PATH(g.tenantId))
          .orderBy('changedAt', 'desc')
          .limit(1000)
          .get();
        return snap.docs.map((d) => d.data() as StoredAdverseAction);
      });
      const RETALIATION_WINDOW_MS = 90 * 86_400_000;
      const alerts: Array<{
        reportId: string;
        reporterAnonHash: string;
        reportSubmittedAt: string;
        actionAt: string;
        actionKind: StoredAdverseAction['changeKind'];
        daysFromReport: number;
        severity: 'high' | 'critical';
      }> = [];
      for (const r of reports) {
        const reportMs = Date.parse(r.submittedAt);
        if (Number.isNaN(reportMs)) continue;
        for (const a of adverseActions) {
          if (a.workerUidHash !== r.reporterAnonHash) continue;
          const actionMs = Date.parse(a.changedAt);
          if (Number.isNaN(actionMs)) continue;
          if (actionMs <= reportMs) continue;
          if (actionMs - reportMs > RETALIATION_WINDOW_MS) continue;
          const daysFromReport = Math.floor((actionMs - reportMs) / 86_400_000);
          const severity: 'high' | 'critical' =
            a.changeKind === 'termination' || a.changeKind === 'salary_decrease'
              ? 'critical'
              : 'high';
          alerts.push({
            reportId: r.id,
            reporterAnonHash: r.reporterAnonHash,
            reportSubmittedAt: r.submittedAt,
            actionAt: a.changedAt,
            actionKind: a.changeKind,
            daysFromReport,
            severity,
          });
        }
      }
      alerts.sort((x) => (x.severity === 'critical' ? -1 : 1));
      return res.json({ alerts, windowDays: 90 });
    } catch (err) {
      logger.error?.('sprintK.confidential.retaliation.error', err);
      captureRouteError(err, 'sprintK.confidential.retaliation');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
