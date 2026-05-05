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
    }
    const tookMs = Date.now() - start;
    logger.info('[maintenance] check-overdue done', {
      ...maintenance,
      ppe,
      susesoReminders,
      calendarPreWarn,
      tookMs,
    });
    return res
      .status(200)
      .json({ ok: true, ...maintenance, ppe, susesoReminders, calendarPreWarn, tookMs });
  } catch (err) {
    logger.error('[maintenance] check-overdue failed', err);
    return res
      .status(500)
      .json({ ok: false, error: 'internal_error', message: 'check-overdue failed' });
  }
});

// Re-export `admin` access through this module so the test harness can
// inject a fake; defensively imported here to keep this file the single
// entry point for the maintenance HTTP surface.
export { admin };
export default router;
