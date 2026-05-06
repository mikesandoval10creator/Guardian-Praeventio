// SPDX-License-Identifier: MIT
//
// Sprint 35 audit P1 §1.3 — Cloud Scheduler entrypoints for batch
// jobs that have no in-process timer. Sprint 32 Bucket UU added
// `aggregateAiFeedback` (weekly RLHF rollup) but never wired a trigger;
// this router exposes the HTTP shim Cloud Scheduler can hit.
//
// Cloud Scheduler config (one-shot, weekly):
//   • cron:        `0 3 * * 0`   (Sun 03:00 UTC)
//   • target:      POST https://<service>/api/admin/jobs/aggregate-ai-feedback
//   • headers:     Authorization: Bearer ${SCHEDULER_SHARED_SECRET}
//   • timeZone:    Etc/UTC
//   • retry:       3 attempts, exp backoff (defaults are fine)
//
// All routes here are gated by `verifySchedulerToken` — they MUST NOT
// be reachable from public ingress without the shared bearer secret.

import { Router } from 'express';
import { logger } from '../../utils/logger.js';
import { verifySchedulerToken } from '../middleware/verifySchedulerToken.js';
import { aggregateAiFeedback } from '../jobs/aggregateAiFeedback.js';
import { getErrorTracker } from '../../services/observability/index.js';

const router = Router();

router.post('/aggregate-ai-feedback', verifySchedulerToken, async (_req, res) => {
  const start = Date.now();
  try {
    const result = await aggregateAiFeedback();
    logger.info('[adminJobs] aggregate-ai-feedback complete', {
      tenantsProcessed: result.tenantsProcessed,
      summariesWritten: result.summariesWritten,
      totalItems: result.totalItems,
      week: result.week,
      durationMs: Date.now() - start,
    });
    return res.json({
      ok: true,
      week: result.week,
      tenantsProcessed: result.tenantsProcessed,
      summariesWritten: result.summariesWritten,
      totalItems: result.totalItems,
      durationMs: Date.now() - start,
    });
  } catch (err) {
    logger.error(
      '[adminJobs] aggregate-ai-feedback failed',
      err instanceof Error ? err : new Error(String(err)),
    );
    try {
      getErrorTracker().captureException(
        err instanceof Error ? err : new Error(String(err)),
        { trigger: 'aggregateAiFeedbackJob', tags: { phase: 'http' } } as any,
      );
    } catch {
      /* swallow — observability MUST NOT break the response */
    }
    return res.status(500).json({ ok: false, error: 'job_failed' });
  }
});

export default router;
