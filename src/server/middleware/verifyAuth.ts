// Praeventio Guard — Round 16 R5 Phase 1 split.
//
// Firebase Auth middleware. Verifies the Bearer ID token attached to the
// request, attaches the decoded token to `req.user`, and short-circuits with
// HTTP 401 on missing / malformed / invalid tokens. firebase-admin is
// imported normally — its initialization happens at server boot time in
// server.ts, so by the time this middleware runs it is already configured.
//
// Behavior contract (covered by I3 supertest harness in src/__tests__/server):
//   • 401 + { error: "Unauthorized: No token provided" } when Authorization
//     header is missing OR does not start with "Bearer ".
//   • 401 + { error: "Unauthorized: Invalid token" } when verifyIdToken
//     throws (malformed / expired / revoked token).
//   • Calls next() with `(req as any).user = decodedToken` on success.
//
// Phase 2 (billing) and Phase 3 (curriculum/projects) and Phase 4
// (oauth/gemini) deferred to Round 17/18.

import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';

export const verifyAuth = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying auth token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};
