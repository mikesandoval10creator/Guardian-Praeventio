// Praeventio Guard — Round 16 R5 Phase 1 split.
//
// Express middleware wrapper around the pure
// `assertProjectMember(uid, projectId, db)` helper from
// `src/services/auth/projectMembership.ts`. Allows route modules to gate a
// path by project-membership without each handler hand-rolling the same
// try/catch + ProjectMembershipError translation.
//
// Usage:
//
//   import { assertProjectMemberFromBody } from
//     '../middleware/assertProjectMemberMiddleware.js';
//
//   router.post('/audit-log', verifyAuth, assertProjectMemberFromBody(),
//     (req, res) => { ... });
//
// The body-shape variant reads `req.body.projectId`. If absent / empty, the
// middleware is a no-op (routes that *optionally* tag entries with a
// projectId — like /api/audit-log — keep working). The param-shape variant
// reads `req.params.projectId` (or a configurable param name) and is strict
// (a missing/invalid projectId yields HTTP 400).
//
// Phase 2 (billing) and Phase 3 (curriculum/projects) and Phase 4
// (oauth/gemini) deferred to Round 17/18 — none of those routes are extracted
// in Phase 1, so this middleware is shipped now to unblock that work without
// further server.ts churn.

import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

/**
 * Optional projectId from req.body — common shape for write endpoints that
 * accept a projectId tag (audit-log, telemetry tagging, etc.). When the body
 * lacks a projectId, the middleware is a no-op.
 */
export function assertProjectMemberFromBody() {
  return async function assertProjectMemberFromBodyMw(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const callerUid = (req as any).user?.uid;
    const projectId = (req.body ?? {}).projectId;
    if (typeof projectId !== 'string' || projectId.length === 0) {
      return next();
    }
    if (!callerUid) {
      // Defensive — verifyAuth should have run first.
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());
      return next();
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      return next(err);
    }
  };
}

/**
 * Strict projectId from req.params (default param name: 'id'). Returns 400
 * if the named param is missing.
 */
export function assertProjectMemberFromParam(paramName: string = 'id') {
  return async function assertProjectMemberFromParamMw(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const callerUid = (req as any).user?.uid;
    const projectId = req.params?.[paramName];
    if (typeof projectId !== 'string' || projectId.length === 0) {
      return res.status(400).json({ error: 'Missing projectId' });
    }
    if (!callerUid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());
      return next();
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      return next(err);
    }
  };
}
