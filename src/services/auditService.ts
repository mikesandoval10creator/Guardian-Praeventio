import { auth } from './firebase';

export interface AuditLog {
  action: string;
  module: string;
  details: any;
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
  details: any,
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
