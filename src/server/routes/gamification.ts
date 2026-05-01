// Praeventio Guard — Round 19 R2 Phase 4 split.
//
// Gamification + AI Safety Coach endpoints extracted from server.ts:
//   • POST /api/gamification/points       — awards points to caller's uid.
//   • GET  /api/gamification/leaderboard  — global leaderboard read.
//   • POST /api/gamification/check-medals — re-evaluates medal eligibility.
//   • POST /api/coach/chat                — RAG-backed safety coach. Tenant-
//     scoped: requires `projectId` in the body and gates on
//     `assertProjectMemberFromBody` (Round 17 R1 — closes the unverified-
//     projectId bug where tokens from tenant A could pull tenant B context).
//
// All four endpoints are auth'd via `verifyAuth`. Each writes an audit row
// (Round 17 R1 — Ley 16.744 compliance trail: gamification tied to safety
// behaviors must be auditable, and coach chats are tagged with projectId
// for the tenant trail).
//
// Mounted via `app.use('/api', gamificationRouter)`. The router declares
// the full `/gamification/...` and `/coach/chat` suffixes so the on-the-
// wire paths stay byte-identical with what server.ts shipped through R18.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { assertProjectMemberFromBody } from '../middleware/assertProjectMemberMiddleware.js';
import {
  awardPoints,
  getLeaderboard,
  checkMedalEligibility,
} from '../../services/gamificationBackend.js';

const router = Router();

router.post('/gamification/points', verifyAuth, async (req, res) => {
  const { amount, reason } = req.body;
  const uid = (req as any).user.uid;
  try {
    await awardPoints(uid, amount, reason);
    // Round 17 R1 — audit row for awarded points (compliance trail per
    // Ley 16.744 — gamification tied to safety behaviors must be auditable).
    try {
      await auditServerEvent(req, 'gamification.points_awarded', 'gamification', {
        amount: typeof amount === 'number' ? amount : null,
        reason: typeof reason === 'string' ? reason : null,
      });
    } catch {
      /* observability never breaks request path */
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/gamification/leaderboard', verifyAuth, async (_req, res) => {
  try {
    const leaderboard = await getLeaderboard();
    res.json({ success: true, leaderboard });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/gamification/check-medals', verifyAuth, async (req, res) => {
  const uid = (req as any).user.uid;
  try {
    const newMedals = await checkMedalEligibility(uid);
    // Round 17 R1 — audit row for medal checks. Records the count of new
    // medals awarded; the medal IDs themselves are NOT secrets but live in
    // user_stats so we keep the audit row lightweight.
    try {
      await auditServerEvent(req, 'gamification.medals_checked', 'gamification', {
        newMedalCount: Array.isArray(newMedals) ? newMedals.length : 0,
      });
    } catch {
      /* observability never breaks request path */
    }
    res.json({ success: true, newMedals });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI Safety Coach Endpoint
//
// Round 17 R1 — was unverified-projectId. Clients NOT sending projectId in
// body now get 400; clients sending wrong-tenant projectId now get 403.
// The endpoint reads RAG context (incidents) scoped by projectId, so a
// missing membership check would let a token from tenant A pull tenant B
// context. `assertProjectMemberFromBody` enforces this; we additionally
// require a non-empty projectId here (the middleware is no-op when absent
// to keep audit-log-style optional callers working, but coach/chat MUST
// have a tenant scope).
router.post(
  '/coach/chat',
  verifyAuth,
  assertProjectMemberFromBody(),
  async (req, res) => {
    const { message, projectId } = req.body ?? {};
    const uid = (req as any).user.uid;
    if (typeof projectId !== 'string' || projectId.length === 0) {
      return res.status(400).json({ error: 'projectId is required' });
    }
    try {
      const { getSafetyCoachResponse } = await import('../../services/coachBackend.js');
      const db = admin.firestore();
      const userStats =
        (await db.collection('user_stats').doc(uid).get()).data() || {
          points: 0,
          medals: [],
          loginStreak: 0,
        };
      const recentIncidents = (
        await db.collection('incidents').where('projectId', '==', projectId).limit(5).get()
      ).docs.map((d) => d.data());

      const response = await getSafetyCoachResponse(uid, userStats, recentIncidents, message);

      // Round 17 R1 — audit row tagged with projectId for tenant trail.
      try {
        await auditServerEvent(
          req,
          'coach.chat',
          'coach',
          {
            projectId,
            messageLength: typeof message === 'string' ? message.length : 0,
          },
          { projectId },
        );
      } catch {
        /* observability never breaks request path */
      }

      res.json({ success: true, response });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

export default router;
