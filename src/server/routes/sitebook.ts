// Praeventio Guard — Wire UI bridge: /api/sitebook routes.
//
// Server-side endpoints that wrap `SiteBookAdapter` for:
//   GET    /api/sitebook/:projectId/entries?year=YYYY
//   GET    /api/sitebook/:projectId/entry/:folio
//   POST   /api/sitebook/:projectId/entries        (create with atomic folio)
//
// Auth: verifyAuth + project membership check (Admin SDK bypasses rules,
// so we re-enforce here). The adapter does the Firestore write; this
// router orchestrates auth + tenantId resolution + serialization.

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  SiteBookValidationError,
  type SiteBookEntryKind,
} from '../../services/siteBook/siteBookService.js';
import { SiteBookAdapter } from '../../services/siteBook/siteBookFirestoreAdapter.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';

const router = Router();

const VALID_KINDS: SiteBookEntryKind[] = [
  'inspection',
  'incident',
  'near_miss',
  'visit',
  'change',
  'instruction',
  'stoppage',
  'resumption',
  'document_delivery',
  'finding_closure',
  'training_event',
  'observation',
];

const createEntrySchema = z.object({
  kind: z.enum(VALID_KINDS as [SiteBookEntryKind, ...SiteBookEntryKind[]]),
  occurredAt: z.string().min(10),
  description: z.string().min(15).max(4000),
  location: z.string().max(200).optional(),
  involvedWorkerUids: z.array(z.string().min(1).max(128)).max(50).optional(),
});

/**
 * Resolve the caller's tenantId from custom claims. Falls back to the
 * project document if no claim is set (early-tenant migration). 404 if
 * neither yields a tenant.
 */
async function resolveTenantId(
  callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const claims = (await admin.auth().getUser(callerUid)).customClaims ?? {};
  if (typeof claims.tenantId === 'string' && claims.tenantId.length > 0) {
    return claims.tenantId;
  }
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  return null;
}

router.get('/:projectId/entries', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const { projectId } = req.params;
  const yearParam = req.query.year;
  const year =
    typeof yearParam === 'string' ? Number.parseInt(yearParam, 10) : new Date().getFullYear();
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return res.status(400).json({ error: 'invalid_year' });
  }

  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    throw err;
  }

  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) return res.status(404).json({ error: 'tenant_not_found' });

  const adapter = new SiteBookAdapter({ db: admin.firestore() as any, tenantId, projectId });
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const entries = await adapter.listByYear(year, { limit });
  return res.json({ entries, year, count: entries.length });
});

router.get('/:projectId/entry/:folio', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const { projectId, folio } = req.params;

  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    throw err;
  }

  const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
  if (!tenantId) return res.status(404).json({ error: 'tenant_not_found' });

  const adapter = new SiteBookAdapter({ db: admin.firestore() as any, tenantId, projectId });
  const entry = await adapter.getByFolio(folio);
  if (!entry) return res.status(404).json({ error: 'not_found' });
  return res.json(entry);
});

router.post(
  '/:projectId/entries',
  verifyAuth,
  validate(createEntrySchema),
  async (req, res) => {
    const callerUid = (req as any).user.uid;
    const callerRole = (req as any).user.role ?? 'worker';
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof createEntrySchema>;

    try {
      await assertProjectMember(callerUid, projectId, admin.firestore());
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      throw err;
    }

    const tenantId = await resolveTenantId(callerUid, projectId, admin.firestore());
    if (!tenantId) return res.status(404).json({ error: 'tenant_not_found' });

    const adapter = new SiteBookAdapter({ db: admin.firestore() as any, tenantId, projectId });
    const year = new Date(body.occurredAt).getUTCFullYear();

    try {
      // createAndPersist orquesta counter atómico + createEntry + set().
      // El servicio puro ya valida description >= 15 chars.
      const entry = await adapter.createAndPersist(
        {
          projectId,
          kind: body.kind,
          occurredAt: body.occurredAt,
          recordedByUid: callerUid,
          recordedByRole: callerRole,
          description: body.description,
          location: body.location,
          involvedWorkerUids: body.involvedWorkerUids,
        },
        year,
      );
      return res.status(201).json(entry);
    } catch (err) {
      if (err instanceof SiteBookValidationError) {
        return res.status(400).json({ error: err.code, message: err.message });
      }
      logger.error?.('sitebook.create.error', err);
      captureRouteError(err, 'sitebook.create');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
