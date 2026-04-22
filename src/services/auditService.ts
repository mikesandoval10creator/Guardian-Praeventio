import { collection, addDoc, serverTimestamp, db, auth, handleFirestoreError, OperationType } from './firebase';

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
    // We don't want audit logging to break the main application flow,
    // but we should log it to the console.
    console.error('Failed to write audit log:', error);
    // handleFirestoreError(error, OperationType.CREATE, 'audit_logs');
  }
};
