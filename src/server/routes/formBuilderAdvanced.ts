// Praeventio Guard — Form Builder ADVANCED HTTP surface.
//
// Sprint 53 §263-268: extends Checklist Builder (Sprint 49 §261-270) with:
//   • computed fields with declarative formulas
//   • aggregate_section / sum / avg / countTrue over multiple fields
//   • cross-field validation (predicates over fields)
//   • topological sort + cycle-detection over dependencies
//   • date helpers: now() / today() / yearsBetween() / monthsBetween() / date_diff
//
// 5 stateless endpoints over the engine under
// `src/services/formBuilderAdvanced/advancedFieldEngine.ts`:
//
//   POST /:projectId/forms-advanced/evaluate-computed-field
//     body: { formula, responses, now? }
//     200:  { value: unknown }
//
//   POST /:projectId/forms-advanced/validate-cross-field
//     body: { rules, responses, now? }
//     200:  { findings: CrossFieldValidationFinding[] }
//
//   POST /:projectId/forms-advanced/detect-circular-deps
//     body: { formulas }
//     200:  { cyclic: string[] }
//
//   POST /:projectId/forms-advanced/topo-sort
//     body: { formulas, otherFieldIds? }
//     200:  { order: string[] }
//     400:  AdvancedFieldError → { error, code }
//
//   POST /:projectId/forms-advanced/evaluate-all-computed
//     body: { formulas, responses, now?, otherFieldIds? }
//     200:  { values: Record<string, unknown> }
//     400:  AdvancedFieldError → { error, code }
//
// Engine is fully deterministic — no `eval`, no `new Function`, no I/O.
// The evaluator is a recursive-descent parser over a closed sub-language.

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
  evaluateComputedField,
  validateCrossFieldRules,
  detectCircularDependencies,
  topologicalSortFields,
  evaluateAllComputed,
  AdvancedFieldError,
  type AdvancedFormResponse,
  type ComputedFieldFormula,
  type CrossFieldValidationRule,
} from '../../services/formBuilderAdvanced/advancedFieldEngine.js';

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

const RESULT_KINDS = ['number', 'string', 'boolean', 'date'] as const;

const formulaSchema = z.object({
  fieldId: z.string().min(1).max(200),
  expression: z.string().min(1).max(2000),
  dependencies: z.array(z.string().min(1).max(200)).max(100),
  resultKind: z.enum(RESULT_KINDS),
}) as unknown as z.ZodType<ComputedFieldFormula>;

const responseSchema = z.object({
  fieldId: z.string().min(1).max(200),
  value: z.unknown(),
}) as unknown as z.ZodType<AdvancedFormResponse>;

const ruleSchema = z.object({
  ruleId: z.string().min(1).max(120),
  fields: z.array(z.string().min(1).max(200)).max(50),
  predicate: z.string().min(1).max(2000),
  errorMessage: z.string().min(1).max(500),
}) as unknown as z.ZodType<CrossFieldValidationRule>;

// ────────────────────────────────────────────────────────────────────────
// 1. evaluate-computed-field
// ────────────────────────────────────────────────────────────────────────

const evaluateComputedSchema = z.object({
  formula: formulaSchema,
  responses: z.array(responseSchema).max(500),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/forms-advanced/evaluate-computed-field',
  verifyAuth,
  validate(evaluateComputedSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof evaluateComputedSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const value = evaluateComputedField(body.formula, body.responses, {
        now: body.now ? new Date(body.now) : undefined,
      });
      return res.json({ value });
    } catch (err) {
      if (err instanceof AdvancedFieldError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      logger.error?.('formBuilderAdvanced.evaluateComputed.error', err);
      captureRouteError(err, 'formBuilderAdvanced.evaluateComputed');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. validate-cross-field
// ────────────────────────────────────────────────────────────────────────

const validateCrossFieldSchema = z.object({
  rules: z.array(ruleSchema).max(200),
  responses: z.array(responseSchema).max(500),
  now: z.string().min(10).optional(),
});

router.post(
  '/:projectId/forms-advanced/validate-cross-field',
  verifyAuth,
  validate(validateCrossFieldSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof validateCrossFieldSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const findings = validateCrossFieldRules(body.rules, body.responses, {
        now: body.now ? new Date(body.now) : undefined,
      });
      return res.json({ findings });
    } catch (err) {
      logger.error?.('formBuilderAdvanced.validateCrossField.error', err);
      captureRouteError(err, 'formBuilderAdvanced.validateCrossField');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. detect-circular-deps
// ────────────────────────────────────────────────────────────────────────

const detectCircularSchema = z.object({
  formulas: z.array(formulaSchema).max(500),
});

router.post(
  '/:projectId/forms-advanced/detect-circular-deps',
  verifyAuth,
  validate(detectCircularSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof detectCircularSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const cyclic = detectCircularDependencies(body.formulas);
      return res.json({ cyclic });
    } catch (err) {
      logger.error?.('formBuilderAdvanced.detectCircular.error', err);
      captureRouteError(err, 'formBuilderAdvanced.detectCircular');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. topo-sort
// ────────────────────────────────────────────────────────────────────────

const topoSortSchema = z.object({
  formulas: z.array(formulaSchema).max(500),
  otherFieldIds: z.array(z.string().min(1).max(200)).max(500).optional(),
});

router.post(
  '/:projectId/forms-advanced/topo-sort',
  verifyAuth,
  validate(topoSortSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof topoSortSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const order = topologicalSortFields(body.formulas, body.otherFieldIds);
      return res.json({ order });
    } catch (err) {
      if (err instanceof AdvancedFieldError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      logger.error?.('formBuilderAdvanced.topoSort.error', err);
      captureRouteError(err, 'formBuilderAdvanced.topoSort');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. evaluate-all-computed
// ────────────────────────────────────────────────────────────────────────

const evaluateAllSchema = z.object({
  formulas: z.array(formulaSchema).max(500),
  responses: z.array(responseSchema).max(500),
  now: z.string().min(10).optional(),
  otherFieldIds: z.array(z.string().min(1).max(200)).max(500).optional(),
});

router.post(
  '/:projectId/forms-advanced/evaluate-all-computed',
  verifyAuth,
  validate(evaluateAllSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof evaluateAllSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const values = evaluateAllComputed(body.formulas, body.responses, {
        now: body.now ? new Date(body.now) : undefined,
        otherFieldIds: body.otherFieldIds,
      });
      return res.json({ values });
    } catch (err) {
      if (err instanceof AdvancedFieldError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      logger.error?.('formBuilderAdvanced.evaluateAll.error', err);
      captureRouteError(err, 'formBuilderAdvanced.evaluateAll');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
