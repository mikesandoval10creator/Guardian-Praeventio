// Praeventio Guard — Medical Catalogs lookup HTTP surface.
//
// Sprint 21 Bucket R + Fase 3.C — surface HTTP sobre los catálogos
// bundled en `src/data/medical/`:
//
//   POST /:projectId/medical-catalogs/diagnoses/search    (ICD-10 + DS 109)
//   POST /:projectId/medical-catalogs/drugs/search        (WHO ATC + DrugBank)
//   POST /:projectId/medical-catalogs/anatomy/search      (Wikipedia ES + DS 594)
//   POST /:projectId/medical-catalogs/diagnoses/by-risk-agent
//   POST /:projectId/medical-catalogs/anatomy/by-system
//   POST /:projectId/medical-catalogs/list-meta
//
// Pure lookup — sin LLM. Permite a UIs livianas (mobile, low-end)
// buscar contra los 50+ entries sin bundlearlos al cliente. Tampoco
// reemplaza juicio médico (ADR 0012). Las listas se acumulan en
// `data: AnatomyEntry[]` / `DrugEntry[]` / `DiagnosisEntry[]`.

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
  diagnoses,
  drugs,
  anatomy,
  diagnosesMeta,
  drugsMeta,
  anatomyMeta,
  type DiagnosisEntry,
  type DrugEntry,
  type AnatomyEntry,
} from '../../data/medical/index.js';

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

const MAX_RESULTS = 50;

function matchTerm(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

// ────────────────────────────────────────────────────────────────────────
// 1. diagnoses/search
// ────────────────────────────────────────────────────────────────────────

const diagnosesSearchSchema = z.object({
  query: z.string().min(1).max(200),
  occupationalOnly: z.boolean().optional(),
  limit: z.number().int().positive().max(MAX_RESULTS).optional(),
});

router.post(
  '/:projectId/medical-catalogs/diagnoses/search',
  verifyAuth,
  validate(diagnosesSearchSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof diagnosesSearchSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const limit = body.limit ?? 20;
      const matches: DiagnosisEntry[] = diagnoses
        .filter((d) => {
          if (body.occupationalOnly && !d.occupational) return false;
          return (
            matchTerm(d.name, body.query) ||
            matchTerm(d.code, body.query) ||
            matchTerm(d.category, body.query) ||
            matchTerm(d.description, body.query) ||
            d.riskAgents.some((a) => matchTerm(a, body.query))
          );
        })
        .slice(0, limit);
      return res.json({ results: matches, total: matches.length });
    } catch (err) {
      logger.error?.('medicalCatalogs.diagnoses.search.error', err);
      captureRouteError(err, 'medicalCatalogs.diagnoses.search');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 2. drugs/search
// ────────────────────────────────────────────────────────────────────────

const drugsSearchSchema = z.object({
  query: z.string().min(1).max(200),
  category: z.string().min(1).max(200).optional(),
  limit: z.number().int().positive().max(MAX_RESULTS).optional(),
});

router.post(
  '/:projectId/medical-catalogs/drugs/search',
  verifyAuth,
  validate(drugsSearchSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof drugsSearchSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const limit = body.limit ?? 20;
      const matches: DrugEntry[] = drugs
        .filter((d) => {
          if (body.category && d.category !== body.category) return false;
          return (
            matchTerm(d.name, body.query) ||
            matchTerm(d.atc, body.query) ||
            matchTerm(d.category, body.query) ||
            matchTerm(d.occupationalRelevance, body.query)
          );
        })
        .slice(0, limit);
      return res.json({ results: matches, total: matches.length });
    } catch (err) {
      logger.error?.('medicalCatalogs.drugs.search.error', err);
      captureRouteError(err, 'medicalCatalogs.drugs.search');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 3. anatomy/search
// ────────────────────────────────────────────────────────────────────────

const anatomySearchSchema = z.object({
  query: z.string().min(1).max(200),
  system: z.string().min(1).max(200).optional(),
  limit: z.number().int().positive().max(MAX_RESULTS).optional(),
});

router.post(
  '/:projectId/medical-catalogs/anatomy/search',
  verifyAuth,
  validate(anatomySearchSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof anatomySearchSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const limit = body.limit ?? 20;
      const matches: AnatomyEntry[] = anatomy
        .filter((a) => {
          if (body.system && a.system !== body.system) return false;
          return (
            matchTerm(a.name, body.query) ||
            matchTerm(a.system, body.query) ||
            matchTerm(a.description, body.query) ||
            a.occupationalRisks.some((r) => matchTerm(r, body.query)) ||
            a.commonInjuries.some((i) => matchTerm(i, body.query))
          );
        })
        .slice(0, limit);
      return res.json({ results: matches, total: matches.length });
    } catch (err) {
      logger.error?.('medicalCatalogs.anatomy.search.error', err);
      captureRouteError(err, 'medicalCatalogs.anatomy.search');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 4. diagnoses/by-risk-agent
// ────────────────────────────────────────────────────────────────────────

const byRiskAgentSchema = z.object({
  agent: z.string().min(1).max(200),
  limit: z.number().int().positive().max(MAX_RESULTS).optional(),
});

router.post(
  '/:projectId/medical-catalogs/diagnoses/by-risk-agent',
  verifyAuth,
  validate(byRiskAgentSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof byRiskAgentSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const limit = body.limit ?? 20;
      const matches: DiagnosisEntry[] = diagnoses
        .filter((d) =>
          d.riskAgents.some((a) => matchTerm(a, body.agent)),
        )
        .slice(0, limit);
      return res.json({ results: matches, total: matches.length });
    } catch (err) {
      logger.error?.('medicalCatalogs.diagnoses.byRiskAgent.error', err);
      captureRouteError(err, 'medicalCatalogs.diagnoses.byRiskAgent');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 5. anatomy/by-system
// ────────────────────────────────────────────────────────────────────────

const bySystemSchema = z.object({
  system: z.string().min(1).max(200),
  limit: z.number().int().positive().max(MAX_RESULTS).optional(),
});

router.post(
  '/:projectId/medical-catalogs/anatomy/by-system',
  verifyAuth,
  validate(bySystemSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof bySystemSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const limit = body.limit ?? MAX_RESULTS;
      const matches: AnatomyEntry[] = anatomy
        .filter((a) => a.system.toLowerCase() === body.system.toLowerCase())
        .slice(0, limit);
      return res.json({ results: matches, total: matches.length });
    } catch (err) {
      logger.error?.('medicalCatalogs.anatomy.bySystem.error', err);
      captureRouteError(err, 'medicalCatalogs.anatomy.bySystem');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ────────────────────────────────────────────────────────────────────────
// 6. list-meta  (catalog version, licenses, scope, disclaimer)
// ────────────────────────────────────────────────────────────────────────

router.post(
  '/:projectId/medical-catalogs/list-meta',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      return res.json({
        diagnoses: { meta: diagnosesMeta, count: diagnoses.length },
        drugs: { meta: drugsMeta, count: drugs.length },
        anatomy: { meta: anatomyMeta, count: anatomy.length },
      });
    } catch (err) {
      logger.error?.('medicalCatalogs.listMeta.error', err);
      captureRouteError(err, 'medicalCatalogs.listMeta');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
