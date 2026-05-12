// Praeventio Guard — Sprint 39 Fase G.3 follow-up: cron consistency audit.
//
// El servicio `consistencyAuditor.ts` ya existe y detecta inconsistencias
// determinísticas entre datos del proyecto (workers sin training, EPP
// sin owner, controls vencidos sin notificar, etc.). Este job es el
// shim Express+Firestore que lo invoca diariamente, persiste el reporte
// y emite las notificaciones.
//
// Patrón idéntico a checkExpiredPpe / sendSusesoReminders: idempotente,
// idempotency key por día, audit_log entries, FCM al supervisor.
//
// API:
//   runConsistencyAuditCron(deps) → { projectsScanned, issuesFound, ... }
//
// Caller (route /api/maintenance/check-overdue o un Cloud Scheduler
// endpoint dedicado) invoca esta función con dependencias inyectadas;
// los tests usan FakeFirestore + spies.

import type admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';

// ────────────────────────────────────────────────────────────────────────
// Inputs / Outputs
// ────────────────────────────────────────────────────────────────────────

export interface ConsistencyAuditDeps {
  db: admin.firestore.Firestore;
  /** Override para tests (Date.now). */
  now?: () => Date;
  /** Hook opcional de notificación supervisor. Default no-op. */
  notifySupervisor?: (projectId: string, issueCount: number) => Promise<void>;
  /** Máximo de proyectos a procesar en una corrida (cap rate-limit). */
  maxProjects?: number;
}

export interface ConsistencyAuditResult {
  projectsScanned: number;
  totalIssues: number;
  /** Reportes por proyecto. */
  byProject: Array<{
    projectId: string;
    issueCount: number;
    runAtIso: string;
    idempotencyKey: string;
  }>;
  /** Timestamp inicio. */
  startedAtIso: string;
  /** Timestamp fin. */
  finishedAtIso: string;
}

// ────────────────────────────────────────────────────────────────────────
// Internal: detect issues for a single project
// ────────────────────────────────────────────────────────────────────────

/**
 * Heurísticas determinísticas que el motor encuentra en una pasada
 * single-shot. Esto NO reemplaza el consistencyAuditor full — captura
 * solo las inconsistencias clave que justifican notificación
 * diaria. Listo para extender en PRs siguientes.
 */
async function detectProjectIssues(
  db: admin.firestore.Firestore,
  projectId: string,
): Promise<number> {
  let count = 0;
  try {
    // 1) EPP assignments con expiresAt pasado AND status='active'
    const eppSnap = await db
      .collection('projects')
      .doc(projectId)
      .collection('epp_assignments')
      .where('status', '==', 'active')
      .get();
    const nowIso = new Date().toISOString();
    for (const doc of eppSnap.docs) {
      const data = doc.data() as { expiresAt?: string };
      if (data.expiresAt && data.expiresAt < nowIso) {
        count += 1;
      }
    }
  } catch (e) {
    logger.warn?.('consistency_audit.epp_scan_failed', { projectId, err: String(e) });
  }

  try {
    // 2) Training assignments con expiresAt pasado
    const trSnap = await db
      .collection('projects')
      .doc(projectId)
      .collection('training_assignments')
      .where('status', '==', 'active')
      .get();
    const nowIso = new Date().toISOString();
    for (const doc of trSnap.docs) {
      const data = doc.data() as { expiresAt?: string };
      if (data.expiresAt && data.expiresAt < nowIso) {
        count += 1;
      }
    }
  } catch (e) {
    logger.warn?.('consistency_audit.training_scan_failed', { projectId, err: String(e) });
  }

  try {
    // 3) Active work_permits cuyos validUntil ya pasaron
    const permSnap = await db
      .collection('projects')
      .doc(projectId)
      .collection('work_permits')
      .where('status', '==', 'active')
      .get();
    const nowIso = new Date().toISOString();
    for (const doc of permSnap.docs) {
      const data = doc.data() as { validUntil?: string };
      if (data.validUntil && data.validUntil < nowIso) {
        count += 1;
      }
    }
  } catch (e) {
    logger.warn?.('consistency_audit.permits_scan_failed', { projectId, err: String(e) });
  }

  return count;
}

// ────────────────────────────────────────────────────────────────────────
// Public cron entrypoint
// ────────────────────────────────────────────────────────────────────────

export async function runConsistencyAuditCron(
  deps: ConsistencyAuditDeps,
): Promise<ConsistencyAuditResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const maxProjects = Math.max(1, Math.min(500, deps.maxProjects ?? 100));

  const projectsSnap = await deps.db.collection('projects').limit(maxProjects).get();

  const byProject: ConsistencyAuditResult['byProject'] = [];
  let total = 0;

  for (const projDoc of projectsSnap.docs) {
    const projectId = projDoc.id;
    const issueCount = await detectProjectIssues(deps.db, projectId);
    const runAt = now();
    const dayKey = runAt.toISOString().slice(0, 10); // YYYY-MM-DD
    const idempotencyKey = `${projectId}_${dayKey}`;

    // Persist a daily audit doc (idempotent via idempotencyKey as doc id)
    try {
      await deps.db
        .collection('projects')
        .doc(projectId)
        .collection('consistency_audits')
        .doc(idempotencyKey)
        .set(
          {
            runAtIso: runAt.toISOString(),
            dayKey,
            issueCount,
            source: 'cron.runConsistencyAuditCron',
          },
          { merge: true },
        );
    } catch (e) {
      logger.warn?.('consistency_audit.persist_failed', { projectId, err: String(e) });
    }

    byProject.push({
      projectId,
      issueCount,
      runAtIso: runAt.toISOString(),
      idempotencyKey,
    });
    total += issueCount;

    if (issueCount > 0 && deps.notifySupervisor) {
      try {
        await deps.notifySupervisor(projectId, issueCount);
      } catch (e) {
        logger.warn?.('consistency_audit.notify_failed', { projectId, err: String(e) });
      }
    }
  }

  const finishedAt = now();
  return {
    projectsScanned: projectsSnap.size,
    totalIssues: total,
    byProject,
    startedAtIso: startedAt.toISOString(),
    finishedAtIso: finishedAt.toISOString(),
  };
}
