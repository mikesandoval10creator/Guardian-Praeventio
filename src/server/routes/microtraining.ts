// Praeventio Guard — Sprint 41 F.22 HTTP surface.
//
// 4 endpoints:
//   GET  /:projectId/microtraining/catalog
//   GET  /:projectId/microtraining/recommend?workerUid=X&risks=altura,electrico
//   POST /:projectId/microtraining/session   → persist + grant cert when passing
//   GET  /:projectId/microtraining/certs?workerUid=X
//
// The pure `lightningTrainingService` does selection + scoring; this router
// is just an Express-shaped wrapper that adds Firestore persistence + the
// project-member guard.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  MICROTRAINING_CATALOG,
  PASS_THRESHOLD,
  scoreSession,
  shouldCertify,
  selectMicroModule,
  type MicroTrainingSession,
  type RiskCategory,
} from '../../services/microtraining/lightningTrainingService.js';
import {
  MicrotrainingAdapter,
  buildCertFromSession,
} from '../../services/microtraining/microtrainingFirestoreAdapter.js';

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

const RISK_CATEGORIES: readonly RiskCategory[] = [
  'altura',
  'electrico',
  'hazmat',
  'ergo',
  'lineas_de_fuego',
  'espacio_confinado',
  'ruido',
] as const;

router.get('/:projectId/microtraining/catalog', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  return res.json({ modules: MICROTRAINING_CATALOG, passThreshold: PASS_THRESHOLD });
});

router.get(
  '/:projectId/microtraining/recommend',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const workerUid =
      typeof req.query.workerUid === 'string' && req.query.workerUid.length > 0
        ? req.query.workerUid
        : callerUid;
    const risksRaw =
      typeof req.query.risks === 'string' ? req.query.risks : '';
    const detectedRisks = risksRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is RiskCategory =>
        (RISK_CATEGORIES as readonly string[]).includes(s),
      );
    if (detectedRisks.length === 0) {
      return res.json({ module: null, reason: 'no_risks_in_query' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new MicrotrainingAdapter(
        admin.firestore(),
        g.tenantId,
        projectId,
      );
      const certifiedModuleIds = await adapter.listCertifiedModuleIds(workerUid);
      const module = selectMicroModule({
        workerUid,
        detectedRisks,
        certifiedModuleIds,
      });
      return res.json({ module, certifiedModuleIds });
    } catch (err) {
      logger.error?.('microtraining.recommend.error', err);
      captureRouteError(err, 'microtraining.recommend');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

const sessionSchema = z.object({
  workerUid: z.string().min(1),
  moduleId: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
  answers: z
    .array(
      z.object({
        blockIndex: z.number().int().nonnegative(),
        selectedIndex: z.number().int().nonnegative(),
      }),
    )
    .max(50),
});

router.post(
  '/:projectId/microtraining/session',
  verifyAuth,
  validate(sessionSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof sessionSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const module = MICROTRAINING_CATALOG.find((m) => m.id === body.moduleId);
      if (!module) {
        return res.status(404).json({ error: 'unknown_module' });
      }
      // Score server-side — never trust a client-supplied score. The
      // client's display score may show during the result screen but the
      // canonical score that drives certification comes from here.
      const score = scoreSession(
        { ...body, score: undefined } as MicroTrainingSession,
        module,
      );
      const finalSession: MicroTrainingSession = {
        ...body,
        // The certificate SUBJECT is the VERIFIED caller who actually took the
        // quiz — NEVER the client-supplied workerUid, which let any project
        // member mint a competency cert (altura/eléctrico/confinado/hazmat) for
        // a worker who never trained → that worker assigned to a hazardous task
        // they cannot safely perform. F3 identity-from-token.
        workerUid: callerUid,
        completedAt: body.completedAt ?? Date.now(),
        score,
      };
      const adapter = new MicrotrainingAdapter(
        admin.firestore(),
        g.tenantId,
        projectId,
      );
      const sessionId = await adapter.saveSession(finalSession);
      let certified = false;
      if (shouldCertify(finalSession, module)) {
        const cert = buildCertFromSession(finalSession, module, sessionId);
        await adapter.grantCert(callerUid, body.moduleId, cert);
        certified = true;
      }
      await auditServerEvent(req, 'microtraining.session', 'microtraining', {
        projectId,
        sessionId,
        workerUid: callerUid,
        moduleId: body.moduleId,
        score,
        certified,
      }, { projectId });
      return res.status(201).json({
        sessionId,
        score,
        certified,
        passThreshold: PASS_THRESHOLD,
      });
    } catch (err) {
      logger.error?.('microtraining.session.error', err);
      captureRouteError(err, 'microtraining.session');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

router.get('/:projectId/microtraining/certs', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const workerUid =
    typeof req.query.workerUid === 'string' && req.query.workerUid.length > 0
      ? req.query.workerUid
      : callerUid;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = new MicrotrainingAdapter(
      admin.firestore(),
      g.tenantId,
      projectId,
    );
    const certs = await adapter.listCertsForWorker(workerUid);
    return res.json({ certs });
  } catch (err) {
    logger.error?.('microtraining.certs.error', err);
    captureRouteError(err, 'microtraining.certs');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
