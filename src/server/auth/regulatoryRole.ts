// [P0][compliance] Role gate for REGULATORY document actions.
//
// `callerTenantOr403` proves the caller belongs to the tenant — it says nothing
// about WHAT they may do inside it. Creating, signing or submitting a
// regulatory filing (SUSESO DIAT/DIEP, DS-67, DS-76) names the company before
// the regulator and carries legal weight, so tenant membership alone is not
// enough: any operario/contratista of the tenant could otherwise file or sign
// on the company's behalf.
//
// The allowed set is built from the canonical role constants rather than a
// fresh magic list, so it tracks `src/types/roles.ts` automatically:
//   ADMIN_ROLES      → admin, gerente
//   SUPERVISOR_ROLES → supervisor, prevencionista, director_obra, medico_ocupacional
// Everything else (WORKER_ROLES: operario, contratista, …) is denied.
//
// Note: `/forms/:formId/mark-submitted` keeps its own NARROWER set
// (admin/gerente/supervisor) on purpose — see the comment at that route.

import type { Request, Response } from 'express';

import { ADMIN_ROLES, SUPERVISOR_ROLES } from '../../types/roles.js';

/** Roles allowed to create, sign or submit a regulatory document. */
export const REGULATORY_DOC_ROLES: readonly string[] = [
  ...ADMIN_ROLES,
  ...SUPERVISOR_ROLES,
];

/**
 * Express convenience mirroring `callerTenantOr403`: returns true when the
 * caller carries a role authorised to act on regulatory documents; otherwise
 * writes a 403 `forbidden_role` and returns false. Handlers do:
 *
 *   if (!callerHasRegulatoryRole(req, res)) return;
 *
 * The role is read from the verified token claim (`req.user.role`), the same
 * source the sibling `mark-submitted` gate already uses in this domain.
 */
export function callerHasRegulatoryRole(req: Request, res: Response): boolean {
  const role = (req.user as { role?: unknown } | undefined)?.role;
  if (typeof role !== 'string' || !REGULATORY_DOC_ROLES.includes(role)) {
    res.status(403).json({ error: 'forbidden_role' });
    return false;
  }
  return true;
}
