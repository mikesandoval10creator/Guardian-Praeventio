import { collection, addDoc, serverTimestamp, db, auth, OperationType } from './firebase';

export interface AuditLog {
  action: string;
  module: string;
  details: any;
  userId: string;
  userEmail: string | null;
  timestamp: any;
  projectId?: string;
}

export const logAuditAction = async (
  action: string,
  module: string,
  details: any,
  projectId?: string
) => {
  try {
    const user = auth.currentUser;
    if (!user) return; // Don't log if not authenticated

    const auditRef = collection(db, 'audit_logs');
    await addDoc(auditRef, {
      action,
      module,
      details,
      userId: user.uid,
      userEmail: user.email,
      timestamp: serverTimestamp(),
      projectId: projectId || null
    });
  } catch (error) {
    // Audit failures are non-fatal but must be visible for compliance review.
    console.error('Failed to write audit log:', JSON.stringify({
      error: error instanceof Error ? error.message : String(error),
      operationType: OperationType.CREATE,
      path: 'audit_logs'
    }));
  }
};
