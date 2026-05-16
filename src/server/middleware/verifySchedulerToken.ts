// SPDX-License-Identifier: MIT
// Sprint 27 (audit P0 H14) — gate Cloud Scheduler endpoints.
//
// Cloud Scheduler hits internal jobs with an OIDC token; on Cloud Run we
// can rely on per-service IAM to deny anonymous traffic. But when the
// service is deployed with `--allow-unauthenticated` (so the SPA + public
// /vault/share endpoints can reach it), the scheduler endpoints need an
// explicit auth gate at the application layer too — otherwise they
// become world-callable HTTP probes that can drain Firestore quotas or
// trigger maintenance reapers from anywhere.
//
// Strategy: shared bearer secret stored in `SCHEDULER_SHARED_SECRET`
// (Secret Manager). Cloud Scheduler sets it as a custom header
// (`Authorization: Bearer <secret>`) on the HTTP target. Constant-time
// comparison so timing attacks don't leak the secret.

import type { RequestHandler } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { logger } from '../../utils/logger.js';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Express middleware that gates a route behind the
 * `SCHEDULER_SHARED_SECRET` env var. When the env var is unset the
 * middleware fails closed (returns 503) so a missing secret never
 * silently exposes the endpoint.
 */
export const verifySchedulerToken: RequestHandler = (req, res, next) => {
  const expected = process.env.SCHEDULER_SHARED_SECRET ?? '';
  if (!expected) {
    logger.error('verifySchedulerToken: SCHEDULER_SHARED_SECRET not set — denying');
    return res.status(503).json({ error: 'scheduler_token_not_configured' });
  }
  const auth = req.header('authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (!presented || !safeEqual(presented, expected)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
  return undefined;
};
