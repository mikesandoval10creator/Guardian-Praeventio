// Praeventio Guard — Consultative Sale Playbook HTTP surface.
//
// Sprint 52 §170: given a prospect context (industry / size / declared
// pains / jurisdiction / current solution / sales stage), produce a
// tailored sales playbook (priority modules to demo, next-stage
// discovery questions, anticipated objections, case studies, close
// probability estimate).
//
// 1 stateless endpoint over the engine under
// `src/services/consultativeSale/consultativeSalePlaybook.ts`:
//
//   POST /:projectId/sales/build-playbook
//     body: ProspectContext
//     200:  { playbook: SalePlaybook }
//
// Pure compute — no Firestore writes. Caller persists the playbook to
// their CRM/notes if desired.

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
  buildSalePlaybook,
  type ProspectContext,
} from '../../services/consultativeSale/consultativeSalePlaybook.js';

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

const INDUSTRIES = [
  'mining',
  'construction',
  'agriculture',
  'manufacturing',
  'energy',
  'transport',
  'services',
  'health',
  'education',
  'retail',
  'other',
] as const;

const COMPANY_SIZES = [
  'micro',
  'small',
  'medium',
  'large',
  'enterprise',
] as const;

const PAINS = [
  'manual_paperwork_heavy',
  'difficult_audit_prep',
  'high_incident_rate',
  'lack_visibility_field',
  'unclear_compliance_status',
  'training_compliance_gaps',
  'multi_site_coordination',
  'lone_worker_safety',
  'reactive_culture',
  'contractor_management',
  'mutual_reporting_burden',
  'budget_constraints',
  'regulatory_change_overload',
] as const;

const JURISDICTIONS = [
  'CL',
  'AR',
  'PE',
  'MX',
  'CO',
  'BR',
  'UK',
  'CA',
  'AU',
  'JP',
  'KR',
  'IN',
  'US',
  'EU',
] as const;

const CURRENT_SOLUTIONS = [
  'paper',
  'spreadsheets',
  'generic_saas',
  'competitor_a',
  'competitor_b',
  'in_house',
] as const;

const STAGES = [
  'discovery',
  'qualification',
  'demo',
  'proposal',
  'closing',
  'renewal',
] as const;

const prospectSchema = z.object({
  companyName: z.string().min(1).max(200),
  industry: z.enum(INDUSTRIES),
  size: z.enum(COMPANY_SIZES),
  workersCount: z.number().int().nonnegative().max(1_000_000),
  projectsActive: z.number().int().nonnegative().max(10_000).optional(),
  jurisdiction: z.enum(JURISDICTIONS),
  declaredPains: z.array(z.enum(PAINS)).max(50),
  currentSolution: z.enum(CURRENT_SOLUTIONS).optional(),
  stage: z.enum(STAGES),
}) as unknown as z.ZodType<ProspectContext>;

router.post(
  '/:projectId/sales/build-playbook',
  verifyAuth,
  validate(prospectSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as ProspectContext;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const playbook = buildSalePlaybook(body);
      return res.json({ playbook });
    } catch (err) {
      logger.error?.('consultativeSale.buildPlaybook.error', err);
      captureRouteError(err, 'consultativeSale.buildPlaybook');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
