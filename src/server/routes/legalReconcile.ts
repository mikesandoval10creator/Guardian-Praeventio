// Legal-unlock by dotación — re-evaluate headcount-triggered legal obligations.
//
// Onboarding seeds dotación obligations ONCE, from the *estimated* headcount
// (`onboarding.ts` → `buildProjectSeeds` → `projects/{pid}/legal_obligations`).
// When the real roster later grows past a CL pack threshold (25 → CPHS,
// 100 → Departamento de Prevención) nothing re-evaluates, so the now-mandatory
// obligation is never materialised and the reminder cron
// (`runLegalCalendarReminders`) never alerts. This endpoint re-runs that pure
// computation against the project's CURRENT `workersCount` and idempotently
// upserts ONLY the missing obligations into the SAME subcollection the
// onboarding seeder and the reminder cron use.
//
// Directivas de producto (no negociables):
//   • NUNCA push automático a organismos (SUSESO/SII/MINSAL/Mutualidad): esto
//     solo materializa la obligación interna; la empresa la cumple/firma/
//     entrega manualmente y el cron existente la recuerda.
//   • Vida JAMÁS se gatea (ADR 0021). Esto es cumplimiento legal de gestión,
//     disponible a cualquier miembro del proyecto — no es feature de scale.
//   • Identidad desde el token; audit_logs awaited en la mutación (#3/#14).
//   • NUNCA borra obligaciones (ver `reconcileObligationSeeds`): una obligación
//     que dejó de aplicar se supersede por decisión de admin/supervisor, no
//     automáticamente.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  buildProjectSeeds,
  reconcileObligationSeeds,
} from '../../services/sii/projectSeeds.js';
import { CL_PACK } from '../../data/normativa/cl.js';

const router = Router();

const SUBCOLLECTION = 'legal_obligations';

interface ProjectDocShape {
  workersCount?: unknown;
  country?: unknown;
  metadata?: { sectorId?: unknown; codigoActividadSii?: unknown } | null;
}

// ────────────────────────────────────────────────────────────────────────
// POST /:projectId/reconcile-obligations
//   Re-evaluates the project's headcount-triggered legal obligations and
//   materialises any that a roster change just made mandatory. Idempotent:
//   re-running it when nothing changed creates nothing.
// ────────────────────────────────────────────────────────────────────────
router.post('/:projectId/reconcile-obligations', verifyAuth, idempotencyKey(), async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;

  // Firestore doc-id safety: projectId is the only client-controlled segment of
  // the doc paths below. Reject anything outside the isValidId charset before it
  // reaches Firestore (defense in depth; Express already blocks an encoded "/").
  if (!projectId || !/^[A-Za-z0-9_-]{1,128}$/.test(projectId)) {
    return res.status(400).json({ error: 'invalid_project_id' });
  }

  // Project-membership gate (same contract as the legal-calendar router).
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    captureRouteError(err, 'legalReconcile.guard', { callerUid, projectId });
    return res.status(500).json({ error: 'internal_error' });
  }

  try {
    const db = admin.firestore();
    const projectSnap = await db.collection('projects').doc(projectId).get();
    if (!projectSnap.exists) {
      return res.status(404).json({ error: 'project_not_found' });
    }
    const project = (projectSnap.data() ?? {}) as ProjectDocShape;

    const workersCount =
      typeof project.workersCount === 'number' && Number.isFinite(project.workersCount)
        ? project.workersCount
        : null;
    // Dotación thresholds are Chilean law — only reconcile for CL projects.
    // The project doc stores a single `country`; CL is the platform default
    // when unset (matching the Project type contract in ProjectContext).
    const country = typeof project.country === 'string' ? project.country : 'CL';
    const operatesInChile = country === 'CL';
    const sectorId =
      typeof project.metadata?.sectorId === 'string' ? project.metadata.sectorId : null;
    const siiCode =
      typeof project.metadata?.codigoActividadSii === 'number'
        ? project.metadata.codigoActividadSii
        : null;

    // Reconstruct the SAME seed input onboarding used so the deterministic ids
    // line up — the reconcile is idempotent against the onboarding seeds.
    const { obligationSeeds } = buildProjectSeeds({
      projectId,
      siiCode,
      sectorId,
      workerCount: operatesInChile ? workersCount : null,
      pack: CL_PACK,
      now: new Date(),
    });

    // Existing obligation ids in the project's subcollection (the path the
    // onboarding seeder and the reminder cron both use).
    const existingSnap = await db
      .collection('projects')
      .doc(projectId)
      .collection(SUBCOLLECTION)
      .get();
    const existingIds = new Set<string>(existingSnap.docs.map((d) => d.id));

    const { toCreate, alreadyPresent } = reconcileObligationSeeds(
      obligationSeeds,
      existingIds,
    );

    // Atomic upsert: a WriteBatch keeps the new obligations consistent (no
    // partial write that could 500 after some docs already landed) and makes
    // the audit row track a single committed state change.
    if (toCreate.length > 0) {
      const batch = db.batch();
      const obligations = db
        .collection('projects')
        .doc(projectId)
        .collection(SUBCOLLECTION);
      for (const seed of toCreate) {
        batch.set(obligations.doc(seed.id), seed.doc);
      }
      await batch.commit();
    }

    // Audit invariant (#3/#14): one awaited row when state changed. uid/email
    // are stamped from the verified token by auditServerEvent — never client.
    if (toCreate.length > 0) {
      try {
        await auditServerEvent(
          req,
          'legal.obligationsReconciled',
          'legal',
          {
            projectId,
            workersCount,
            created: toCreate.map((s) => s.id),
            alreadyPresent: alreadyPresent.length,
          },
          { projectId },
        );
      } catch (auditErr) {
        logger.error('audit_event_failed', auditErr as Error, {
          action: 'legal.obligationsReconciled',
          projectId,
        });
        captureRouteError(auditErr, 'legalReconcile.audit', { callerUid, projectId });
      }
    }

    // `note` distinguishes a structural no-op (non-CL project, or a project doc
    // with missing/zero headcount — possibly a misconfiguration) from a genuine
    // "everything already present" reconcile, without echoing the raw headcount
    // (that lives in the audit row, not the response).
    let note: string | undefined;
    if (!operatesInChile) note = 'non_cl_project';
    else if (workersCount == null || workersCount <= 0) note = 'no_eligible_headcount';

    return res.json({
      created: toCreate.map((s) => ({ id: s.id, label: s.doc.label })),
      createdCount: toCreate.length,
      alreadyPresent: alreadyPresent.length,
      ...(note ? { note } : {}),
    });
  } catch (err) {
    logger.error('legalReconcile.error', err as Error, { callerUid, projectId });
    captureRouteError(err, 'legalReconcile', { callerUid, projectId });
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
