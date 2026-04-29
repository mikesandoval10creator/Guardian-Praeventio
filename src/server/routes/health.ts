// Praeventio Guard — Round 16 R5 Phase 1 split.
//
// Public health probe for Cloud Run / Marketplace listing health checks.
// Returns 200 + minimal payload when the server can talk to Firestore.
// Returns 503 when a critical dependency is unreachable.
//
// Mounted in server.ts AFTER helmet (so CSP headers apply) but BEFORE the
// /api/ rate limiter and verifyAuth — Cloud Run probes hit this endpoint
// frequently and without an auth token, so it must remain unauthenticated and
// unthrottled.
//
// Phase 2 (billing) and Phase 3 (curriculum/projects) and Phase 4
// (oauth/gemini) deferred to Round 17/18.

import { Router } from 'express';
import admin from 'firebase-admin';

const router = Router();

router.get('/health', async (_req, res) => {
  const checks: Record<string, 'ok' | 'fail' | 'skipped'> = {};
  let allOk = true;
  // Firestore reachability:
  try {
    await admin.firestore().listCollections(); // cheap admin op
    checks.firestore = 'ok';
  } catch {
    checks.firestore = 'fail';
    allOk = false;
  }
  // Add more checks as the deployment grows (Resend, Gemini, Webpay).
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION ?? 'dev',
    checks,
  });
});

export default router;
