// Praeventio Guard — Sprint 41 F.30 HTTP surface.
//
// 2 endpoints:
//   GET /:projectId/telemetry/aggregate?window=7d|30d|90d
//     200: { feed, velocities }
//   GET /tenants/:tenantId/telemetry/rollup?window=7d|30d|90d&projects=p1,p2,...
//     200: { rollup }
//
// The aggregator + eventCollector are pure; this router wraps them with
// Firestore I/O + project-member guard for the project endpoint and an
// admin claim guard for the cross-project tenant rollup.
//
// Privacy: NEVER returns PII. `assertNoPII` from aggregator.ts is the
// last line of defense; the collector projects PII fields out before
// the aggregator sees them.

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { isAdminRole } from '../../types/roles.js';
import {
  aggregateFeed,
  computeVelocities,
  rollupTenant,
  type AggregationWindow,
  type AggregatedFeed,
} from '../../services/telemetry/aggregator.js';
import { collectEvents } from '../../services/telemetry/eventCollector.js';

const router = Router();

const VALID_WINDOWS: ReadonlySet<AggregationWindow> = new Set([
  '7d',
  '30d',
  '90d',
]);

async function resolveTenantId(
  _callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  return null;
}

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<{ tenantId: string } | null> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return null;
    }
    throw err;
  }
  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

function parseWindow(raw: unknown): AggregationWindow | null {
  if (typeof raw !== 'string') return null;
  return VALID_WINDOWS.has(raw as AggregationWindow)
    ? (raw as AggregationWindow)
    : null;
}

const WINDOW_DAYS_MAP: Record<AggregationWindow, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

router.get(
  '/:projectId/telemetry/aggregate',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const window = parseWindow(req.query.window) ?? '7d';
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const events = await collectEvents(admin.firestore(), {
        projectId,
        tenantId: g.tenantId,
        lookbackDays: WINDOW_DAYS_MAP[window],
      });
      const feed = aggregateFeed({
        events,
        projectId,
        tenantId: g.tenantId,
        window,
      });
      const velocities = computeVelocities(feed);
      return res.json({ feed, velocities });
    } catch (err) {
      logger.error?.('telemetry.aggregate.error', err);
      captureRouteError(err, 'telemetry.aggregate');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get(
  '/tenants/:tenantId/telemetry/rollup',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { tenantId } = req.params;
    const window = parseWindow(req.query.window) ?? '7d';
    const projectsRaw =
      typeof req.query.projects === 'string' ? req.query.projects : '';
    const projectIds = projectsRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (projectIds.length === 0) {
      return res.status(400).json({ error: 'projects_query_required' });
    }

    const db = admin.firestore();

    // Tenant-rollup is admin-only. The header comment claimed this but nothing
    // enforced it — any project member could call it. Fetch fresh custom claims
    // (the ID token could be stale) and require an admin role.
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      return res.status(403).json({ error: 'forbidden_admin_only' });
    }

    for (const pid of projectIds) {
      // Membership: a leaked uid from one project can't see others' aggregates.
      try {
        await assertProjectMember(callerUid, pid, db);
      } catch (err) {
        if (err instanceof ProjectMembershipError) {
          return res
            .status(err.httpStatus)
            .json({ error: 'forbidden', projectId: pid });
        }
        throw err;
      }
      // Tenant ownership: `tenantId` comes from the URL and is used to build the
      // Firestore read paths below. Without this, a caller could pass their own
      // projects alongside an ARBITRARY tenantId and read another tenant's
      // namespace. Pin every project to the requested tenant.
      const realTenant = await resolveTenantId(callerUid, pid, db);
      if (realTenant !== tenantId) {
        return res
          .status(403)
          .json({ error: 'tenant_project_mismatch', projectId: pid });
      }
    }

    try {
      const feeds: AggregatedFeed[] = [];
      for (const projectId of projectIds) {
        const events = await collectEvents(db as any, {
          projectId,
          tenantId,
          lookbackDays: WINDOW_DAYS_MAP[window],
        });
        feeds.push(
          aggregateFeed({ events, projectId, tenantId, window }),
        );
      }
      const rollup = rollupTenant(feeds, tenantId);
      return res.json({ rollup });
    } catch (err) {
      logger.error?.('telemetry.rollup.error', err);
      captureRouteError(err, 'telemetry.rollup');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
