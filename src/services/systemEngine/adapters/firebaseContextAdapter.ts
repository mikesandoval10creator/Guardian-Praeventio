// SystemEngine — Firebase context adapter (placeholder).
//
// Future hook: emit `audit_log_appended` for sign-in / sign-out
// transitions. Today auth.user.signed_in/out analytics events fire via
// the analytics module; bringing them onto the bus would let a policy
// produce a session_audit derived event consistently across the app.

export interface FirebaseAdapterOptions { tenantId: string }


export function useFirebaseContextAdapter(_opts: FirebaseAdapterOptions): void {
  // Intentionally empty.
}
