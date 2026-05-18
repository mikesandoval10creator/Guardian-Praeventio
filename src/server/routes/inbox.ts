// Praeventio Guard — Fase F.8 Inbox del Prevencionista.
//
// Endpoint dedicado para `/api/sprint-k/:projectId/inbox`.
// Migrado del monolito `sprintK.ts` (2026-05-18).
//
// Agrega N feeds heterogéneos en una única lista ordenada por urgencia,
// reusando los adapters Sprint K/L ya wireados (corrective actions, SIF).
// El resto de los canales (documents_pending_approval, repeating_risk_alerts,
// workers_onboarding) viajan en sub-PRs siguientes — la versión actual
// envía arrays vacíos honestos para esos slots.
//
// Output: { items: InboxItem[], summary: InboxSummary } — listo para
// renderizar con <InboxPrevencionistaPanel>.
//
// Codex P2 fixes preservados (PR #309 round 4):
//   - Incluir status `in_progress` + `reopened` además de `open` (trabajo
//     no resuelto del prevencionista, no solo recién abierto).
//   - Filter por `responsibleUid` para que cada prevencionista vea su
//     propio queue (legacy sin responsibleUid → fallback include all).
//   - Sintetizar `dueDate` en records legacy (created + 30d) para no
//     marcarlos todos overdue por default.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { CorrectiveActionsAdapter } from '../../services/correctiveActions/correctiveActionsFirestoreAdapter.js';
import { SIFAdapter } from '../../services/sif/sifFirestoreAdapter.js';

const router = Router();

async function resolveTenantId(
  _callerUid: string,
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

router.get('/:projectId/inbox', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const { aggregateInbox, summarizeInbox } = await import(
      '../../services/inbox/inboxAggregator.js'
    );

    const correctiveAdapter = new CorrectiveActionsAdapter(
      admin.firestore() as any,
      g.tenantId,
      projectId,
    );
    const sifAdapter = new SIFAdapter(
      admin.firestore() as any,
      g.tenantId,
      projectId,
    );

    const [openActions, inProgressActions, reopenedActions, sifPending] =
      await Promise.all([
        correctiveAdapter.listByStatus('open').catch((err) => {
          logger.warn?.('inbox.corrective.open.fetch_failed', err);
          return [] as Awaited<
            ReturnType<typeof correctiveAdapter.listByStatus>
          >;
        }),
        correctiveAdapter.listByStatus('in_progress').catch((err) => {
          logger.warn?.('inbox.corrective.in_progress.fetch_failed', err);
          return [] as Awaited<
            ReturnType<typeof correctiveAdapter.listByStatus>
          >;
        }),
        correctiveAdapter.listByStatus('reopened').catch((err) => {
          logger.warn?.('inbox.corrective.reopened.fetch_failed', err);
          return [] as Awaited<
            ReturnType<typeof correctiveAdapter.listByStatus>
          >;
        }),
        sifAdapter.listPendingExecutiveReview().catch((err) => {
          logger.warn?.('inbox.sif.fetch_failed', err);
          return [] as Awaited<
            ReturnType<typeof sifAdapter.listPendingExecutiveReview>
          >;
        }),
      ]);

    const unresolvedActions = [
      ...openActions,
      ...inProgressActions,
      ...reopenedActions,
    ];
    const actionsForCaller = unresolvedActions.filter((a) => {
      const extra = a as unknown as { responsibleUid?: string };
      if (
        typeof extra.responsibleUid === 'string' &&
        extra.responsibleUid.length > 0
      ) {
        return extra.responsibleUid === callerUid;
      }
      return true;
    });

    const items = aggregateInbox(
      {
        documentsPending: [],
        incidentsPending: [],
        correctiveActionsOpen: actionsForCaller.map((a) => {
          const extra = a as unknown as { dueDate?: string };
          const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
          const synthDue = new Date(Date.now() + thirtyDaysMs).toISOString();
          return {
            id: a.id,
            label: a.description.slice(0, 80),
            dueDate: extra.dueDate ?? synthDue,
          };
        }),
        eppPendingValidation: [],
        workersPendingOnboarding: [],
        repeatingRiskAlerts: [],
        dataQualityGaps: [],
        sifPrecursorsPending: sifPending.map((p) => ({
          id: p.id,
          kind: p.kind,
          summary: Array.isArray(p.rationale) ? p.rationale.join(' · ') : '',
          createdAt: p.occurredAt,
        })),
        legalObligationsDueSoon: [],
        exceptionsExpiringSoon: [],
        responsibleUid: callerUid,
      },
      { now: new Date() },
    );

    const summary = summarizeInbox(items, new Date().toISOString());

    return res.json({ items, summary });
  } catch (err) {
    logger.error?.('inbox.error', err);
    captureRouteError(err, 'inbox');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
