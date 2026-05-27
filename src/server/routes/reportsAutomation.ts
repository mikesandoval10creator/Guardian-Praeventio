// Praeventio Guard — Reports Automation HTTP surface.
//
// Sprint K (§267-270) — three stateless endpoints over the engine under
// `src/services/reportsAutomation/reportsAutomation.ts`:
//
//   POST /:projectId/reports-automation/validate
//     body: { template, data }
//     200:  { validation: TemplateValidationResult }
//
//   POST /:projectId/reports-automation/render
//     body: RenderInputs
//     200:  { report: PublishedReport } | 400 { error }
//
//   POST /:projectId/reports-automation/check-due
//     body: DueReportInput
//     200:  { decision: DueReportDecision }
//
// Pure compute — no Firestore writes. Persistencia/distribución lo decide
// el caller (separación service ↔ side-effect).

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
  validateReportData,
  renderReport,
  checkReportDue,
  type ReportTemplate,
  type ReportData,
  type RenderInputs,
  type DueReportInput,
} from '../../services/reportsAutomation/reportsAutomation.js';

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

const PERIODS = ['monthly', 'quarterly', 'annual'] as const;
const AUDIENCES = ['internal', 'client', 'regulatory', 'public'] as const;

const templateSchema = z.object({
  id: z.string().min(1).max(200),
  audience: z.enum(AUDIENCES),
  period: z.enum(PERIODS),
  sections: z
    .array(
      z.object({
        key: z.string().min(1).max(200),
        title: z.string().min(1).max(500),
        required: z.boolean(),
      }),
    )
    .max(50),
}) as unknown as z.ZodType<ReportTemplate>;

const dataSchema = z.object({
  contents: z.record(z.string(), z.string().max(100_000)),
}) as unknown as z.ZodType<ReportData>;

// ────────────────────────────────────────────────────────────────────────
// 1. validate
// ────────────────────────────────────────────────────────────────────────

const validateSchema = z.object({
  template: templateSchema,
  data: dataSchema,
});

router.post(
  '/:projectId/reports-automation/validate',
  verifyAuth,
  validate(validateSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof validateSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const validation = validateReportData(body.template, body.data);
      return res.json({ validation });
    } catch (err) {
      logger.error?.('reportsAutomation.validate.error', err);
      captureRouteError(err, 'reportsAutomation.validate');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. render
// ────────────────────────────────────────────────────────────────────────

const renderSchema = z.object({
  template: templateSchema,
  data: dataSchema,
  periodLabel: z.string().min(1).max(200),
  reportId: z.string().min(1).max(200),
  publishedAt: z.string().min(10).max(64),
  distributedTo: z.array(z.string().min(1).max(500)).max(1000),
}) as unknown as z.ZodType<RenderInputs>;

router.post(
  '/:projectId/reports-automation/render',
  verifyAuth,
  validate(renderSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof renderSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = renderReport(body);
      if ('error' in result) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ report: result });
    } catch (err) {
      logger.error?.('reportsAutomation.render.error', err);
      captureRouteError(err, 'reportsAutomation.render');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. check-due
// ────────────────────────────────────────────────────────────────────────

const checkDueSchema = z.object({
  templateId: z.string().min(1).max(200),
  period: z.enum(PERIODS),
  lastPublishedAt: z.string().min(10).max(64).optional(),
}) as unknown as z.ZodType<DueReportInput>;

router.post(
  '/:projectId/reports-automation/check-due',
  verifyAuth,
  validate(checkDueSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof checkDueSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const decision = checkReportDue(body);
      return res.json({ decision });
    } catch (err) {
      logger.error?.('reportsAutomation.checkDue.error', err);
      captureRouteError(err, 'reportsAutomation.checkDue');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
