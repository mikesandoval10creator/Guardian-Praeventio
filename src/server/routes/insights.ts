// Praeventio Guard — Wire UI bridge: /api/insights routes.
//
// Read-only endpoints that consume the PURE engines (no persistence
// writes) and return shaped JSON for the dashboard widgets:
//
//   GET /api/insights/:projectId/risk-ranking
//   GET /api/insights/:projectId/safety-talks
//   GET /api/insights/:projectId/role-view?userId=...
//
// Each endpoint:
//   1. verifies caller is a member of the project
//   2. reads the input state from Firestore (lightweight queries)
//   3. invokes the deterministic engine (pure function)
//   4. returns the result
//
// No Firestore writes — these are read paths. Mutations live in their
// respective domain routes (sitebook.ts, etc.).

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  rankRisks,
  rankWeakControls,
  type RiskRecord,
  type ControlRecord,
} from '../../services/riskRanking/riskRankingEngine.js';
import {
  rankRiskNodesByIper,
  type RiskNodeInput,
} from '../../services/riskRanking/riskNodeRanking.js';
import {
  suggestTalks,
  type ContextSignals,
} from '../../services/safetyTalks/talkTopicSuggester.js';
import {
  buildRoleView,
  type RoleViewState,
  type UserRole,
} from '../../services/roleViews/roleViewBuilder.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';

const router = Router();

async function guardProjectAccess(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<boolean> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
    return true;
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return false;
    }
    throw err;
  }
}

/** Resolve a project's tenantId (project doc, then members sub-collection). */
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/insights/:projectId/risk-ranking
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/risk-ranking', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!(await guardProjectAccess(callerUid, projectId, res))) return undefined;

  const topN = Math.min(Math.max(Number(req.query.topN) || 5, 1), 20);

  try {
    const db = admin.firestore();
    const [riskSnap, controlSnap] = await Promise.all([
      db.collection('risks').where('projectId', '==', projectId).limit(200).get(),
      db.collection('controls').where('projectId', '==', projectId).limit(200).get(),
    ]);
    const risks: RiskRecord[] = riskSnap.docs.map((d) => d.data() as RiskRecord);
    const controls: ControlRecord[] = controlSnap.docs.map((d) => d.data() as ControlRecord);

    const topRisks = rankRisks(risks, topN);
    const weakControls = rankWeakControls(controls, topN);

    return res.json({ topRisks, weakControls, computedAt: new Date().toISOString() });
  } catch (err) {
    logger.error?.('insights.risk_ranking.error', err);
    captureRouteError(err, 'insights.risk_ranking');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ────────────────────────────────────────────────────────────────────────
// GET /api/insights/:projectId/top-risks
//
// REAL pull-based ranking (B2 🔵, Fase 5): ranks the project's
// `NodeType.RISK` ('Riesgo') Zettelkasten nodes by their DS44 IPER score
// (probabilidad × severidad → calculateIper). Replaces the idle `useTopRisks`
// stub that fed an orphan dashboard from the empty flat `risks` collection.
// Source of truth = `tenants/{tid}/zettelkasten_nodes` (what the Matrix IPER
// page actually writes). `type` is filtered in-memory to avoid a composite
// index. See ADR 0020 (Zettelkasten-canonical source).
// ────────────────────────────────────────────────────────────────────────
router.get('/:projectId/top-risks', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!(await guardProjectAccess(callerUid, projectId, res))) return undefined;
  const db = admin.firestore();
  const tenantId = await resolveTenantId(callerUid, projectId, db);
  if (!tenantId) {
    return res.status(404).json({ error: 'tenant_not_found' });
  }
  const topN = Math.min(Math.max(Number(req.query.topN) || 10, 1), 50);
  try {
    const snap = await db
      .collection('tenants')
      .doc(tenantId)
      .collection('zettelkasten_nodes')
      .where('projectId', '==', projectId)
      .limit(2000)
      .get();
    const nodes: RiskNodeInput[] = snap.docs
      .filter((d) => (d.data() ?? {}).type === 'Riesgo') // NodeType.RISK
      .map((d) => {
        const data = d.data() ?? {};
        const meta = (data.metadata ?? {}) as Record<string, unknown>;
        return {
          id: d.id,
          title: typeof data.title === 'string' ? data.title : '(sin título)',
          category:
            typeof meta.riesgo === 'string'
              ? meta.riesgo
              : typeof meta.actividad === 'string'
                ? meta.actividad
                : undefined,
          probabilidad:
            typeof meta.probabilidad === 'number' ? meta.probabilidad : undefined,
          severidad: typeof meta.severidad === 'number' ? meta.severidad : undefined,
        };
      });
    const topRisks = rankRiskNodesByIper(nodes, topN);
    return res.json({
      topRisks,
      total: nodes.length,
      computedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error?.('insights.top_risks.error', err);
    captureRouteError(err, 'insights.top_risks');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/insights/:projectId/safety-talks
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/:projectId/safety-talks', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!(await guardProjectAccess(callerUid, projectId, res))) return undefined;

  try {
    const db = admin.firestore();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [incidentSnap, riskSnap, taskSnap, findingSnap] = await Promise.all([
      db
        .collection('incidents')
        .where('projectId', '==', projectId)
        .where('occurredAt', '>=', sevenDaysAgo)
        .limit(50)
        .get(),
      db.collection('risks').where('projectId', '==', projectId).limit(100).get(),
      db
        .collection('tasks')
        .where('projectId', '==', projectId)
        .where('scheduledFor', '>=', new Date().toISOString().slice(0, 10))
        .limit(50)
        .get(),
      db
        .collection('findings')
        .where('projectId', '==', projectId)
        .where('status', '==', 'open')
        .limit(100)
        .get(),
    ]);

    const findingsByCategory: Record<string, number> = {};
    for (const d of findingSnap.docs) {
      const data = d.data() as { category?: string };
      const cat = data.category ?? 'other';
      findingsByCategory[cat] = (findingsByCategory[cat] ?? 0) + 1;
    }

    const signals: ContextSignals = {
      recentIncidents: incidentSnap.docs.map((d) => {
        const data = d.data() as { kind?: string; severity?: 'low' | 'medium' | 'high' | 'critical' };
        return { kind: data.kind ?? 'other', severity: data.severity ?? 'low' };
      }),
      activeRisks: riskSnap.docs.map((d) => (d.data() as { category?: string }).category ?? 'unknown'),
      todaysTaskCategories: taskSnap.docs.map(
        (d) => (d.data() as { riskCategory?: string }).riskCategory ?? 'other',
      ),
      openFindingsByCategory: findingsByCategory,
      newWorkersCount: 0, // optional optimization: query workers with createdAt < 7d
    };

    const suggestions = suggestTalks(signals);
    return res.json({ suggestions, signalsSummary: { counts: {
      incidents: signals.recentIncidents.length,
      risks: signals.activeRisks.length,
      tasks: signals.todaysTaskCategories.length,
      findings: findingSnap.size,
    } } });
  } catch (err) {
    logger.error?.('insights.safety_talks.error', err);
    captureRouteError(err, 'insights.safety_talks');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// GET /api/insights/:projectId/role-view
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Aggregates the minimal counts that `buildRoleView` needs. The caller's
// claims drive `userRole`; counts are scoped to (projectId, callerUid).

const VALID_ROLES: UserRole[] = ['worker', 'site_chief', 'prevention', 'management'];

router.get('/:projectId/role-view', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const callerEmail = req.user!.email ?? null;
  const callerRole = req.user!.role ?? 'worker';
  const { projectId } = req.params;
  if (!(await guardProjectAccess(callerUid, projectId, res))) return undefined;

  const userRole: UserRole = VALID_ROLES.includes(callerRole as UserRole)
    ? (callerRole as UserRole)
    : 'worker';

  try {
    const db = admin.firestore();
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

    const queries: Array<Promise<{ count: number; label: string }>> = [
      // todaysTasks for this user
      db
        .collection('tasks')
        .where('projectId', '==', projectId)
        .where('assignedToUid', '==', callerUid)
        .where('scheduledFor', '==', today)
        .get()
        .then((s) => ({ count: s.size, label: 'todaysTasks' })),
      // overdueActions for this project (site_chief view)
      db
        .collection('corrective_actions')
        .where('projectId', '==', projectId)
        .where('status', '==', 'open')
        .where('dueDate', '<', today)
        .get()
        .then((s) => ({ count: s.size, label: 'overdueActions' })),
      // criticalIncidentsLast7d
      db
        .collection('incidents')
        .where('projectId', '==', projectId)
        .where('severity', '==', 'critical')
        .where('occurredAt', '>=', sevenDaysAgo)
        .get()
        .then((s) => ({ count: s.size, label: 'criticalIncidentsLast7d' })),
      // myEppExpiringSoon
      db
        .collection('epp_assignments')
        .where('workerUid', '==', callerUid)
        .where('expiresAt', '<=', thirtyDaysFromNow)
        .get()
        .then((s) => ({ count: s.size, label: 'myEppExpiringSoon' })),
      // myTrainingExpiringSoon
      db
        .collection('trainings')
        .where('workerUid', '==', callerUid)
        .where('expiresAt', '<=', thirtyDaysFromNow)
        .get()
        .then((s) => ({ count: s.size, label: 'myTrainingExpiringSoon' })),
    ];

    const results = await Promise.all(queries);
    const counts = Object.fromEntries(results.map((r) => [r.label, r.count]));

    const projDoc = await db.collection('projects').doc(projectId).get();
    const projData = projDoc.exists ? (projDoc.data() as any) : {};

    const state: RoleViewState = {
      userUid: callerUid,
      userRole,
      overdueActions: counts.overdueActions ?? 0,
      pendingApprovals: 0,
      todaysTasks: counts.todaysTasks ?? 0,
      myEppExpiringSoon: counts.myEppExpiringSoon ?? 0,
      myTrainingExpiringSoon: counts.myTrainingExpiringSoon ?? 0,
      myUnreadDocuments: 0,
      criticalIncidentsLast7d: counts.criticalIncidentsLast7d ?? 0,
      faenaState: projData.faenaState ?? 'operativa',
      complianceScore: projData.complianceScore,
    };

    const cards = buildRoleView(state);
    return res.json({ state, cards, userEmail: callerEmail });
  } catch (err) {
    logger.error?.('insights.role_view.error', err);
    captureRouteError(err, 'insights.role_view');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
