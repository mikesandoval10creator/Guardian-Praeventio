// Praeventio Guard — Admin Burden + Automation Suggester HTTP surface.
//
// Sprint 51 §259-260 — two stateless endpoints over the engines under
// `src/services/adminBurden/`:
//
//   POST /:projectId/admin-burden/report
//     body: { entries }
//     200:  { report: AdminBurdenReport }
//     400:  { error: 'validation_error', message }
//
//   POST /:projectId/admin-burden/suggest-automations
//     body: { report }
//     200:  { suggestions: AutomationSuggestion[], totalSavedMinutesPerWeek }
//
// Pure compute — no Firestore writes.

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
  buildAdminBurdenReport,
  AdminBurdenValidationError,
  type AdminTaskTimeEntry,
  type AdminBurdenReport,
} from '../../services/adminBurden/adminBurdenTracker.js';
import {
  suggestAutomations,
  totalSavedMinutesPerWeek,
} from '../../services/adminBurden/automationSuggester.js';

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

const ADMIN_TASK_KINDS = [
  'data_entry',
  'manual_report',
  'signature_collection',
  'duplicate_filing',
  'phone_followup',
  'manual_pdf_export',
  'spreadsheet_update',
  'inbox_triage',
] as const;

const timeEntrySchema = z.object({
  taskKind: z.enum(ADMIN_TASK_KINDS),
  workerUid: z.string().min(1).max(200),
  timeSpentMinutes: z.number().nonnegative().max(100_000),
  periodWeek: z.string().regex(/^\d{4}-W\d{2}$/, 'periodWeek must be ISO YYYY-Wnn'),
  automatable: z.boolean(),
}) as unknown as z.ZodType<AdminTaskTimeEntry>;

// ────────────────────────────────────────────────────────────────────────
// 1. report
// ────────────────────────────────────────────────────────────────────────

const reportSchema = z.object({
  entries: z.array(timeEntrySchema).max(20_000),
});

router.post(
  '/:projectId/admin-burden/report',
  verifyAuth,
  validate(reportSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof reportSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const report = buildAdminBurdenReport(body.entries);
      return res.json({ report });
    } catch (err) {
      if (err instanceof AdminBurdenValidationError) {
        return res.status(400).json({ error: 'validation_error', message: err.message });
      }
      logger.error?.('adminBurden.report.error', err);
      captureRouteError(err, 'adminBurden.report');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. suggest-automations
// ────────────────────────────────────────────────────────────────────────

// AdminBurdenReport is the engine output shape; accept loosely as input.
// z.record() requires a non-null object, so a missing/undefined body field
// correctly returns 400 instead of letting the engine dereference undefined
// and crash with a TypeError (HTTP 500). The cast is preserved so the
// downstream handler still types `body.report` as AdminBurdenReport.
const reportEchoSchema = z.record(z.string(), z.unknown()) as unknown as z.ZodType<AdminBurdenReport>;

const suggestSchema = z.object({
  report: reportEchoSchema,
});

router.post(
  '/:projectId/admin-burden/suggest-automations',
  verifyAuth,
  validate(suggestSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof suggestSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const suggestions = suggestAutomations(body.report);
      const totalSaved = totalSavedMinutesPerWeek(suggestions);
      return res.json({ suggestions, totalSavedMinutesPerWeek: totalSaved });
    } catch (err) {
      logger.error?.('adminBurden.suggestAutomations.error', err);
      captureRouteError(err, 'adminBurden.suggestAutomations');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
