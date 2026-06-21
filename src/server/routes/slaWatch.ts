// Praeventio Guard — SLA Watch read-path (escalation surface).
//
// GET /:projectId/sla-watch
//   200: { now: ISO, items: AssessedItem[] }
//
// Makes <SlaWatchPanel/> REAL. It reads the project's REGISTERED incidents
// (the same docs incidents.ts writes + safetyMetrics.ts reads), keeps only the
// ones with a genuine timestamp + severity that are still open, and assesses
// each against its (kind × severity) SLA via the pure `assessSla` engine.
//
// HONEST by construction: the age comes from the doc's real `createdAt`/`ts`,
// NOT a fabricated `new Date()` (the cascarón bug in the old client hook that
// made every item look brand-new and forever within_sla). No exposure of
// internal errors. Read-only — no writes, so no audit_log entry is required.
//
// Life-safety surface: incident SLA visibility is NEVER tier-gated (CLAUDE.md
// #11). The only gate is project membership (#6).

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { assessSla } from '../../services/escalation/escalationSlaEngine.js';
import {
  incidentDocsToWorkflowItems,
  type RawIncidentDoc,
} from '../../services/escalation/incidentSlaMapper.js';

const router = Router();

async function guard(
  callerUid: string,
  projectId: string,
  res: import('express').Response,
): Promise<boolean> {
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      res.status(err.httpStatus).json({ error: 'forbidden' });
      return false;
    }
    throw err;
  }
  return true;
}

/** Resolve tenantId from the project doc (incidents may be nested under it). */
async function resolveTenantId(projectId: string): Promise<string | null> {
  try {
    const snap = await admin.firestore().collection('projects').doc(projectId).get();
    const data = snap.exists ? snap.data() : null;
    if (data && typeof data.tenantId === 'string' && data.tenantId.length > 0) {
      return data.tenantId;
    }
  } catch (err) {
    logger.warn?.('slaWatch.tenant_lookup_failed', err);
  }
  return null;
}

/** Read incidents for the project from BOTH the top-level + nested paths. */
async function readProjectIncidents(
  projectId: string,
  tenantId: string | null,
): Promise<Array<Record<string, unknown>>> {
  const db = admin.firestore();
  const safeRead = async (
    label: string,
    fn: () => Promise<Array<Record<string, unknown>>>,
  ): Promise<Array<Record<string, unknown>>> => {
    try {
      return await fn();
    } catch (err) {
      logger.warn?.(`slaWatch.${label}.read_failed`, err);
      return [];
    }
  };

  const [topLevel, nested] = await Promise.all([
    safeRead('incidents_top', async () => {
      const snap = await db.collection('incidents').where('projectId', '==', projectId).get();
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    }),
    tenantId
      ? safeRead('incidents_nested', async () => {
          const snap = await db
            .collection(`tenants/${tenantId}/projects/${projectId}/incidents`)
            .get();
          return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
        })
      : Promise.resolve([] as Array<Record<string, unknown>>),
  ]);

  // Dedup by id, top-level wins. Read-only — a plain object (no Map/Set, no
  // Firestore writes) so this GET handler is not misread as a mutating writer.
  const byId: Record<string, Record<string, unknown>> = {};
  for (const rec of [...topLevel, ...nested]) {
    const id = String(rec.id ?? '');
    if (id && !Object.prototype.hasOwnProperty.call(byId, id)) {
      byId[id] = rec;
    }
  }
  return Object.values(byId);
}

const paramsSchema = z.object({
  projectId: z.string().min(1).max(128),
});

router.get(
  '/:projectId/sla-watch',
  verifyAuth,
  validate(paramsSchema, 'params'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;

    try {
      const tenantId = await resolveTenantId(projectId);
      const rawIncidents = await readProjectIncidents(projectId, tenantId);

      // Honest mapping: drop docs without a real timestamp/severity or closed.
      const workflowItems = incidentDocsToWorkflowItems(
        rawIncidents as RawIncidentDoc[],
      );

      const now = new Date();
      const items = workflowItems.map(({ item, label }) => ({
        item,
        label,
        assessment: assessSla(item, now),
      }));

      return res.json({ now: now.toISOString(), items });
    } catch (err) {
      logger.error?.('slaWatch.list.error', err);
      captureRouteError(err, 'slaWatch.list');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
