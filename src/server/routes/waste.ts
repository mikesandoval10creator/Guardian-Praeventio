// Praeventio Guard — §229-236 Waste Inventory + ESG manifests.
//
// Endpoint dedicado para `/api/sprint-k/:projectId/waste/inventory`.
// Migrado del monolito `sprintK.ts` (2026-05-18).

import { Router } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { WasteAdapter } from '../../services/environmental/wasteFirestoreAdapter.js';

const router = Router();

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

router.get(
  '/:projectId/waste/inventory',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new WasteAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const [stock, pendingManifests, permits] = await Promise.all([
        adapter.listInStock(),
        adapter.listManifestsPendingReception(),
        adapter.listPermits(),
      ]);
      return res.json({ wastes: stock, pendingManifests, permits });
    } catch (err) {
      logger.error?.('waste.error', err);
      captureRouteError(err, 'waste');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
