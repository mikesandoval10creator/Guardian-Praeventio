// Praeventio Guard — Bloque 3.18 — Shift Handover HTTP surface.
//
// Wires the pure-compute engine at
// `src/services/shiftHandover/shiftHandoverService.ts` (and the Firestore
// adapter / insights modules under the same folder) to authenticated,
// project-scoped endpoints. Mirrors `loneWorker.ts` and `stoppage.ts`:
// thin JSON marshalling around engine functions, project-membership-gated,
// idempotency-aware on the mutating calls.
//
// ADR 0019. Para operaciones 24/7, el cambio de turno es uno de los
// momentos más peligrosos: información se pierde, supuestos se
// transmiten mal. Esta bitácora estandariza qué información debe pasar
// de turno a turno (incidentes, equipos fuera de servicio, controles
// pendientes, trabajadores ausentes, zonas restringidas, permisos
// activos, pendientes administrativos, observaciones).
//
// Endpoints:
//   POST /:projectId/shift-handover/create
//   POST /:projectId/shift-handover/:hoId/acknowledge
//   POST /:projectId/shift-handover/:hoId/add-discrepancy
//   GET  /:projectId/shift-handover/active
//   GET  /:projectId/shift-handover/history?days=30
//
// Flow:
//   1. Turno saliente "create"s the handover (startShift + endShift + notes
//      bundled in a single payload — the engine is pure, so we apply the
//      sequence and persist).
//   2. Turno entrante calls "acknowledge" with optional notes.
//   3. Si hay discrepancias después del acuse, "add-discrepancy" anexa la
//      nota al campo `acknowledgmentNotes` con prefijo `[DISCREPANCY YYYY-MM-DDTHH:mm]`.
//   4. "active" devuelve los handovers cerrados pero sin acuse de recibo
//      (lo que el turno entrante debe leer al entrar).
//   5. "history?days=N" devuelve handovers con `startedAt` dentro de los
//      últimos N días, ordenados desc. Tenant-scoped via assertProjectMember.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  startShift,
  endShift,
  logEntry,
  addHandoverNote,
  acknowledgeHandover,
  summarizeShift,
  HandoverValidationError,
  type ShiftRecord,
  type ShiftKind,
  type HandoverCategory,
  type ShiftHandoverNote,
  type ShiftLogEntry,
} from '../../services/shiftHandover/shiftHandoverService.js';
import {
  ShiftHandoverAdapter,
  type ShiftFirestoreDb,
} from '../../services/shiftHandover/shiftHandoverFirestoreAdapter.js';
import {
  computeHandoverQuality,
} from '../../services/shiftHandover/shiftHandoverInsights.js';

const router = Router();

// ────────────────────────────────────────────────────────────────────────
// helpers
// ────────────────────────────────────────────────────────────────────────

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

/**
 * Resolve the tenant id for the caller. Same convention as
 * `stoppage.ts`: custom claim `tenantId` or fall back to uid. The
 * Firestore shifts collection lives under
 * `tenants/{tid}/projects/{pid}/shifts`.
 */
function resolveTenantId(req: import('express').Request): string {
  const u = req.user as { uid?: string; tenantId?: string } | undefined;
  return u?.tenantId ?? u?.uid ?? '';
}

function buildAdapter(tenantId: string, projectId: string): ShiftHandoverAdapter {
  return new ShiftHandoverAdapter(
    admin.firestore() as unknown as ShiftFirestoreDb,
    tenantId,
    projectId,
  );
}

// ────────────────────────────────────────────────────────────────────────
// shared schemas
// ────────────────────────────────────────────────────────────────────────

const shiftKindSchema = z.enum([
  'morning',
  'afternoon',
  'night',
  'extended',
]) as unknown as z.ZodType<ShiftKind>;

const categorySchema = z.enum([
  'open_incidents',
  'equipment_down',
  'pending_controls',
  'absent_workers',
  'restricted_zones',
  'active_permits',
  'admin_pending',
  'weather_alert',
  'observation',
]) as unknown as z.ZodType<HandoverCategory>;

const handoverNoteSchema = z.object({
  category: categorySchema,
  text: z.string().min(5).max(2000),
  severity: z.enum(['info', 'attention', 'urgent']),
  referenceId: z.string().min(1).max(200).optional(),
}) as unknown as z.ZodType<ShiftHandoverNote>;

const logEntryInputSchema = z.object({
  authorUid: z.string().min(1).max(200),
  authorRole: z.string().min(1).max(120),
  at: z.string().min(10).optional(),
  text: z.string().min(5).max(2000),
  requiresFollowUp: z.boolean(),
}) as unknown as z.ZodType<Omit<ShiftLogEntry, 'at'> & { at?: string }>;

// ────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/shift-handover/create
//    Turno saliente registra estado al cerrar el turno: pendientes, EPP
//    entregado, incidentes, observaciones. El cliente envía:
//      { id, kind, startedAt, supervisorUid, logEntries[], handoverNotes[],
//        endedAt? }
//    El engine compone: startShift → cada logEntry → cada addHandoverNote
//    → endShift. Si `endedAt` no viene, usamos `now()`.
// ────────────────────────────────────────────────────────────────────────

const createSchema = z.object({
  id: z.string().min(1).max(200),
  kind: shiftKindSchema,
  startedAt: z.string().min(10),
  supervisorUid: z.string().min(1).max(200),
  logEntries: z.array(logEntryInputSchema).max(500).optional(),
  handoverNotes: z.array(handoverNoteSchema).max(200).optional(),
  endedAt: z.string().min(10).optional(),
});

router.post(
  '/:projectId/shift-handover/create',
  verifyAuth,
  idempotencyKey(),
  validate(createSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof createSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    // Anti-blame: el supervisor saliente es quien crea el handover. Esto
    // se firma con el uid del caller — no aceptamos crear handovers
    // a nombre de otra persona.
    if (body.supervisorUid !== callerUid) {
      return res.status(403).json({
        error: 'forbidden',
        message:
          'El handover sólo puede crearlo el supervisor saliente (uid debe coincidir con el caller).',
      });
    }
    try {
      let shift: ShiftRecord = startShift({
        id: body.id,
        projectId,
        kind: body.kind,
        supervisorUid: body.supervisorUid,
        now: new Date(body.startedAt),
      });
      for (const entry of body.logEntries ?? []) {
        shift = logEntry(shift, entry);
      }
      for (const note of body.handoverNotes ?? []) {
        shift = addHandoverNote(shift, note);
      }
      shift = endShift(
        shift,
        body.endedAt ? new Date(body.endedAt) : new Date(),
      );
      try {
        const adapter = buildAdapter(resolveTenantId(req), projectId);
        await adapter.save(shift);
      } catch (persistErr) {
        logger.warn?.('shiftHandover.create.persist_failed', persistErr);
        captureRouteError(persistErr, 'shiftHandover.create.persist', {
          callerUid,
          projectId,
        });
      }
      const quality = computeHandoverQuality(shift);
      const summary = summarizeShift(shift);
      return res.json({ shift, quality, summary });
    } catch (err) {
      if (err instanceof HandoverValidationError) {
        return res.status(400).json({
          error: 'invalid_handover',
          code: err.name,
          message: err.message,
        });
      }
      logger.error?.('shiftHandover.create.error', err);
      captureRouteError(err, 'shiftHandover.create', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/shift-handover/:hoId/acknowledge
//    Turno entrante acusa recibo. Carga el doc por id, valida el engine
//    (acknowledgeHandover) y persiste el resultado. El caller (uid del
//    entrante) NO puede coincidir con el saliente — esto lo enforce el
//    propio engine.
// ────────────────────────────────────────────────────────────────────────

const acknowledgeSchema = z.object({
  notes: z.string().min(1).max(5000).optional(),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/shift-handover/:hoId/acknowledge',
  verifyAuth,
  idempotencyKey(),
  validate(acknowledgeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, hoId } = req.params;
    const body = req.validated as z.infer<typeof acknowledgeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const adapter = buildAdapter(resolveTenantId(req), projectId);
      const existing = await adapter.getById(hoId);
      if (!existing) {
        return res.status(404).json({
          error: 'not_found',
          message: `Handover ${hoId} no existe.`,
        });
      }
      const next = acknowledgeHandover(
        existing,
        callerUid,
        body.notes,
        body.now ? new Date(body.now) : undefined,
      );
      try {
        await adapter.save(next);
      } catch (persistErr) {
        logger.warn?.('shiftHandover.acknowledge.persist_failed', persistErr);
        captureRouteError(persistErr, 'shiftHandover.acknowledge.persist', {
          callerUid,
          projectId,
        });
      }
      return res.json({ shift: next });
    } catch (err) {
      if (err instanceof HandoverValidationError) {
        return res.status(400).json({
          error: 'invalid_handover',
          code: err.name,
          message: err.message,
        });
      }
      logger.error?.('shiftHandover.acknowledge.error', err);
      captureRouteError(err, 'shiftHandover.acknowledge', {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/shift-handover/:hoId/add-discrepancy
//    El supervisor entrante, después de haber acusado recibo, descubre
//    una discrepancia (algo que el saliente no documentó, o lo documentó
//    mal). El engine no soporta nuevas notas post-end por diseño puro,
//    así que appendeamos al `acknowledgmentNotes` con prefijo timestamped.
//    Restricciones:
//      • Sólo el supervisor que ya acusó recibo (`acknowledgedByUid`) puede
//        agregar discrepancias (anti-blame).
//      • El handover debe haber sido acusado primero.
// ────────────────────────────────────────────────────────────────────────

const addDiscrepancySchema = z.object({
  text: z.string().min(10).max(2000),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/shift-handover/:hoId/add-discrepancy',
  verifyAuth,
  idempotencyKey(),
  validate(addDiscrepancySchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, hoId } = req.params;
    const body = req.validated as z.infer<typeof addDiscrepancySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const adapter = buildAdapter(resolveTenantId(req), projectId);
      const existing = await adapter.getById(hoId);
      if (!existing) {
        return res.status(404).json({
          error: 'not_found',
          message: `Handover ${hoId} no existe.`,
        });
      }
      if (!existing.acknowledgedByUid || !existing.acknowledgedAt) {
        return res.status(400).json({
          error: 'not_acknowledged',
          message:
            'No se pueden registrar discrepancias antes de acusar recibo del handover.',
        });
      }
      if (existing.acknowledgedByUid !== callerUid) {
        return res.status(403).json({
          error: 'forbidden',
          message:
            'Sólo el supervisor entrante que acusó recibo puede registrar discrepancias.',
        });
      }
      const at = body.now ? new Date(body.now) : new Date();
      const stamp = `[DISCREPANCY ${at.toISOString()}] ${body.text}`;
      const next: ShiftRecord = {
        ...existing,
        acknowledgmentNotes: existing.acknowledgmentNotes
          ? `${existing.acknowledgmentNotes}\n${stamp}`
          : stamp,
      };
      try {
        await adapter.save(next);
      } catch (persistErr) {
        logger.warn?.(
          'shiftHandover.addDiscrepancy.persist_failed',
          persistErr,
        );
        captureRouteError(
          persistErr,
          'shiftHandover.addDiscrepancy.persist',
          { callerUid, projectId },
        );
      }
      return res.json({ shift: next });
    } catch (err) {
      logger.error?.('shiftHandover.addDiscrepancy.error', err);
      captureRouteError(err, 'shiftHandover.addDiscrepancy', {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. GET /:projectId/shift-handover/active
//    Devuelve los handovers cerrados (endedAt set) sin acuse de recibo.
//    Esto es lo que el turno entrante debe leer al entrar al sistema.
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/shift-handover/active',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const adapter = buildAdapter(resolveTenantId(req), projectId);
      const shifts = await adapter.listUnacknowledged();
      // Compute quality reports for each so the dashboard can show
      // missing-critical-categories without an extra round trip.
      const enriched = shifts.map((shift) => ({
        shift,
        quality: computeHandoverQuality(shift),
        summary: summarizeShift(shift),
      }));
      return res.json({ shifts: enriched });
    } catch (err) {
      logger.error?.('shiftHandover.active.error', err);
      captureRouteError(err, 'shiftHandover.active', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. GET /:projectId/shift-handover/history?days=30
//    Devuelve handovers con startedAt dentro de los últimos N días (default
//    30, max 365), ordenados por startedAt desc. Como el adapter no expone
//    un query por proyecto + rango temporal directo, usamos
//    `listUnacknowledged` como base (que devuelve un fetch completo) y
//    filtramos en memoria — la collection es por-proyecto, así que el
//    cardinal está acotado.
// ────────────────────────────────────────────────────────────────────────

const historyQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

router.get(
  '/:projectId/shift-handover/history',
  verifyAuth,
  validate(historyQuerySchema, 'query'),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const q = req.validated as z.infer<typeof historyQuerySchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const adapter = buildAdapter(resolveTenantId(req), projectId);
      // Fetch a wide window via adapter.listForSupervisor / listUnacknowledged
      // doesn't cover "all in collection". We re-use the underlying collection
      // through a direct read via the adapter's interface — but ShiftHandoverAdapter
      // only exposes listForSupervisor and listUnacknowledged. Strategy:
      // call the raw collection through the firestore handle we built the
      // adapter with. To keep the route logic clean and not duplicate the
      // path constant, we hit the collection directly here.
      const db = admin.firestore();
      const tenantId = resolveTenantId(req);
      const snap = await db
        .collection(`tenants/${tenantId}/projects/${projectId}/shifts`)
        .orderBy('startedAt', 'desc')
        .limit(1000)
        .get();
      const cutoff = Date.now() - q.days * 86_400_000;
      const shifts = snap.docs
        .map((d) => d.data() as ShiftRecord)
        .filter((s) => {
          const t = Date.parse(s.startedAt);
          return Number.isFinite(t) && t >= cutoff;
        });
      const enriched = shifts.map((shift) => ({
        shift,
        quality: computeHandoverQuality(shift),
        summary: summarizeShift(shift),
      }));
      return res.json({ shifts: enriched, days: q.days });
    } catch (err) {
      logger.error?.('shiftHandover.history.error', err);
      captureRouteError(err, 'shiftHandover.history', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
