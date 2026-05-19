// Praeventio Guard — Protocols (IPER + PREXOR + TMERT) HTTP surface.
//
// Three stateless endpoints over engines under `src/services/protocols/`:
//
//   POST /:projectId/protocols/iper      { input }    → IperResult
//   POST /:projectId/protocols/prexor    { measurements } → PrexorResult
//   POST /:projectId/protocols/tmert     { input }    → TmertResult
//
// Pure compute — no Firestore writes. Canonical Chilean health protocols:
// - IPER 5×5 risk matrix (probability × severity)
// - PREXOR auditory exposure (DS 594 — exchange rate 3 dB)
// - TMERT musculoskeletal disorders (Protocolo MINSAL 2012)

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
  calculateIper,
  type IperInput,
} from '../../services/protocols/iper.js';
import {
  calculatePrexor,
  type PrexorMeasurement,
} from '../../services/protocols/prexor.js';
import {
  evaluateTmert,
  type TmertInput,
} from '../../services/protocols/tmert.js';

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

// ────────────────────────────────────────────────────────────────────────
// 1. iper
// ────────────────────────────────────────────────────────────────────────

const iperSchema = z.object({
  input: z.object({
    probability: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    severity: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
    controlEffectiveness: z.enum(['none', 'low', 'medium', 'high']).optional(),
  }) as unknown as z.ZodType<IperInput>,
});

router.post(
  '/:projectId/protocols/iper',
  verifyAuth,
  validate(iperSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof iperSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = calculateIper(body.input);
      return res.json({ result });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('IPER:')) {
        return res.status(400).json({ error: 'validation_error', message: err.message });
      }
      logger.error?.('protocols.iper.error', err);
      captureRouteError(err, 'protocols.iper');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. prexor
// ────────────────────────────────────────────────────────────────────────

const prexorSchema = z.object({
  measurements: z.array(z.object({
    durationHours: z.number().min(0).max(24),
    levelDbA: z.number().min(0).max(200),
  })).max(1000) as unknown as z.ZodType<PrexorMeasurement[]>,
});

router.post(
  '/:projectId/protocols/prexor',
  verifyAuth,
  validate(prexorSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof prexorSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = calculatePrexor(body.measurements);
      return res.json({ result });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('PREXOR:')) {
        return res.status(400).json({ error: 'validation_error', message: err.message });
      }
      logger.error?.('protocols.prexor.error', err);
      captureRouteError(err, 'protocols.prexor');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. tmert
// ────────────────────────────────────────────────────────────────────────

const tmertConditionsSchema = z.object({
  A: z.boolean(),
  B: z.boolean(),
  C: z.boolean(),
});

const tmertSchema = z.object({
  input: z.object({
    repetitividad: tmertConditionsSchema,
    fuerza: tmertConditionsSchema,
    posturaForzada: tmertConditionsSchema,
    otros: tmertConditionsSchema,
    exposureHoursPerDay: z.number().min(0).max(24),
  }) as unknown as z.ZodType<TmertInput>,
});

router.post(
  '/:projectId/protocols/tmert',
  verifyAuth,
  validate(tmertSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof tmertSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const result = evaluateTmert(body.input);
      return res.json({ result });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('TMERT:')) {
        return res.status(400).json({ error: 'validation_error', message: err.message });
      }
      logger.error?.('protocols.tmert.error', err);
      captureRouteError(err, 'protocols.tmert');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
