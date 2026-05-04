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
import { logger } from '../../utils/logger.js';
import { checkOverdueMaintenance } from '../jobs/checkOverdueMaintenance.js';

const router = Router();

router.post('/check-overdue', async (_req, res) => {
  const start = Date.now();
  try {
    const result = await checkOverdueMaintenance();
    const tookMs = Date.now() - start;
    logger.info('[maintenance] check-overdue done', { ...result, tookMs });
    return res.status(200).json({ ok: true, ...result, tookMs });
  } catch (err) {
    logger.error('[maintenance] check-overdue failed', err);
    return res
      .status(500)
      .json({ ok: false, error: 'internal_error', message: 'check-overdue failed' });
  }
});

export default router;
