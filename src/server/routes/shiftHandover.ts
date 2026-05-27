// Praeventio Guard — Shift Handover (Bitácora Supervisor) HTTP surface.
//
// Sprint 39 J.8 — stateless ops over the engine under
// `src/services/shiftHandover/shiftHandoverService.ts`:
//
//   POST /:projectId/shift-handover/start
//     body: { id, kind }  // supervisorUid forced from caller
//     200:  { shift: ShiftRecord }
//
//   POST /:projectId/shift-handover/log-entry
//     body: { shift, entry }  // authorUid forced from caller
//     200:  { shift: ShiftRecord }
//
//   POST /:projectId/shift-handover/add-note
//     body: { shift, note }
//     200:  { shift: ShiftRecord }
//
//   POST /:projectId/shift-handover/end
//     body: { shift }
//     200:  { shift: ShiftRecord }
//
//   POST /:projectId/shift-handover/acknowledge
//     body: { shift, notes? }  // incomingSupervisorUid forced from caller
//     200:  { shift: ShiftRecord }
//
//   POST /:projectId/shift-handover/summarize
//     body: { shift }
//     200:  { summary: ShiftSummary }
//
// Pure compute — no Firestore writes. Persistencia la decide el caller.

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
import {
  startShift,
  logEntry,
  addHandoverNote,
  endShift,
  acknowledgeHandover,
  summarizeShift,
  HandoverValidationError,
  type ShiftRecord,
  type ShiftHandoverNote,
  type ShiftLogEntry,
} from '../../services/shiftHandover/shiftHandoverService.js';

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

const SHIFT_KINDS = ['morning', 'afternoon', 'night', 'extended'] as const;
const HANDOVER_CATEGORIES = [
  'open_incidents',
  'equipment_down',
  'pending_controls',
  'absent_workers',
  'restricted_zones',
  'active_permits',
  'admin_pending',
  'weather_alert',
  'observation',
] as const;
const SEVERITIES = ['info', 'attention', 'urgent'] as const;

const handoverNoteSchema = z.object({
  category: z.enum(HANDOVER_CATEGORIES),
  text: z.string().min(1).max(5000),
  severity: z.enum(SEVERITIES),
  referenceId: z.string().min(1).max(200).optional(),
}) as unknown as z.ZodType<ShiftHandoverNote>;

const logEntrySchema = z.object({
  authorUid: z.string().min(1).max(200),
  authorRole: z.string().min(1).max(200),
  at: z.string().min(10).max(64).optional(),
  text: z.string().min(1).max(5000),
  requiresFollowUp: z.boolean(),
}) as unknown as z.ZodType<Omit<ShiftLogEntry, 'at'> & { at?: string }>;

const shiftRecordSchema = z.object({
  id: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  kind: z.enum(SHIFT_KINDS),
  startedAt: z.string().min(10).max(64),
  endedAt: z.string().min(10).max(64).optional(),
  supervisorUid: z.string().min(1).max(200),
  logEntries: z.array(z.object({
    authorUid: z.string().min(1).max(200),
    authorRole: z.string().min(1).max(200),
    at: z.string().min(10).max(64),
    text: z.string().min(1).max(5000),
    requiresFollowUp: z.boolean(),
  })).max(10_000),
  handoverNotes: z.array(z.object({
    category: z.enum(HANDOVER_CATEGORIES),
    text: z.string().min(1).max(5000),
    severity: z.enum(SEVERITIES),
    referenceId: z.string().min(1).max(200).optional(),
  })).max(1000),
  acknowledgedByUid: z.string().min(1).max(200).optional(),
  acknowledgedAt: z.string().min(10).max(64).optional(),
  acknowledgmentNotes: z.string().max(5000).optional(),
}) as unknown as z.ZodType<ShiftRecord>;

function asEngineError(err: unknown): { code: number; body: { error: string } } | null {
  if (err instanceof HandoverValidationError) {
    return { code: 400, body: { error: err.message } };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// 1. start
// ────────────────────────────────────────────────────────────────────────

const startSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(SHIFT_KINDS),
});

router.post(
  '/:projectId/shift-handover/start',
  verifyAuth,
  validate(startSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof startSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const shift = startShift({
        id: body.id,
        projectId,
        kind: body.kind,
        supervisorUid: callerUid,
      });
      return res.json({ shift });
    } catch (err) {
      const mapped = asEngineError(err);
      if (mapped) return res.status(mapped.code).json(mapped.body);
      logger.error?.('shiftHandover.start.error', err);
      captureRouteError(err, 'shiftHandover.start');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. log-entry
// ────────────────────────────────────────────────────────────────────────

const logEntryRouteSchema = z.object({
  shift: shiftRecordSchema,
  entry: logEntrySchema,
});

router.post(
  '/:projectId/shift-handover/log-entry',
  verifyAuth,
  validate(logEntryRouteSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof logEntryRouteSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const next = logEntry(body.shift, { ...body.entry, authorUid: callerUid });
      return res.json({ shift: next });
    } catch (err) {
      const mapped = asEngineError(err);
      if (mapped) return res.status(mapped.code).json(mapped.body);
      logger.error?.('shiftHandover.logEntry.error', err);
      captureRouteError(err, 'shiftHandover.logEntry');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. add-note
// ────────────────────────────────────────────────────────────────────────

const addNoteSchema = z.object({
  shift: shiftRecordSchema,
  note: handoverNoteSchema,
});

router.post(
  '/:projectId/shift-handover/add-note',
  verifyAuth,
  validate(addNoteSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof addNoteSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const next = addHandoverNote(body.shift, body.note);
      return res.json({ shift: next });
    } catch (err) {
      const mapped = asEngineError(err);
      if (mapped) return res.status(mapped.code).json(mapped.body);
      logger.error?.('shiftHandover.addNote.error', err);
      captureRouteError(err, 'shiftHandover.addNote');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. end
// ────────────────────────────────────────────────────────────────────────

const endSchema = z.object({ shift: shiftRecordSchema });

router.post(
  '/:projectId/shift-handover/end',
  verifyAuth,
  validate(endSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof endSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const next = endShift(body.shift);
      return res.json({ shift: next });
    } catch (err) {
      const mapped = asEngineError(err);
      if (mapped) return res.status(mapped.code).json(mapped.body);
      logger.error?.('shiftHandover.end.error', err);
      captureRouteError(err, 'shiftHandover.end');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. acknowledge
// ────────────────────────────────────────────────────────────────────────

const acknowledgeSchema = z.object({
  shift: shiftRecordSchema,
  notes: z.string().max(5000).optional(),
});

router.post(
  '/:projectId/shift-handover/acknowledge',
  verifyAuth,
  validate(acknowledgeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof acknowledgeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const next = acknowledgeHandover(body.shift, callerUid, body.notes);
      return res.json({ shift: next });
    } catch (err) {
      const mapped = asEngineError(err);
      if (mapped) return res.status(mapped.code).json(mapped.body);
      logger.error?.('shiftHandover.acknowledge.error', err);
      captureRouteError(err, 'shiftHandover.acknowledge');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 6. summarize
// ────────────────────────────────────────────────────────────────────────

const summarizeSchema = z.object({ shift: shiftRecordSchema });

router.post(
  '/:projectId/shift-handover/summarize',
  verifyAuth,
  validate(summarizeSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof summarizeSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const summary = summarizeShift(body.shift);
      return res.json({ summary });
    } catch (err) {
      logger.error?.('shiftHandover.summarize.error', err);
      captureRouteError(err, 'shiftHandover.summarize');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
