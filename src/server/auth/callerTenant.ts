// Praeventio Guard — authoritative caller tenant resolution (B5, Fase 5).
//
// Tenant-scoped routes (SUSESO DIAT/DIEP, DS67/DS76, …) historically read the
// `tenantId` from the REQUEST BODY/QUERY. That is a cross-tenant footgun: a
// user authenticated against tenant A could pass `tenantId: B` and create,
// sign, or mutate compliance documents under tenant B.
//
// The authoritative tenant is the verified token claim, stamped onto
// `req.user.tenantId` by `verifyAuth` (from the Firebase custom claim — see
// middleware/verifyAuth.ts). This helper returns THAT value and, when the
// request also carries a tenantId, requires it to MATCH (so existing clients
// that echo their own tenant keep working, while a forged tenant is rejected).

import type { Request, Response } from 'express';

export type TenantMismatchReason = 'no_tenant_binding' | 'tenant_mismatch';

export class TenantMismatchError extends Error {
  readonly httpStatus = 403;
  constructor(public readonly reason: TenantMismatchReason) {
    super(reason);
    this.name = 'TenantMismatchError';
  }
}

/**
 * Resolve the authoritative tenantId from the verified token. NEVER trusts a
 * client-supplied tenantId on its own:
 *   - no token tenant claim          → throws (no_tenant_binding).
 *   - request tenantId ≠ token tenant → throws (tenant_mismatch).
 *   - otherwise                       → returns the token tenant.
 */
export function resolveCallerTenant(req: Request, requestedTenantId?: unknown): string {
  const tokenTenant = (req.user as { tenantId?: unknown } | undefined)?.tenantId;
  if (typeof tokenTenant !== 'string' || tokenTenant.length === 0) {
    throw new TenantMismatchError('no_tenant_binding');
  }
  if (
    requestedTenantId !== undefined &&
    requestedTenantId !== null &&
    requestedTenantId !== tokenTenant
  ) {
    throw new TenantMismatchError('tenant_mismatch');
  }
  return tokenTenant;
}

/**
 * Express convenience: resolve the caller tenant or write a 403 and return
 * null. Handlers do: `const tenantId = callerTenantOr403(req, res, body.tenantId);
 * if (tenantId === null) return;`
 */
export function callerTenantOr403(
  req: Request,
  res: Response,
  requestedTenantId?: unknown,
): string | null {
  try {
    return resolveCallerTenant(req, requestedTenantId);
  } catch (err) {
    if (err instanceof TenantMismatchError) {
      res.status(err.httpStatus).json({ error: err.reason });
      return null;
    }
    throw err;
  }
}
