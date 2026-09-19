// Praeventio Guard — Admin pilot entitlement endpoints.
//
// Routes:
//   POST   /api/admin/pilots              — grant a pilot entitlement
//   GET    /api/admin/pilots/:orgId       — list active + recent grants
//   DELETE /api/admin/pilots/:pilotId     — revoke a pilot entitlement
//
// All routes require admin role (mirroring the existing /api/admin/* gates).
// Every grant and revoke writes an entry to audit_logs via `auditServerEvent`,
// so compliance can answer "who granted what, when, and why" without having
// to traverse nested collections.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { isAdminRole } from '../../types/roles.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { randomBytes } from 'node:crypto';
import { logger } from '../../utils/logger.js';
import {
  SUBSCRIPTION_PLANS,
  isSubscriptionPlan,
  normalizeSubscriptionPlanId,
  type SubscriptionPlan,
} from '../../services/pricing/subscriptionPlan.js';
import { coercePilotDoc } from '../services/pilotEntitlementResolver.js';

export const adminPilotsRouter = Router();

// ── Zod-light input validation (kept inline; no runtime dep on zod) ────

const VALID_ORIGINS = ['manual_admin', 'closed_beta_signup', 'play_store_trial', 'sales'] as const;
type PilotOrigin = (typeof VALID_ORIGINS)[number];

function isValidOrigin(value: unknown): value is PilotOrigin {
  return typeof value === 'string' && (VALID_ORIGINS as readonly string[]).includes(value);
}

function isValidIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

// ── POST /api/admin/pilots ──────────────────────────────────────────────

adminPilotsRouter.post('/pilots', verifyAuth, async (req, res) => {
  try {
    const caller = req.user as { uid?: string; email?: string | null; role?: string } | undefined;
    if (!caller?.uid || !isAdminRole(caller.role)) {
      res.status(403).json({ error: 'admin_role_required' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId : null;
    const grantedTierId = normalizeSubscriptionPlanId(body.grantedTierId);
    const startsAt = body.startsAt;
    const endsAt = body.endsAt;
    const campaign = typeof body.campaign === 'string' ? body.campaign : '';
    const cohort = typeof body.cohort === 'string' ? body.cohort : '';
    const origin = body.origin;

    if (!organizationId || organizationId.length > 200) {
      res.status(400).json({ error: 'invalid_organizationId' });
      return;
    }
    if (!grantedTierId || !SUBSCRIPTION_PLANS.includes(grantedTierId as SubscriptionPlan)) {
      res.status(400).json({ error: 'invalid_grantedTierId' });
      return;
    }
    if (!isValidIsoDate(startsAt) || !isValidIsoDate(endsAt)) {
      res.status(400).json({ error: 'invalid_window' });
      return;
    }
    if (Date.parse(endsAt as string) < Date.parse(startsAt as string)) {
      res.status(400).json({ error: 'endsAt_before_startsAt' });
      return;
    }
    if (!isValidOrigin(origin)) {
      res.status(400).json({ error: 'invalid_origin' });
      return;
    }

    const pilotId = `pilot_${Date.now()}_${randomBytes(4).toString('hex')}`;
    const grantedAt = new Date().toISOString();

    const payload = {
      pilotId,
      organizationId,
      grantedTierId,
      startsAt,
      endsAt,
      campaign,
      cohort,
      origin,
      grantedBy: { uid: caller.uid, email: caller.email ?? null },
      grantedAt,
      status: 'active' as const,
    };

    await admin
      .firestore()
      .collection('organizations')
      .doc(organizationId)
      .collection('pilotEntitlements')
      .doc(pilotId)
      .set(payload);

    await auditServerEvent(req, 'pilot.granted', 'admin', {
      pilotId,
      organizationId,
      grantedTierId,
      startsAt,
      endsAt,
      campaign,
      cohort,
      origin,
    });

    res.status(201).json({ pilotId, status: 'active', payload });
  } catch (err: any) {
    captureRouteError(res, err);
    logger.error?.('admin_pilots.grant_failed', { message: err?.message });
  }
});

// ── GET /api/admin/pilots/:orgId ────────────────────────────────────────

adminPilotsRouter.get('/pilots/:orgId', verifyAuth, async (req, res) => {
  try {
    const caller = req.user as { uid?: string; email?: string | null; role?: string } | undefined;
    if (!caller?.uid || !isAdminRole(caller.role)) {
      res.status(403).json({ error: 'admin_role_required' });
      return;
    }

    const orgId = req.params.orgId;
    if (!orgId || orgId.length > 200) {
      res.status(400).json({ error: 'invalid_orgId' });
      return;
    }

    const snap = await admin
      .firestore()
      .collection('organizations')
      .doc(orgId)
      .collection('pilotEntitlements')
      .orderBy('grantedAt', 'desc')
      .limit(100)
      .get();

    const pilots = snap.docs
      .map((d) => coercePilotDoc(d.id, d.data(), orgId))
      .filter((p): p is NonNullable<typeof p> => p !== null);

    res.json({ organizationId: orgId, pilots });
  } catch (err: any) {
    captureRouteError(res, err);
    logger.error?.('admin_pilots.list_failed', { message: err?.message });
  }
});

// ── DELETE /api/admin/pilots/:pilotId ───────────────────────────────────
//
// The URL includes a query param `?organizationId=...` because the
// collection path includes the orgId. Firestore requires the full path
// for a delete.

adminPilotsRouter.delete('/pilots/:pilotId', verifyAuth, async (req, res) => {
  try {
    const caller = req.user as { uid?: string; email?: string | null; role?: string } | undefined;
    if (!caller?.uid || !isAdminRole(caller.role)) {
      res.status(403).json({ error: 'admin_role_required' });
      return;
    }

    const pilotId = req.params.pilotId;
    if (!pilotId || pilotId.length > 200) {
      res.status(400).json({ error: 'invalid_pilotId' });
      return;
    }
    const organizationId =
      typeof req.query.organizationId === 'string' ? req.query.organizationId : null;
    if (!organizationId) {
      res.status(400).json({ error: 'missing_organizationId' });
      return;
    }
    const reason =
      typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : 'unspecified';

    const ref = admin
      .firestore()
      .collection('organizations')
      .doc(organizationId)
      .collection('pilotEntitlements')
      .doc(pilotId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: 'pilot_not_found' });
      return;
    }

    const revokedAt = new Date().toISOString();
    await ref.update({
      status: 'revoked',
      revokedAt,
      revokedBy: { uid: caller.uid, email: caller.email ?? null },
      revokeReason: reason,
    });

    await auditServerEvent(req, 'pilot.revoked', 'admin', {
      pilotId,
      organizationId,
      revokedAt,
      reason,
    });

    res.json({ pilotId, status: 'revoked', revokedAt });
  } catch (err: any) {
    captureRouteError(res, err);
    logger.error?.('admin_pilots.revoke_failed', { message: err?.message });
  }
});

// Re-export the router as default so server.ts can import it the same
// way it imports adminRouter.
export default adminPilotsRouter;

// Helper for test files / admin tooling that needs to validate a tier id.
export { isSubscriptionPlan };
