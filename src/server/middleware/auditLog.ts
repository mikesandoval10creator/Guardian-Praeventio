// Praeventio Guard — Round 17 R1.
//
// Server-side audit log helper. Wraps the Firestore Admin write to
// `audit_logs/` with the standard server-stamped fields (userId from
// `req.user`, IP, userAgent, timestamp) so each handler doesn't repeat
// the same five-line block.
//
// Critical rule (mirrored from src/server/routes/audit.ts):
//   • The actor's uid + email come from the verified ID token attached by
//     `verifyAuth`, NOT from req.body. Nothing the client puts in the body
//     can spoof the actor.
//   • Some routes (e.g. /auth/google/callback) are intentionally unauthed —
//     verifyAuth never runs there. For those, callers MAY pass an
//     `actorOverride` carrying { uid, email } recovered from oauth state /
//     session. When `req.user` is undefined AND no override is provided,
//     the helper records `actor = "anonymous"` rather than throwing —
//     observability MUST NEVER break the request path (Round 17 R1).
//
// Usage:
//
//   import { auditServerEvent } from '../middleware/auditLog.js';
//
//   await auditServerEvent(req, 'oauth.unlink', 'oauth', { provider: 'google' });
//
// or with a projectId tag:
//
//   await auditServerEvent(req, 'calendar.sync', 'calendar', { count }, {
//     projectId: 'proj-A',
//   });
//
// The helper is `async` but its returned promise is intentionally
// fire-and-forget at the call site — wrap each `await` in a try/catch (or
// use the no-throw signature below) so an audit failure cannot 5xx the
// real request. The helper itself swallows errors via `logger.error` and
// resolves with `false` on failure, but defensive callers still wrap it.

import type { Request } from 'express';
import admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';

export interface AuditServerEventOptions {
  /** Optional projectId tag for tenant-scoped events. */
  projectId?: string | null;
  /**
   * Override actor identity when `req.user` is unavailable (unauthed
   * callbacks like /auth/google/callback). When omitted and req.user is
   * undefined, actor is recorded as 'anonymous'.
   */
  actorOverride?: { uid: string; email?: string | null };
}

/**
 * Writes a single row into Firestore `audit_logs/`. Returns `true` on
 * success, `false` on failure (so callers can branch on it for tests
 * without ever propagating the underlying Firestore exception). Failures
 * are logged at ERROR severity so they're still captured in observability.
 */
export async function auditServerEvent(
  req: Request,
  action: string,
  module: string,
  details: Record<string, unknown> = {},
  options: AuditServerEventOptions = {},
): Promise<boolean> {
  const reqUser = (req as any).user as { uid?: string; email?: string | null } | undefined;
  const actor = options.actorOverride ?? reqUser ?? { uid: 'anonymous', email: null };
  const userId: string = actor.uid ?? 'anonymous';
  const userEmail: string | null = actor.email ?? null;

  try {
    await admin.firestore().collection('audit_logs').add({
      action,
      module,
      details,
      userId,
      userEmail,
      projectId: options.projectId ?? null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
    return true;
  } catch (error: any) {
    // Observability NEVER breaks the request path. Log + return false so
    // callers (which always wrap in try/catch anyway) keep going.
    logger.error('audit_server_event_failed', {
      action,
      module,
      userId,
      message: error?.message,
    });
    return false;
  }
}
