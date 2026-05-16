// SPDX-License-Identifier: MIT
//
// Bucket K.3 — HTTP wrapper for the overdue-maintenance reaper.
//
// Mount point (added in server.ts):
//   app.use('/api/maintenance', maintenanceRouter);
//
// The single endpoint is meant to be invoked by Cloud Scheduler on a
// ~1 h cadence:
//
//   POST /api/maintenance/check-overdue
//
// Auth model: Cloud Scheduler hits this with an OIDC token; we rely on
// IAP / Cloud Run service-to-service IAM rather than a per-user Firebase
// JWT. Inside the cluster the path is unauthenticated by default — if
// you mount it on the public ingress, gate it behind `verifyAuth` and
// an admin role check (mirrors `routes/admin.ts`).
//
// The handler is intentionally thin: it delegates to the pure job in
// `jobs/checkOverdueMaintenance.ts` and surfaces its counts in JSON.

import { Router } from 'express';
import admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { checkOverdueMaintenance } from '../jobs/checkOverdueMaintenance.js';
import { checkExpiredPpe } from '../jobs/checkExpiredPpe.js';
import { sendSusesoReminders } from '../jobs/sendSusesoReminders.js';
import { sendToProjectSupervisors } from './emergency.js';
import { verifySchedulerToken } from '../middleware/verifySchedulerToken.js';
// Sprint 29 Bucket DD F-E — predictive×calendar pre-warn cron.
// Mounted as a fourth no-op step after the SUSESO reminder reaper. The
// loader factories degrade to empty arrays in environments where the
// projects/tasks collection is not seeded yet, so the cron is safe to
// run from day one.
import { runCalendarPreWarnCron } from '../../services/predictiveAlerts/calendarPreWarn.js';
// Sprint 56 follow-up — resilience health alert cron.
import { runResilienceHealthAlertCron } from '../jobs/runResilienceHealthAlert.js';
import { fcmAdapter } from '../../services/notifications/fcmAdapter.js';
// Sprint E backend debt (2026-05-16) — B2D MRR monthly snapshot.
// El B2dAdminPanel hace render de la serie temporal MRR; sin este job
// solo aparece el punto del mes actual. Endpoint dedicado para Cloud
// Scheduler corriendo día 1 de cada mes a 00:30 UTC.
import { runB2dMrrSnapshot } from '../jobs/runB2dMrrSnapshot.js';

const router = Router();

router.post('/check-overdue', verifySchedulerToken, async (_req, res) => {
  const start = Date.now();
  try {
    const maintenance = await checkOverdueMaintenance();
    // Sprint 28 H26 — extend the same scheduler invocation to also reap
    // expired EPP assignments. Both jobs are independent and idempotent;
    // running them in sequence here keeps Cloud Scheduler config simple
    // (one cron entry instead of two).
    let ppe: { scanned: number; expired: number; notified: number } = {
      scanned: 0,
      expired: 0,
      notified: 0,
    };
    try {
      ppe = await checkExpiredPpe({
        notifySupervisors: ({ projectId, payload, db, messaging }) =>
          sendToProjectSupervisors(projectId, payload, db, messaging),
      });
    } catch (ppeErr) {
      logger.error('[maintenance] check-expired-ppe failed', ppeErr);
      captureRouteError(ppeErr, 'maintenance.check-expired-ppe');
    }
    // Sprint 28 follow-up — third step: SUSESO DIAT/DIEP deadline reminders.
    // Independent + idempotent like the prior two steps.
    let susesoReminders: Awaited<ReturnType<typeof sendSusesoReminders>> = {
      scanned: 0,
      remindedTotal: 0,
      escalations: { green: 0, yellow: 0, orange: 0, red: 0, overdue: 0 },
    };
    try {
      susesoReminders = await sendSusesoReminders();
    } catch (susesoErr) {
      logger.error('[maintenance] suseso-reminders failed', susesoErr);
      captureRouteError(susesoErr, 'maintenance.suseso-reminders');
    }
    // Sprint 29 Bucket DD F-E — predictive × calendar pre-warn.
    // Wired after SUSESO reminders so failures stay isolated. Factories
    // default to no-op behaviour when the project store is empty.
    let calendarPreWarn: { scanned: number; warned: number } = { scanned: 0, warned: 0 };
    try {
      const preWarnResult = await runCalendarPreWarnCron({
        loadProjects: async () => [],
        loadTasksForProject: async () => [],
        getWeatherForTask: async () => ({}),
        getSeismicForProject: async () => ({}),
        daysOfRisk: () => 1,
        dispatchPush: async () => ({ ok: false }),
        dispatchEmail: async () => ({ ok: false }),
        createCalendarEvent: async () => ({ id: null }),
        alreadyWarned: async () => false,
        markWarned: async () => undefined,
      });
      calendarPreWarn = { scanned: preWarnResult.scanned, warned: preWarnResult.warned };
    } catch (preWarnErr) {
      logger.error('[maintenance] calendar-prewarn failed', preWarnErr);
      captureRouteError(preWarnErr, 'maintenance.calendar-prewarn');
    }
    // Sprint 56 follow-up — fifth step: resilience health alert.
    // Server-side check del firestore reachability + alert FCM a admins
    // si flips a critical. Política `strict` para no spammear con
    // subsystems no-medibles desde server (slm/zk/device_kek son
    // client-only y devuelven 'unknown' → degraded bajo slm_priority).
    let resilienceHealth: {
      status: string;
      alertFired: boolean;
      reportPersisted: boolean;
    } = {
      status: 'unknown',
      alertFired: false,
      reportPersisted: false,
    };
    try {
      const db = admin.firestore();
      const healthResult = await runResilienceHealthAlertCron({
        db,
        checkers: {
          firestore: async () => {
            // Ping a un doc canónico — si la lectura falla, Firestore está down.
            try {
              await db.collection('_health').doc('ping').get();
              return {
                id: 'firestore',
                status: 'healthy',
                detail: 'Firestore reachable (ping doc OK).',
              };
            } catch (err) {
              return {
                id: 'firestore',
                status: 'critical',
                detail: 'Firestore read failed.',
                error: err instanceof Error ? err.message : String(err),
              };
            }
          },
          // Network siempre healthy server-side — si el cron corre, hay red.
          network: async () => ({
            id: 'network',
            status: 'healthy',
            detail: 'Server-side cron running → network up.',
          }),
        },
        checkerTimeoutMs: 4_000,
        notifyOps: async (report) => {
          // Recolectar FCM tokens de admins globales (claim role='admin').
          // Estrategia: query users where customClaims.role='admin' usaria
          // Auth Admin SDK; aquí seguimos el patrón existing y leemos los
          // tokens desde `users/{uid}.fcmTokens[]` para usuarios cuyo
          // `role === 'admin'` en el doc.
          let adminTokens: string[] = [];
          try {
            const snap = await db
              .collection('users')
              .where('role', '==', 'admin')
              .limit(100)
              .get();
            for (const doc of snap.docs) {
              const data = doc.data() as { fcmTokens?: string[] };
              if (Array.isArray(data.fcmTokens)) {
                adminTokens.push(...data.fcmTokens.filter((t) => typeof t === 'string' && t));
              }
            }
            adminTokens = Array.from(new Set(adminTokens)); // dedup
          } catch (e) {
            logger.warn('[maintenance] resilience-health admin token query failed', {
              err: String(e),
            });
          }
          if (adminTokens.length === 0) {
            logger.warn(
              '[maintenance] resilience-health: critical pero NO hay admin tokens — alert no se envía',
            );
            return;
          }
          const criticalSubsystems = report.subsystems
            .filter((s) => s.status === 'critical')
            .map((s) => s.id)
            .join(', ');
          await fcmAdapter.sendToTokens(adminTokens, {
            title: '⚠️ Praeventio: subsistema crítico',
            body: `Estado: critical. Subsistemas: ${criticalSubsystems || 'n/a'}`,
            data: {
              kind: 'resilience_health_alert',
              overallStatus: report.overallStatus,
              criticalSubsystems: criticalSubsystems,
              generatedAt: report.generatedAt,
            },
          });
        },
      });
      resilienceHealth = {
        status: healthResult.overallStatus,
        alertFired: healthResult.alertFired,
        reportPersisted: healthResult.reportPersisted,
      };
    } catch (healthErr) {
      logger.error('[maintenance] resilience-health failed', healthErr);
      captureRouteError(healthErr, 'maintenance.resilience-health');
    }
    const tookMs = Date.now() - start;
    logger.info('[maintenance] check-overdue done', {
      ...maintenance,
      ppe,
      susesoReminders,
      calendarPreWarn,
      resilienceHealth,
      tookMs,
    });
    return res
      .status(200)
      .json({
        ok: true,
        ...maintenance,
        ppe,
        susesoReminders,
        calendarPreWarn,
        resilienceHealth,
        tookMs,
      });
  } catch (err) {
    logger.error('[maintenance] check-overdue failed', err);
    captureRouteError(err, 'maintenance.check-overdue');
    return res
      .status(500)
      .json({ ok: false, error: 'internal_error', message: 'check-overdue failed' });
  }
});

// Sprint E backend debt (2026-05-16) — B2D MRR monthly snapshot.
//
//   POST /api/maintenance/run-b2d-mrr-snapshot
//
// Cloud Scheduler corre esto día 1 de cada mes a 00:30 UTC para
// capturar las métricas finales del mes anterior. Es idempotente:
// puede re-correrse a mediados de mes para refrescar el valor en
// curso sin borrar `capturedAt`.
router.post('/run-b2d-mrr-snapshot', verifySchedulerToken, async (_req, res) => {
  const start = Date.now();
  try {
    const db = admin.firestore();
    const result = await runB2dMrrSnapshot({ db });
    logger.info('[maintenance] b2d-mrr-snapshot done', {
      monthKey: result.monthKey,
      created: result.created,
      mrr: result.snapshot.mrr,
      arr: result.snapshot.arr,
      tookMs: Date.now() - start,
    });
    return res.status(200).json({
      ok: true,
      monthKey: result.monthKey,
      created: result.created,
      mrr: result.snapshot.mrr,
      arr: result.snapshot.arr,
      customersActive: result.snapshot.customersActive,
      tookMs: Date.now() - start,
    });
  } catch (err) {
    logger.error('[maintenance] b2d-mrr-snapshot failed', err);
    captureRouteError(err, 'maintenance.b2d-mrr-snapshot');
    return res
      .status(500)
      .json({ ok: false, error: 'internal_error', message: 'b2d-mrr-snapshot failed' });
  }
});

// Re-export `admin` access through this module so the test harness can
// inject a fake; defensively imported here to keep this file the single
// entry point for the maintenance HTTP surface.
export { admin };
export default router;
