import admin from 'firebase-admin';

export interface TenantAuthorizationResponse {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * Restrict an operation on a target user to the caller's Auth tenant.
 *
 * Both records are re-read from Firebase Auth by Admin SDK. Neither the body
 * nor the client token is trusted for tenant identity. A tenant-less admin is
 * denied because Guardian has no global platform-admin role in this contract.
 */
export async function assertTargetInCallerTenant(
  res: TenantAuthorizationResponse,
  callerUid: string,
  targetUid: string,
): Promise<boolean> {
  let callerTenantId: unknown;
  let targetTenantId: unknown;
  try {
    const [callerRecord, targetRecord] = await Promise.all([
      admin.auth().getUser(callerUid),
      admin.auth().getUser(targetUid),
    ]);
    callerTenantId = callerRecord.customClaims?.tenantId;
    targetTenantId = targetRecord.customClaims?.tenantId;
  } catch {
    // Unknown target (getUser threw) — deny without confirming existence.
    res.status(403).json({ error: 'Forbidden: target user is not in your tenant' });
    return false;
  }
  if (typeof callerTenantId !== 'string' || callerTenantId.length === 0) {
    res.status(403).json({ error: 'Forbidden: caller has no tenant scope' });
    return false;
  }
  if (targetTenantId !== callerTenantId) {
    res.status(403).json({ error: 'Forbidden: target user is not in your tenant' });
    return false;
  }
  return true;
}
