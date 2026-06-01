// Praeventio Guard — §296-301 Riesgo Residual + Aceptación Formal + Criticidad Sospechosa.
//
// Endpoints dedicados para `/api/sprint-k/:projectId/residual-risk*`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// 4 endpoints:
//   GET  /:projectId/residual-risk/suspicious   → lista los riesgos donde
//        el delta inherente→residual no se justifica con controles fuertes.
//   GET  /:projectId/residual-risk              → listado paginado top-200.
//   POST /:projectId/residual-risk              → crear con cálculo +
//        evaluación sospecha (detector heurístico, NO IA).
//   POST /:projectId/residual-risk/:id/accept   → firma formal de aceptación
//        (gated a roles admin / gerente — directiva del usuario).

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
import {
  computeResidualRisk,
  type RiskAssessment,
  type RiskLevel,
  type RiskLikelihood,
  type RiskSeverity,
  type AppliedControl,
} from '../../services/residualRisk/residualRiskEngine.js';

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

// ── Role gate ─────────────────────────────────────────────────────────

const RESIDUAL_RISK_ACCEPTOR_ROLES: ReadonlySet<string> = new Set([
  'admin',
  'gerente',
]);

function callerCanAcceptResidualRisk(
  user: Express.PraeventioAuthUser,
): boolean {
  if (user.admin === true) return true;
  const role = typeof user.role === 'string' ? user.role : null;
  if (role && RESIDUAL_RISK_ACCEPTOR_ROLES.has(role)) return true;
  const roles = Array.isArray(user.roles) ? user.roles : [];
  for (const r of roles) {
    if (typeof r === 'string' && RESIDUAL_RISK_ACCEPTOR_ROLES.has(r)) return true;
  }
  return false;
}

// ── Stored shape ──────────────────────────────────────────────────────

interface StoredResidualRisk {
  id: string;
  hazard: string;
  category: string;
  riskKind: 'physical' | 'administrative';
  likelihood: RiskLikelihood;
  inherentSeverity: RiskSeverity;
  residualSeverity: RiskSeverity;
  currentControls: AppliedControl[];
  justification: string;
  initialScore: number;
  controlReduction: number;
  residualScore: number;
  initialLevel: RiskLevel;
  residualLevel: RiskLevel;
  requiresFormalAcceptance: boolean;
  nextReviewInDays: number;
  acceptance: {
    status: 'pending' | 'accepted';
    signedByUid: string | null;
    signedAt: string | null;
    reason: string | null;
  };
  createdAt: string;
  createdBy: string;
  isSuspicious: boolean;
  suspiciousReason: string | null;
}

// ── Schemas ───────────────────────────────────────────────────────────

const residualLikelihoodEnum = z.enum([
  'rare',
  'unlikely',
  'possible',
  'likely',
  'almost_certain',
]);
const residualSeverityEnum = z.enum([
  'negligible',
  'minor',
  'moderate',
  'major',
  'catastrophic',
]);
const residualControlEffectivenessEnum = z.enum([
  'minimal',
  'partial',
  'significant',
  'full',
]);

const residualRiskCreateSchema = z.object({
  id: z.string().min(1).max(120),
  hazard: z.string().min(3).max(500),
  category: z.string().min(1).max(120),
  riskKind: z.enum(['physical', 'administrative']),
  likelihood: residualLikelihoodEnum,
  inherentSeverity: residualSeverityEnum,
  residualSeverity: residualSeverityEnum,
  currentControls: z
    .array(
      z.object({
        controlId: z.string().min(1).max(120),
        effectiveness: residualControlEffectivenessEnum,
      }),
    )
    .max(50),
  justification: z.string().min(3).max(4000),
});

const residualRiskAcceptSchema = z.object({
  reason: z.string().min(3).max(4000),
});

// ── Suspicious heuristic ──────────────────────────────────────────────

const SEVERITY_RANK: Record<RiskSeverity, number> = {
  negligible: 1,
  minor: 2,
  moderate: 3,
  major: 4,
  catastrophic: 5,
};

function evaluateSuspicious(
  inherent: RiskSeverity,
  residual: RiskSeverity,
  controls: AppliedControl[],
): { isSuspicious: boolean; reason: string | null } {
  const drop = SEVERITY_RANK[inherent] - SEVERITY_RANK[residual];
  const strongControls = controls.filter(
    (c) => c.effectiveness === 'significant' || c.effectiveness === 'full',
  ).length;
  if (
    (inherent === 'catastrophic' || inherent === 'major') &&
    (residual === 'negligible' || residual === 'minor')
  ) {
    if (drop >= 3) {
      return {
        isSuspicious: true,
        reason:
          `Severidad inherente "${inherent}" cayó a "${residual}" (${drop} niveles). ` +
          'Verifica si los controles aplicados justifican una reducción tan grande.',
      };
    }
    if (strongControls < 2) {
      return {
        isSuspicious: true,
        reason:
          `Severidad residual "${residual}" sospechosa: inherente es "${inherent}" pero ` +
          `solo hay ${strongControls} control(es) de efectividad significant/full.`,
      };
    }
  }
  return { isSuspicious: false, reason: null };
}

// ── GET /:projectId/residual-risk/suspicious ──────────────────────────

router.get(
  '/:projectId/residual-risk/suspicious',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();
      const safeRead = async <T,>(
        label: string,
        fn: () => Promise<T[]>,
      ): Promise<T[]> => {
        try {
          return await fn();
        } catch (err) {
          logger.warn?.(`residualRisk.read.${label}.failed`, err);
          return [];
        }
      };
      const risks = await safeRead<StoredResidualRisk>(
        'suspicious',
        async () => {
          const snap = await db
            .collection(
              `tenants/${g.tenantId}/projects/${projectId}/residual_risks`,
            )
            .where('isSuspicious', '==', true)
            .get();
          return snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<StoredResidualRisk, 'id'>),
          }));
        },
      );
      return res.json({ risks });
    } catch (err) {
      logger.error?.('residualRisk.suspicious.error', err);
      captureRouteError(err, 'residualRisk.suspicious');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/residual-risk ─────────────────────────────────────

router.get('/:projectId/residual-risk', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const db = admin.firestore();
    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`residualRisk.read.${label}.failed`, err);
        return [];
      }
    };
    const risks = await safeRead<StoredResidualRisk>('list', async () => {
      const snap = await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/residual_risks`)
        .orderBy('createdAt', 'desc')
        .limit(200)
        .get();
      return snap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<StoredResidualRisk, 'id'>),
      }));
    });
    return res.json({ risks });
  } catch (err) {
    logger.error?.('residualRisk.list.error', err);
    captureRouteError(err, 'residualRisk.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /:projectId/residual-risk ────────────────────────────────────

router.post(
  '/:projectId/residual-risk',
  verifyAuth,
  validate(residualRiskCreateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof residualRiskCreateSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const db = admin.firestore();

      const assessment: RiskAssessment = {
        riskId: body.id,
        category: body.category,
        likelihood: body.likelihood,
        severity: body.residualSeverity,
        riskKind: body.riskKind,
      };
      const report = computeResidualRisk(assessment, body.currentControls);

      const suspicious = evaluateSuspicious(
        body.inherentSeverity,
        body.residualSeverity,
        body.currentControls,
      );

      const now = new Date().toISOString();
      const payload: StoredResidualRisk = {
        id: body.id,
        hazard: body.hazard,
        category: body.category,
        riskKind: body.riskKind,
        likelihood: body.likelihood,
        inherentSeverity: body.inherentSeverity,
        residualSeverity: body.residualSeverity,
        currentControls: body.currentControls,
        justification: body.justification,
        initialScore: report.initialScore,
        controlReduction: report.controlReduction,
        residualScore: report.residualScore,
        initialLevel: report.initialLevel,
        residualLevel: report.residualLevel,
        requiresFormalAcceptance: report.requiresFormalAcceptance,
        nextReviewInDays: report.nextReviewInDays,
        acceptance: {
          status: 'pending',
          signedByUid: null,
          signedAt: null,
          reason: null,
        },
        createdAt: now,
        createdBy: callerUid,
        isSuspicious: suspicious.isSuspicious,
        suspiciousReason: suspicious.reason,
      };

      await db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/residual_risks`)
        .doc(body.id)
        .set(payload, { merge: true });

      await auditServerEvent(req, 'residualRisk.create', 'residualRisk', { projectId, riskId: body.id }, { projectId });
      return res.status(201).json({ ok: true, risk: payload });
    } catch (err) {
      logger.error?.('residualRisk.create.error', err);
      captureRouteError(err, 'residualRisk.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── POST /:projectId/residual-risk/:id/accept ─────────────────────────

router.post(
  '/:projectId/residual-risk/:id/accept',
  verifyAuth,
  validate(residualRiskAcceptSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id } = req.params;
    const body = req.body as z.infer<typeof residualRiskAcceptSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!callerCanAcceptResidualRisk(req.user!)) {
      return res.status(403).json({
        error: 'forbidden',
        reason: 'caller_lacks_residual_risk_acceptor_role',
      });
    }
    try {
      const db = admin.firestore();
      const docRef = db
        .collection(`tenants/${g.tenantId}/projects/${projectId}/residual_risks`)
        .doc(id);
      const snap = await docRef.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'residual_risk_not_found' });
      }
      const now = new Date().toISOString();
      await docRef.set(
        {
          acceptance: {
            status: 'accepted',
            signedByUid: callerUid,
            signedAt: now,
            reason: body.reason,
          },
        },
        { merge: true },
      );
      await auditServerEvent(req, 'residualRisk.accept', 'residualRisk', { projectId, riskId: id }, { projectId });
      return res.status(200).json({ ok: true });
    } catch (err) {
      logger.error?.('residualRisk.accept.error', err);
      captureRouteError(err, 'residualRisk.accept');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
