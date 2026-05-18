// Praeventio Guard — F.26 Indicador de Madurez Preventiva.
//
// Endpoint dedicado para `/api/sprint-k/:projectId/maturity-index`.
// Migrado del monolito `sprintK.ts` (2026-05-18) — directiva Sprint K
// reformulation (docs/SPRINT_K_REFORMULATED.md).
//
// Lee múltiples colecciones canónicas del proyecto (training_assignments,
// corrective_actions, cphs_meetings, incidents, critical_controls,
// positive_observations, confidential_reports, project doc) y corre el
// servicio determinístico `computeMaturityLevel` + `recommendNextSteps`.
// Devuelve el `MaturityReport` con sub-puntajes por categoría + 3
// recomendaciones concretas para subir de nivel.
//
// Gate de honestidad: si el proyecto es muy nuevo (<3 meses) o tiene
// <2 fuentes pobladas, devuelve `{ insufficientData: true }` con razón
// para que la UI muestre empty-state explicativo (no score 1 alarmista).

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
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

// ── GET /:projectId/maturity-index ────────────────────────────────────

router.get('/:projectId/maturity-index', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { computeMaturityLevel, recommendNextSteps } = await import(
      '../../services/maturity/preventionMaturityIndex.js'
    );

    const db = admin.firestore();
    const tenantId = g.tenantId;

    const safeRead = async <T,>(
      label: string,
      fn: () => Promise<T[]>,
    ): Promise<T[]> => {
      try {
        return await fn();
      } catch (err) {
        logger.warn?.(`maturity.read.${label}.failed`, err);
        return [];
      }
    };

    const projectRef = db.collection('projects').doc(projectId);
    const tenantProjectPath = `tenants/${tenantId}/projects/${projectId}`;
    const byProject = (col: string) =>
      db.collection(col).where('projectId', '==', projectId);

    const now = Date.now();
    const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;
    const SIX_MONTHS_MS = 182 * 24 * 60 * 60 * 1000;
    const twelveMonthsAgoIso = new Date(now - TWELVE_MONTHS_MS).toISOString();
    const sixMonthsAgoIso = new Date(now - SIX_MONTHS_MS).toISOString();

    const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
    const ninetyDaysAgoIso = new Date(now - NINETY_DAYS_MS).toISOString();

    const [
      trainings,
      correctiveActions,
      cphsMeetings,
      incidents,
      criticalControls,
      positiveObservations,
      confidentialReports,
      projectDoc,
    ] = await Promise.all([
      safeRead('trainings', async () => {
        const snap = await projectRef.collection('training_assignments').get();
        return snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Record<string, unknown>),
        );
      }),
      safeRead('correctiveActions', async () => {
        const snap = await db
          .collection(`${tenantProjectPath}/corrective_actions`)
          .get();
        return snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Record<string, unknown>),
        );
      }),
      safeRead('cphsMeetings', async () => {
        const committeesSnap = await db
          .collection('cphs_committees')
          .where('projectId', '==', projectId)
          .get();
        const committeeIds = committeesSnap.docs.map((d) => d.id);
        if (committeeIds.length === 0) return [];

        const chunkSize = 30;
        const meetingDocs: Array<{ id: string; data: () => unknown }> = [];
        for (let i = 0; i < committeeIds.length; i += chunkSize) {
          const chunk = committeeIds.slice(i, i + chunkSize);
          const snap = await db
            .collection('cphs_meetings')
            .where('committeeId', 'in', chunk)
            .get();
          meetingDocs.push(...snap.docs);
        }
        return meetingDocs.map(
          (d) =>
            ({ id: d.id, ...(d.data() as Record<string, unknown>) } as Record<
              string,
              unknown
            >),
        );
      }),
      safeRead('incidents', async () => {
        const snap = await byProject('incidents').get();
        return snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
          .filter((rec) => {
            const ts =
              (typeof rec.occurredAt === 'string' && rec.occurredAt) ||
              (typeof rec.createdAt === 'string' && rec.createdAt) ||
              '';
            return ts >= twelveMonthsAgoIso;
          });
      }),
      safeRead('criticalControls', async () => {
        const snap = await db
          .collection(`${tenantProjectPath}/critical_controls`)
          .get();
        return snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Record<string, unknown>),
        );
      }),
      safeRead('positiveObservations', async () => {
        const snap = await db
          .collection(`${tenantProjectPath}/positive_observations`)
          .where('observedAt', '>=', ninetyDaysAgoIso)
          .get();
        return snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Record<string, unknown>),
        );
      }),
      safeRead('confidentialReports', async () => {
        const snap = await db
          .collection(`${tenantProjectPath}/confidential_reports`)
          .where('submittedAt', '>=', ninetyDaysAgoIso)
          .get();
        return snap.docs.map(
          (d) => ({ id: d.id, ...d.data() } as Record<string, unknown>),
        );
      }),
      safeRead('project', async () => {
        const snap = await projectRef.get();
        return snap.exists
          ? [{ id: snap.id, ...snap.data() } as Record<string, unknown>]
          : [];
      }),
    ]);

    const project = projectDoc[0];
    const projectCreatedAt =
      project &&
      ((typeof project.createdAt === 'string' && project.createdAt) ||
        (typeof project.startDate === 'string' && project.startDate) ||
        null);
    const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;
    const projectAgeMs = projectCreatedAt
      ? now - Date.parse(projectCreatedAt)
      : Number.POSITIVE_INFINITY;
    const populatedFeeds: string[] = [];
    if (trainings.length > 0) populatedFeeds.push('trainings');
    if (correctiveActions.length > 0)
      populatedFeeds.push('corrective_actions');
    if (cphsMeetings.length > 0) populatedFeeds.push('cphs_meetings');
    if (criticalControls.length > 0)
      populatedFeeds.push('critical_controls');
    if (incidents.length > 0) populatedFeeds.push('incidents');
    if (positiveObservations.length > 0)
      populatedFeeds.push('positive_observations');
    if (confidentialReports.length > 0)
      populatedFeeds.push('confidential_reports');
    const feedsAvailable = populatedFeeds.length;
    const totalSignals =
      trainings.length +
      correctiveActions.length +
      cphsMeetings.length +
      criticalControls.length +
      incidents.length;
    const insufficient =
      (projectCreatedAt !== null && projectAgeMs < THREE_MONTHS_MS) ||
      feedsAvailable < 2;
    if (insufficient) {
      return res.json({
        insufficientData: true,
        reason:
          projectCreatedAt && projectAgeMs < THREE_MONTHS_MS
            ? 'project_too_new'
            : 'not_enough_signals',
        signalsCount: totalSignals,
        feedsAvailable,
        populatedFeeds,
        projectAgeDays: Number.isFinite(projectAgeMs)
          ? Math.round(projectAgeMs / (24 * 60 * 60 * 1000))
          : null,
      });
    }

    // ── Derivar señales ──────────────────────────────────────────────

    let trainingCoverage = 0;
    if (trainings.length > 0) {
      const nowIso = new Date(now).toISOString();
      const active = trainings.filter((t) => {
        const status = String(t.status ?? '');
        const expiresAt =
          typeof t.expiresAt === 'string' ? t.expiresAt : null;
        return status === 'active' && (!expiresAt || expiresAt >= nowIso);
      }).length;
      trainingCoverage = active / trainings.length;
    }

    let ipersCompleted = 0;
    if (criticalControls.length > 0) {
      const validated = criticalControls.filter((c) => {
        const v = c.validated ?? c.lastValidatedAt;
        return Boolean(v);
      }).length;
      ipersCompleted = validated / criticalControls.length;
    }

    const recentMeetings = cphsMeetings.filter((m) => {
      const heldAt = typeof m.heldAt === 'string' ? m.heldAt : null;
      const scheduledAt =
        typeof m.scheduledAt === 'string' ? m.scheduledAt : null;
      const when = heldAt ?? scheduledAt;
      return when !== null && when >= sixMonthsAgoIso;
    }).length;
    const cphsMeetingFrequency = Math.min(1, recentMeetings / 6);

    const leadingIndicatorsUsed: string[] = [];
    if (correctiveActions.length > 0)
      leadingIndicatorsUsed.push('corrective_actions');
    if (cphsMeetings.length > 0)
      leadingIndicatorsUsed.push('cphs_meetings');
    if (trainings.length > 0)
      leadingIndicatorsUsed.push('training_assignments');
    if (criticalControls.length > 0)
      leadingIndicatorsUsed.push('critical_controls');
    if (incidents.length > 0)
      leadingIndicatorsUsed.push('incident_reporting');
    if (positiveObservations.length > 0)
      leadingIndicatorsUsed.push('positive_observations');
    if (confidentialReports.length > 0)
      leadingIndicatorsUsed.push('confidential_reports');

    let rootCauseAnalysisRate = 0;
    if (incidents.length > 0) {
      const withRoot = incidents.filter((i) => {
        const rc = i.rootCause ?? i.rootCauseCategory;
        if (typeof rc === 'string' && rc.trim().length > 0) return true;
        if (typeof rc === 'object' && rc !== null) return true;
        return false;
      }).length;
      rootCauseAnalysisRate = withRoot / incidents.length;
    }

    let behaviorBasedSafety = 0;
    if (correctiveActions.length > 0) {
      const closed = correctiveActions.filter((a) => {
        const status = String(a.status ?? '');
        return status === 'closed' || status === 'verified';
      }).length;
      behaviorBasedSafety = closed / correctiveActions.length;
    }

    const executiveEngagement =
      project && project.executiveSponsorUid ? 0.6 : 0.4;

    const OBS_THRESHOLD = 5;
    const obsReachThreshold = positiveObservations.length >= OBS_THRESHOLD;
    const reportsReachThreshold =
      confidentialReports.length >= OBS_THRESHOLD;
    let workerEmpowerment: number;
    if (obsReachThreshold && reportsReachThreshold) {
      workerEmpowerment = 1.0;
    } else if (obsReachThreshold || reportsReachThreshold) {
      workerEmpowerment = 0.5;
    } else {
      workerEmpowerment = 0.2;
    }
    if (project && project.anonymousReportingEnabled === true) {
      workerEmpowerment = Math.max(workerEmpowerment, 0.7);
    }

    const integrationWithOperations =
      project &&
      (project.safetyPlanApproved === true || project.prevencionPlanId)
        ? 0.7
        : 0.4;

    let continuousImprovement = behaviorBasedSafety;
    if (correctiveActions.length > 0) {
      const verified = correctiveActions.filter(
        (a) => String(a.status ?? '') === 'verified',
      ).length;
      if (verified >= 5) {
        continuousImprovement = Math.min(1, continuousImprovement + 0.15);
      }
    }

    const signals = {
      trainingCoverage,
      ipersCompleted,
      cphsMeetingFrequency,
      leadingIndicatorsUsed,
      rootCauseAnalysisRate,
      behaviorBasedSafety,
      executiveEngagement,
      workerEmpowerment,
      integrationWithOperations,
      continuousImprovement,
    };

    const report = computeMaturityLevel(signals);
    const recommendations = recommendNextSteps(report);

    return res.json({
      report,
      recommendations,
      signals,
      metadata: {
        signalsCount: totalSignals,
        feedsAvailable,
        populatedFeeds,
        projectAgeDays: Number.isFinite(projectAgeMs)
          ? Math.round(projectAgeMs / (24 * 60 * 60 * 1000))
          : null,
        windowMonths: 12,
      },
    });
  } catch (err) {
    logger.error?.('maturity.error', err);
    captureRouteError(err, 'maturity');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
