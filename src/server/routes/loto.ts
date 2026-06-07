// Praeventio Guard — LOTO Digital (Lock-Out / Tag-Out).
//
// Endpoint dedicado para `/api/sprint-k/:projectId/loto[...]`.
// Migrado del monolito `sprintK.ts` (2026-05-18); write-path Fase 5 (B8).
//
// Founder directive — la app NUNCA bloquea maquinaria: estos endpoints
// REGISTRAN (con trazabilidad legal) el procedimiento físico LOTO que ejecuta
// una persona — qué energías se aislaron, qué candados/tarjetas se aplicaron,
// la verificación de cero energía, y la liberación. El gate de liberación
// (`validateRelease`) es sobre QUIÉN puede registrar la liberación (líder o
// autorizado), no un bloqueo de hardware.
//
// Endpoints:
//   GET  /:projectId/loto[?equipmentId=X]               → lista activos o por equipo
//   POST /:projectId/loto                                → crear aplicación LOTO
//   POST /:projectId/loto/:appId/apply-lock              → aplicar candado/tarjeta
//   POST /:projectId/loto/:appId/verify-zero-energy      → try-out cero energía
//   POST /:projectId/loto/:appId/release                 → liberación total (firmada)
//
// Cada cambio de estado escribe DOS audits: la subcolección legal inmutable del
// LOTO (`loto_applications/{id}/audit`) + el `audit_logs` global (CLAUDE.md #3).

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { randomId } from '../../utils/randomId.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { LotoAdapter } from '../../services/loto/lotoFirestoreAdapter.js';
import {
  validateLotoApplication,
  validateRelease,
  applyFullRelease,
  type LotoApplication,
  type LotoLockPoint,
} from '../../services/loto/lotoDigitalLight.js';

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

function adapterFor(tenantId: string, projectId: string): LotoAdapter {
  return new LotoAdapter(admin.firestore(), tenantId, projectId);
}

// ── Schemas ──────────────────────────────────────────────────────────
const energyEnum = z.enum([
  'gravity',
  'electric',
  'mechanical',
  'chemical',
  'thermal',
  'pressure',
  'radiation',
  'biological',
]);

const createSchema = z.object({
  equipmentId: z.string().min(1).max(200),
  workDescription: z.string().min(3).max(2000),
  energiesIdentified: z.array(energyEnum).min(1).max(16),
  authorizedWorkerUids: z.array(z.string().min(1).max(128)).max(100).default([]),
});

const applyLockSchema = z.object({
  pointId: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  energyType: energyEnum,
  tagId: z.string().min(1).max(120),
});

const verifySchema = z.object({
  pointId: z.string().min(1).max(120),
});

// ── GET (list) ───────────────────────────────────────────────────────
router.get('/:projectId/loto', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = adapterFor(g.tenantId, projectId);
    const equipmentId =
      typeof req.query.equipmentId === 'string' ? req.query.equipmentId : null;
    const applications = equipmentId
      ? await adapter.listForEquipment(equipmentId)
      : await adapter.listActive();
    return res.json({ applications });
  } catch (err) {
    logger.error?.('loto.list.error', err);
    captureRouteError(err, 'loto.list');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST create ──────────────────────────────────────────────────────
router.post('/:projectId/loto', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  }
  const body = parsed.data;
  try {
    const adapter = adapterFor(g.tenantId, projectId);
    const now = new Date().toISOString();
    const application: LotoApplication = {
      id: randomId(),
      equipmentId: body.equipmentId,
      // Leader is the verified caller — never trusted from the body.
      leaderUid: callerUid,
      authorizedWorkerUids: body.authorizedWorkerUids,
      energiesIdentified: body.energiesIdentified,
      lockPoints: [],
      appliedAt: now,
      workDescription: body.workDescription,
    };
    await adapter.save(application);
    await adapter.appendAudit(application.id, {
      at: now,
      kind: 'created',
      actorUid: callerUid,
      detail: `LOTO creado para equipo ${body.equipmentId} (${body.energiesIdentified.join(', ')})`,
    });
    await auditServerEvent(
      req,
      'loto.created',
      'loto',
      { applicationId: application.id, equipmentId: body.equipmentId },
      { projectId },
    );
    return res.status(201).json({ application });
  } catch (err) {
    logger.error?.('loto.create.error', err);
    captureRouteError(err, 'loto.create');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST apply-lock ──────────────────────────────────────────────────
router.post('/:projectId/loto/:appId/apply-lock', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId, appId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  const parsed = applyLockSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  }
  const body = parsed.data;
  try {
    const adapter = adapterFor(g.tenantId, projectId);
    const app = await adapter.getById(appId);
    if (!app) return res.status(404).json({ error: 'application_not_found' });
    if (app.fullyReleasedAt) return res.status(409).json({ error: 'already_released' });
    if (app.lockPoints.some((lp) => lp.pointId === body.pointId)) {
      return res.status(409).json({ error: 'duplicate_lock_point' });
    }
    const now = new Date().toISOString();
    const lockPoint: LotoLockPoint = {
      pointId: body.pointId,
      description: body.description,
      energyType: body.energyType,
      // Stamped from the verified token — who physically applied the lock.
      appliedByUid: callerUid,
      appliedAt: now,
      tagId: body.tagId,
      zeroEnergyVerified: false,
    };
    const updated: LotoApplication = { ...app, lockPoints: [...app.lockPoints, lockPoint] };
    await adapter.save(updated);
    await adapter.appendAudit(appId, {
      at: now,
      kind: 'lock_point_applied',
      actorUid: callerUid,
      detail: `Candado ${body.tagId} en ${body.pointId} (${body.energyType})`,
    });
    await auditServerEvent(
      req,
      'loto.lock_point_applied',
      'loto',
      { applicationId: appId, pointId: body.pointId, energyType: body.energyType },
      { projectId },
    );
    return res.status(200).json({ application: updated, validation: validateLotoApplication(updated) });
  } catch (err) {
    logger.error?.('loto.apply_lock.error', err);
    captureRouteError(err, 'loto.apply_lock');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST verify-zero-energy ──────────────────────────────────────────
router.post('/:projectId/loto/:appId/verify-zero-energy', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId, appId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', details: parsed.error.flatten() });
  }
  const body = parsed.data;
  try {
    const adapter = adapterFor(g.tenantId, projectId);
    const app = await adapter.getById(appId);
    if (!app) return res.status(404).json({ error: 'application_not_found' });
    if (app.fullyReleasedAt) return res.status(409).json({ error: 'already_released' });
    if (!app.lockPoints.some((lp) => lp.pointId === body.pointId)) {
      return res.status(404).json({ error: 'lock_point_not_found' });
    }
    const now = new Date().toISOString();
    const updated: LotoApplication = {
      ...app,
      lockPoints: app.lockPoints.map((lp) =>
        lp.pointId === body.pointId ? { ...lp, zeroEnergyVerified: true } : lp,
      ),
    };
    await adapter.save(updated);
    await adapter.appendAudit(appId, {
      at: now,
      kind: 'zero_energy_verified',
      actorUid: callerUid,
      detail: `Try-out cero energía verificado en ${body.pointId}`,
    });
    await auditServerEvent(
      req,
      'loto.zero_energy_verified',
      'loto',
      { applicationId: appId, pointId: body.pointId },
      { projectId },
    );
    return res.status(200).json({ application: updated, validation: validateLotoApplication(updated) });
  } catch (err) {
    logger.error?.('loto.verify.error', err);
    captureRouteError(err, 'loto.verify');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST release ─────────────────────────────────────────────────────
router.post('/:projectId/loto/:appId/release', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId, appId } = req.params;
  const g = await guard(callerUid, projectId, res);
  if (!g) return undefined;
  try {
    const adapter = adapterFor(g.tenantId, projectId);
    const app = await adapter.getById(appId);
    if (!app) return res.status(404).json({ error: 'application_not_found' });
    const now = new Date().toISOString();
    const verdict = validateRelease(app, { applicationId: appId, releaserUid: callerUid, at: now });
    if (!verdict.canRelease) {
      // Authorization / consistency gate on WHO may record the release.
      return res.status(403).json({ error: 'release_not_allowed', reasons: verdict.reasons });
    }
    const updated = applyFullRelease(app, callerUid, now);
    await adapter.save(updated);
    await adapter.appendAudit(appId, {
      at: now,
      kind: 'full_release',
      actorUid: callerUid,
      detail: 'Liberación total — retorno a operación.',
    });
    await auditServerEvent(
      req,
      'loto.full_release',
      'loto',
      { applicationId: appId },
      { projectId },
    );
    return res.status(200).json({ application: updated });
  } catch (err) {
    logger.error?.('loto.release.error', err);
    captureRouteError(err, 'loto.release');
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
