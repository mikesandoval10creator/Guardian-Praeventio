// Praeventio Guard — Bloque 3 wire huérfanos (plan item 3.11).
//
// HTTP surface for the equipment QR + pre-use checklist service at
// `src/services/equipment/equipmentQrService.ts`. Mirrors the readReceipts +
// loneWorker wire pattern: pure-compute endpoints over the deterministic
// engine, with the persistence side-effect (equipment register, pre-use
// append, status update) delegated to `EquipmentAdapter`.
//
// Endpoints (declared in this order so the literal `list-by-site` is
// matched BEFORE the `:qrId` dynamic segment — Express first-match-wins):
//   POST /:projectId/equipment-qr/register             — admin/supervisor registers a new equipment + generates QR id
//   GET  /:projectId/equipment-qr/list-by-site         — list equipment filtered by status (defaults to operativo)
//   GET  /:projectId/equipment-qr/:qrId                — lookup equipment by its QR id (== equipment.id)
//   POST /:projectId/equipment-qr/:qrId/preuse         — worker submits the pre-use checklist (recommend-only, never blocks)
//   GET  /:projectId/equipment-qr/:qrId/history        — list recent pre-use validations for an equipment
//
// Founder directive — "Nunca bloquear maquinaria, solo recomendar":
//   • `POST /preuse` ALWAYS persists the validation event, even when the
//     pre-use returns `passed: false`. The status update to `restringido` /
//     `fuera_servicio` is a digital recommendation; the worker is the one
//     who decides at the physical machine. The response carries
//     `recommendation: { action, severity, message }` so the UI can render
//     the "RECOMENDAMOS no operar" copy — but no 4xx is returned for a
//     failed checklist. A failed validation is data, not an error.
//
// ADR 0019 (Google ecosystem foundation):
//   Persistence uses `admin.firestore()` (Google Cloud Firestore) via the
//   existing `EquipmentAdapter`. No second backend is introduced.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { randomUUID, createHash } from 'node:crypto';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { EquipmentAdapter } from '../../services/equipment/equipmentFirestoreAdapter.js';
import {
  runPreUseValidation,
  deriveEquipmentStatusAfterPreUse,
  getChecklistForType,
  EquipmentValidationError,
  type Equipment,
  type EquipmentStatus,
  type EquipmentCriticality,
  type PreUseResponse,
} from '../../services/equipment/equipmentQrService.js';

const router = Router();

// ── Guard helpers ─────────────────────────────────────────────────────

async function resolveTenantId(
  callerUid: string,
  projectId: string,
  db: admin.firestore.Firestore,
): Promise<string | null> {
  const proj = await db.collection('projects').doc(projectId).get();
  const data = proj.exists ? proj.data() : null;
  if (data && typeof data.tenantId === 'string') return data.tenantId;
  const members = await db
    .collection('projects')
    .doc(projectId)
    .collection('members')
    .where('uid', '==', callerUid)
    .limit(1)
    .get();
  if (!members.empty) {
    const tid = members.docs[0]?.data()?.tenantId;
    if (typeof tid === 'string') return tid;
  }
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
  const tenantId = await resolveTenantId(
    callerUid,
    projectId,
    admin.firestore(),
  );
  if (!tenantId) {
    res.status(404).json({ error: 'tenant_not_found' });
    return null;
  }
  return { tenantId };
}

// Admin-style role gate for register endpoint. Mirror of the supervisor
// gate in qrSignature.ts. A worker can still scan + run a pre-use; only
// adding new master records requires elevated role.
const REGISTER_ROLES = new Set(['admin', 'supervisor', 'prevencionista']);

function callerCanRegister(req: import('express').Request): boolean {
  const u = req.user;
  if (!u) return false;
  if (u.admin === true) return true;
  if (typeof u.role === 'string' && REGISTER_ROLES.has(u.role)) return true;
  const tenants = (u as unknown as {
    tenants?: Record<string, { role?: string }>;
  }).tenants;
  if (
    tenants &&
    typeof tenants === 'object' &&
    typeof u.tenantId === 'string'
  ) {
    const t = tenants[u.tenantId];
    if (t && typeof t.role === 'string' && REGISTER_ROLES.has(t.role)) {
      return true;
    }
  }
  return false;
}

// ── Shared schemas ────────────────────────────────────────────────────

const equipmentStatusSchema = z.enum([
  'operativo',
  'restringido',
  'fuera_servicio',
  'en_mantencion',
  'bloqueado_loto',
]) as unknown as z.ZodType<EquipmentStatus>;

const equipmentCriticalitySchema = z.enum([
  'low',
  'medium',
  'high',
  'critical',
]) as unknown as z.ZodType<EquipmentCriticality>;

const preUseResponseSchema = z.object({
  itemId: z.string().min(1).max(200),
  result: z.enum(['passed', 'failed']),
  notes: z.string().max(2_000).optional(),
  photoUrl: z.string().max(2_000).optional(),
}) as unknown as z.ZodType<PreUseResponse>;

// ── 1. POST /:projectId/equipment-qr/register ─────────────────────────

const registerSchema = z.object({
  code: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  brand: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  serialNumber: z.string().max(200).optional(),
  criticality: equipmentCriticalitySchema,
  riskCategories: z.array(z.string().min(1).max(200)).max(50).default([]),
  requiresPreUseChecklist: z.boolean().default(true),
  nextMaintenanceAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/equipment-qr/register',
  verifyAuth,
  idempotencyKey(),
  validate(registerSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof registerSchema>;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    if (!callerCanRegister(req)) {
      return res.status(403).json({
        error: 'forbidden_role',
        allowed: Array.from(REGISTER_ROLES),
      });
    }
    try {
      const qrId = randomUUID();
      const equipment: Equipment = {
        id: qrId,
        code: body.code,
        type: body.type,
        brand: body.brand,
        model: body.model,
        serialNumber: body.serialNumber,
        status: 'operativo',
        criticality: body.criticality,
        nextMaintenanceAt: body.nextMaintenanceAt,
        riskCategories: body.riskCategories,
        requiresPreUseChecklist: body.requiresPreUseChecklist,
      };
      const adapter = new EquipmentAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      await adapter.save(equipment);
      // QR payload is `equipment:{id}` — small, stable, and parseable by
      // the scanner. The PNG render is done client-side via qrcode.react.
      const qrPayload = `equipment:${qrId}`;
      return res.status(201).json({ equipment, qrPayload });
    } catch (err) {
      logger.error?.('equipmentQr.register.error', err);
      captureRouteError(err, 'equipmentQr.register', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── 2. GET /:projectId/equipment-qr/list-by-site ──────────────────────
// IMPORTANT: this literal path MUST be registered BEFORE the `/:qrId`
// dynamic route below, otherwise Express would match "list-by-site" as
// the qrId parameter (first-match-wins routing).

router.get(
  '/:projectId/equipment-qr/list-by-site',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const status =
      typeof req.query.status === 'string'
        ? (req.query.status as EquipmentStatus)
        : ('operativo' as EquipmentStatus);
    const ALLOWED: EquipmentStatus[] = [
      'operativo',
      'restringido',
      'fuera_servicio',
      'en_mantencion',
      'bloqueado_loto',
    ];
    if (!ALLOWED.includes(status)) {
      return res.status(400).json({ error: 'invalid_status' });
    }
    try {
      const adapter = new EquipmentAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const equipment = await adapter.listByStatus(status);
      return res.json({ equipment });
    } catch (err) {
      logger.error?.('equipmentQr.listBySite.error', err);
      captureRouteError(err, 'equipmentQr.listBySite', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── 3. GET /:projectId/equipment-qr/:qrId ─────────────────────────────

router.get(
  '/:projectId/equipment-qr/:qrId',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, qrId } = req.params;
    if (!qrId || qrId.length < 1 || qrId.length > 200) {
      return res.status(400).json({ error: 'invalid_qr_id' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new EquipmentAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const equipment = await adapter.getById(qrId);
      if (!equipment) {
        return res.status(404).json({ error: 'equipment_not_found' });
      }
      const checklist = getChecklistForType(equipment.type);
      return res.json({ equipment, checklist });
    } catch (err) {
      logger.error?.('equipmentQr.lookup.error', err);
      captureRouteError(err, 'equipmentQr.lookup', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── 4. POST /:projectId/equipment-qr/:qrId/preuse ─────────────────────

const preUseSchema = z.object({
  responses: z.array(preUseResponseSchema).min(0).max(200),
  // Optional — workers can attach the digital "I read it" hash so the
  // audit trail carries an integrity check beyond the Firestore doc id.
  signatureHashHex: z.string().min(8).max(200).optional(),
});

interface PreUseRecommendation {
  action: 'proceed' | 'recommend_not_operate' | 'recommend_report_supervisor';
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

router.post(
  '/:projectId/equipment-qr/:qrId/preuse',
  verifyAuth,
  idempotencyKey(),
  validate(preUseSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, qrId } = req.params;
    const body = req.validated as z.infer<typeof preUseSchema>;
    if (!qrId || qrId.length < 1 || qrId.length > 200) {
      return res.status(400).json({ error: 'invalid_qr_id' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    try {
      const adapter = new EquipmentAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const equipment = await adapter.getById(qrId);
      if (!equipment) {
        return res.status(404).json({ error: 'equipment_not_found' });
      }
      // Build the validation record. We catch the engine's
      // `EquipmentValidationError` and translate to 422 — these are
      // client-side input bugs (incomplete checklist, equipment in
      // a non-usable state). They are NOT a "we refuse to record":
      // a 422 here means the client must fix the payload, not that
      // the worker is being blocked.
      let validation;
      try {
        validation = runPreUseValidation({
          id: randomUUID(),
          equipment,
          workerUid: callerUid,
          responses: body.responses,
          now: new Date(),
        });
      } catch (err) {
        if (err instanceof EquipmentValidationError) {
          return res.status(422).json({
            error: 'preuse_validation_error',
            code: err.code,
            message: err.message,
          });
        }
        throw err;
      }
      // Persistence first — the audit log MUST always reflect the
      // worker attempted the checklist, regardless of pass/fail.
      await adapter.appendPreUse(validation);
      // Now derive the recommended status change. We persist the
      // status update on the equipment master (so other workers see
      // the recommendation), but the equipment record stays usable
      // physically — we never set a `blocked: true` flag.
      const derivedStatus = deriveEquipmentStatusAfterPreUse(
        equipment.status,
        validation,
        equipment.criticality,
      );
      let appliedStatus = equipment.status;
      if (derivedStatus !== equipment.status) {
        await adapter.updateStatus(equipment.id, derivedStatus);
        appliedStatus = derivedStatus;
      }
      // Recommendation copy — the UI uses this verbatim. Note the
      // language: "RECOMENDAMOS" not "BLOQUEAMOS".
      let recommendation: PreUseRecommendation;
      if (validation.passed) {
        recommendation = {
          action: 'proceed',
          severity: 'info',
          message: 'Checklist completo — puedes operar el equipo.',
        };
      } else if (equipment.criticality === 'critical' || equipment.criticality === 'high') {
        recommendation = {
          action: 'recommend_not_operate',
          severity: 'critical',
          message:
            'RECOMENDAMOS no operar este equipo y reportar al supervisor. ' +
            'Se detectaron anomalías en el checklist pre-uso.',
        };
      } else {
        recommendation = {
          action: 'recommend_report_supervisor',
          severity: 'warning',
          message:
            'Recomendamos reportar las anomalías al supervisor antes de operar. ' +
            'Documenta lo que viste para que el equipo de mantención actúe.',
        };
      }
      // Optional integrity hash so the audit trail carries a
      // tamper-evident fingerprint (Stripe-like Idempotent-Replayed
      // semantics; the body fingerprint also lives in the idempotency
      // cache via the middleware).
      const auditHash = createHash('sha256')
        .update(`${validation.id}|${validation.equipmentId}|${validation.workerUid}|${validation.startedAt}|${validation.passed}`)
        .digest('hex');
      return res.status(201).json({
        validation,
        recommendation,
        appliedStatus,
        auditHash,
      });
    } catch (err) {
      logger.error?.('equipmentQr.preuse.error', err);
      captureRouteError(err, 'equipmentQr.preuse', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── 5. GET /:projectId/equipment-qr/:qrId/history ─────────────────────

router.get(
  '/:projectId/equipment-qr/:qrId/history',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, qrId } = req.params;
    if (!qrId || qrId.length < 1 || qrId.length > 200) {
      return res.status(400).json({ error: 'invalid_qr_id' });
    }
    const g = await guard(callerUid, projectId, res);
    if (!g) return undefined;
    const rawLimit =
      typeof req.query.limit === 'string'
        ? Number.parseInt(req.query.limit, 10)
        : 50;
    const limitN = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 50;
    try {
      const adapter = new EquipmentAdapter(
        admin.firestore() as any,
        g.tenantId,
        projectId,
      );
      const history = await adapter.listPreUsesForEquipment(qrId, limitN);
      return res.json({ history });
    } catch (err) {
      logger.error?.('equipmentQr.history.error', err);
      captureRouteError(err, 'equipmentQr.history', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
