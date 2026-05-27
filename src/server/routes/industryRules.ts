// Praeventio Guard — Bloque 3.13 wire huérfanos: industryRules HTTP surface.
//
// Wires the deterministic preset engine at
// `src/services/industryRules/industryRuleEngine.ts` to HTTP. Mirrors the
// readReceipts + loneWorker + equipmentQr wire pattern: pure-compute
// endpoints over the engine, with project-membership gating and
// idempotency keys on mutators.
//
// Endpoints (declared so literal paths match BEFORE any dynamic
// segments — Express first-match-wins routing):
//   GET  /:projectId/industry/list                 — list available presets
//   POST /:projectId/industry/select               — build & return preset application for a prefix
//   GET  /:projectId/industry/applicable-norms     — applicable regulations for a prefix
//   GET  /:projectId/industry/required-epp         — base EPP for a prefix
//   GET  /:projectId/industry/typical-hazards      — typical risks for a prefix
//
// Founder directives:
//   • Idempotent: `select` re-applies the same preset deterministically.
//   • Never blocks the project; presets are "suggestions to apply", the
//     caller is the one who persists the resulting nodes/documents.
//   • No external organism is contacted — this is local knowledge.
//
// ADR 0019 (Google ecosystem foundation):
//   Membership is checked via `admin.firestore()` only. The preset engine
//   itself is in-memory and deterministic — no second backend.

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
  getIndustryPreset,
  listIndustryPresets,
  buildPresetApplication,
  type IndustryPreset,
  type PresetApplication,
} from '../../services/industryRules/industryRuleEngine.js';

const router = Router();

// ── Guard helper ──────────────────────────────────────────────────────

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

// ── Shared schemas ────────────────────────────────────────────────────
// Industry prefixes are short, uppercase tokens like "GP-MIN", "GP-CONS".
// Unknown prefixes are still accepted by the engine (fallback preset),
// so we only bound length / charset here.

const industryPrefixSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Z0-9-]+$/, 'industry prefix must match /^[A-Z0-9-]+$/');

// ────────────────────────────────────────────────────────────────────────
// 1. GET /:projectId/industry/list
// Returns the catalog of known industry presets (prefix + display label).
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/industry/list',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const presets = listIndustryPresets();
      return res.json({ presets });
    } catch (err) {
      logger.error?.('industryRules.list.error', err);
      captureRouteError(err, 'industryRules.list', { callerUid, projectId });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/industry/select
// Builds the full PresetApplication for an industry. Mutator semantics
// (carries Idempotency-Key) because the caller is expected to persist
// the resulting nodes/documents downstream. The engine itself is pure,
// so re-issuing the same request returns the same application.
// ────────────────────────────────────────────────────────────────────────

const selectSchema = z.object({
  industryPrefix: industryPrefixSchema,
});

router.post(
  '/:projectId/industry/select',
  verifyAuth,
  idempotencyKey(),
  validate(selectSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.validated as z.infer<typeof selectSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const application: PresetApplication = buildPresetApplication(
        projectId,
        body.industryPrefix,
      );
      const preset: IndustryPreset = getIndustryPreset(body.industryPrefix);
      return res.json({ application, preset });
    } catch (err) {
      logger.error?.('industryRules.select.error', err);
      captureRouteError(err, 'industryRules.select', {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. GET /:projectId/industry/applicable-norms?industryPrefix=GP-MIN
// Returns the list of applicable Chilean regulations for a given prefix
// (DS 132, DS 594, Ley 16.744, etc.). Pure read.
// ────────────────────────────────────────────────────────────────────────

function parsePrefixFromQuery(
  req: import('express').Request,
  res: import('express').Response,
): string | null {
  const raw = req.query.industryPrefix;
  if (typeof raw !== 'string') {
    res.status(400).json({ error: 'invalid_industry_prefix' });
    return null;
  }
  const parsed = industryPrefixSchema.safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_industry_prefix' });
    return null;
  }
  return parsed.data;
}

router.get(
  '/:projectId/industry/applicable-norms',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    const industryPrefix = parsePrefixFromQuery(req, res);
    if (industryPrefix === null) return undefined;
    try {
      const preset = getIndustryPreset(industryPrefix);
      return res.json({
        industryPrefix,
        applicableRegulations: preset.applicableRegulations,
        minsalProtocols: preset.minsalProtocols,
      });
    } catch (err) {
      logger.error?.('industryRules.applicableNorms.error', err);
      captureRouteError(err, 'industryRules.applicableNorms', {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. GET /:projectId/industry/required-epp?industryPrefix=GP-MIN
// Returns the base EPP catalogue for a given prefix.
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/industry/required-epp',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    const industryPrefix = parsePrefixFromQuery(req, res);
    if (industryPrefix === null) return undefined;
    try {
      const preset = getIndustryPreset(industryPrefix);
      return res.json({
        industryPrefix,
        baseEpp: preset.baseEpp,
      });
    } catch (err) {
      logger.error?.('industryRules.requiredEpp.error', err);
      captureRouteError(err, 'industryRules.requiredEpp', {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. GET /:projectId/industry/typical-hazards?industryPrefix=GP-MIN
// Returns the typical risks for a given prefix, plus the mandatory
// documents and trainings (read-only convenience for the wizard's
// "review" step).
// ────────────────────────────────────────────────────────────────────────

router.get(
  '/:projectId/industry/typical-hazards',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    const industryPrefix = parsePrefixFromQuery(req, res);
    if (industryPrefix === null) return undefined;
    try {
      const preset = getIndustryPreset(industryPrefix);
      return res.json({
        industryPrefix,
        label: preset.label,
        typicalRisks: preset.typicalRisks,
        mandatoryDocuments: preset.mandatoryDocuments,
        mandatoryTrainings: preset.mandatoryTrainings,
      });
    } catch (err) {
      logger.error?.('industryRules.typicalHazards.error', err);
      captureRouteError(err, 'industryRules.typicalHazards', {
        callerUid,
        projectId,
      });
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
