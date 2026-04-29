import { auth } from './firebase';

/**
 * Shape of the `details` payload on audit_logs.
 *
 * Round 18 (R5): we surface `durationMin` as an optional well-known field so
 * the curriculum aggregator can compute `stats.safeHours` deterministically
 * (sum of `durationMin` across `safety.*` events ÷ 60). All other fields stay
 * free-form to avoid a breaking schema for callers that have legitimate
 * structured payloads (assessmentId, score, gameId, etc.).
 */
export interface AuditLogDetails {
  /**
   * Duration of the action in minutes. Set by the caller from a modal open
   * timestamp + completion timestamp (or from a self-reported value), and
   * aggregated by `historyAggregator` into `safeHours`. Optional — legacy
   * callers can omit it without breaking; the aggregator simply skips rows
   * whose `durationMin` is not a finite positive number.
   */
  durationMin?: number;
  [key: string]: unknown;
}

export interface AuditLog {
  action: string;
  module: string;
  details: AuditLogDetails;
  userId: string;
  userEmail: string | null;
  timestamp: any;
  projectId?: string;
}

/**
 * Writes an audit_log entry by POSTing to the server-side endpoint, which
 * uses the Admin SDK (bypassing firestore.rules `audit_logs:create:false`).
 *
 * The actor uid + email + timestamp + ip + ua are stamped server-side from
 * the verified ID token; nothing the client puts in the body can spoof them.
 *
 * Errors are swallowed (with console.error) — audit logging must NEVER break
 * the main app flow. If the write fails, the worker still finishes their
 * action; we accept eventual consistency over hard-blocking.
 */
export const logAuditAction = async (
  action: string,
  module: string,
  details: AuditLogDetails,
  projectId?: string,
) => {
  try {
    const user = auth.currentUser;
    if (!user) return; // Don't log if not authenticated

    const token = await user.getIdToken();
    await fetch('/api/audit-log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ action, module, details, projectId }),
    });
  } catch (error) {
    // Never break the main app flow on an audit-log failure.
    console.error('Failed to write audit log:', error);
  }
};
