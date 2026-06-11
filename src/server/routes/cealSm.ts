// Praeventio Guard — CEAL-SM/SUSESO psychosocial risk surveillance HTTP
// surface (Protocolo de Vigilancia de Riesgos Psicosociales MINSAL oct.
// 2022, instrumento CEAL-SM/SUSESO obligatorio desde 2023-01-01).
//
// Endpoints (mounted under /api/sprint-k):
//   POST /:projectId/ceal-sm/campaigns               → create campaign (admin/prevencionista, audited)
//   GET  /:projectId/ceal-sm/campaigns               → list campaigns (member; counts only, no answers)
//   POST /:projectId/ceal-sm/campaigns/:id/respond   → submit response (member, anonymous-by-construction)
//   GET  /:projectId/ceal-sm/campaigns/:id/results   → k-gated center aggregates (member)
//
// ANONYMITY (constitutive — answers are WORKER responses about their
// employer; manual CEAL-SM §3.2.3/§3.2.4, Ley 19.628):
//   - Response docs NEVER persist `responderUid`. Doc id = responderHash =
//     HMAC-SHA256(pepper, domain:uid:campaignId).slice(0,32), same keyed
//     construction as culturePulse's pulseResponderHash but with its own
//     domain-separation label so the two instruments can never be
//     cross-correlated even with the same pepper. Idempotent per responder
//     (one response per worker per campaign) and non-recomputable off-server.
//   - No demographic fields are stored with the answers (v1 collects only
//     the 54 Sección II items — see cealSmDefinition.ts scope note).
//   - Aggregates are suppressed below CEAL_ANONYMITY_THRESHOLD (10)
//     responses: below that the manual would require signed informed consent
//     (manual §3.2.1.1) which this platform cannot verify.
//   - Raw responses are server-only: `ceal_sm_campaigns` (+ `responses`
//     subcollection) is default-denied for clients in firestore.rules.
//
// The verdict is ALWAYS computed server-side by the pure engine
// (src/services/protocols/cealSm.ts) from the stored anonymized answers —
// no client-supplied aggregate is ever trusted. Every state-changing write
// emits an audit_logs row (answers are NEVER included in audit details).

import { createHash, createHmac } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  evaluateCealSmCenter,
  validateCealAnswers,
  type CealAnswers,
} from '../../services/protocols/cealSm.js';
import { CEAL_ANONYMITY_THRESHOLD } from '../../services/protocols/cealSmDefinition.js';

const router = Router();

const CAMPAIGNS_COLLECTION = 'ceal_sm_campaigns';

// ── Guards ───────────────────────────────────────────────────────────────

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

// Campaign management is the prevencionista's job (the CdeA process owner);
// workers only respond. Mirrors culturePulse's role-resolution shape.
const CEAL_MANAGE_ROLES = new Set(['admin', 'prevencionista']);

function callerCanManageCampaigns(req: import('express').Request): boolean {
  const u = req.user;
  if (!u) return false;
  if (u.admin === true) return true;
  if (typeof u.role === 'string' && CEAL_MANAGE_ROLES.has(u.role)) return true;
  const tenants = (u as unknown as {
    tenants?: Record<string, { role?: string }>;
  }).tenants;
  if (tenants && typeof tenants === 'object' && typeof u.tenantId === 'string') {
    const t = tenants[u.tenantId];
    if (t && typeof t.role === 'string' && CEAL_MANAGE_ROLES.has(t.role)) {
      return true;
    }
  }
  return false;
}

// ── Responder hash (anonymity core) ──────────────────────────────────────

// Domain-separation label — distinct from culture-pulse so the same worker's
// hashes across the two instruments can never be joined. Bump :vN on any
// derivation change (re-keys all responder hashes; see culturePulse.ts for
// the migration trade-off discussion).
const CEAL_RESPONDER_HASH_DOMAIN = 'ceal-sm:responder:v1';

/**
 * Anonymizing, idempotent responder key. Same threat model and construction
 * as `pulseResponderHash` (src/server/routes/culturePulse.ts): HMAC keyed by
 * a server-only pepper (`CULTURE_PULSE_PEPPER`, else `SESSION_SECRET`) so an
 * insider with Firestore read + the uid roster cannot brute-force doc ids
 * back to identities. Unkeyed SHA-256 fallback exists only for test/dev
 * determinism (prod boot fails without SESSION_SECRET).
 *
 * Exported for direct assertion in cealSm.router.test.ts.
 */
export function cealResponderHash(uid: string, campaignId: string): string {
  const pepper =
    process.env.CULTURE_PULSE_PEPPER ?? process.env.SESSION_SECRET ?? '';
  if (pepper) {
    return createHmac('sha256', pepper)
      .update(`${CEAL_RESPONDER_HASH_DOMAIN}:${uid}:${campaignId}`)
      .digest('hex')
      .slice(0, 32);
  }
  // Legacy unkeyed path — test/dev only.
  return createHash('sha256')
    .update(`${CEAL_RESPONDER_HASH_DOMAIN}:${uid}:${campaignId}`)
    .digest('hex')
    .slice(0, 32);
}

// ── Stored shapes ────────────────────────────────────────────────────────

interface StoredCealCampaign {
  projectId: string;
  title: string;
  status: 'open' | 'closed';
  openAt: string;
  closeAt: string;
  /** Headcount of the centro de trabajo (participation denominator). */
  totalWorkers: number;
  createdAt: string;
  createdBy: string;
}

interface StoredCealResponse {
  responderHash: string;
  answers: CealAnswers;
  submittedAt: string;
}

function effectiveStatus(
  c: Pick<StoredCealCampaign, 'status' | 'openAt' | 'closeAt'>,
  nowIso: string,
): 'open' | 'closed' {
  return c.status === 'open' && c.openAt <= nowIso && nowIso < c.closeAt
    ? 'open'
    : 'closed';
}

// ── POST /:projectId/ceal-sm/campaigns ───────────────────────────────────

const createCampaignSchema = z
  .object({
    title: z.string().min(1).max(200),
    openAt: z.string().min(10).max(40),
    closeAt: z.string().min(10).max(40),
    totalWorkers: z.number().int().min(1).max(1_000_000),
  })
  .refine((v) => v.openAt < v.closeAt, {
    message: 'closeAt must be after openAt',
    path: ['closeAt'],
  });

router.post(
  '/:projectId/ceal-sm/campaigns',
  verifyAuth,
  validate(createCampaignSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId } = req.params;
    const body = req.body as z.infer<typeof createCampaignSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    if (!callerCanManageCampaigns(req)) {
      return res.status(403).json({
        error: 'forbidden_role',
        allowed: Array.from(CEAL_MANAGE_ROLES),
      });
    }
    try {
      const now = new Date().toISOString();
      const payload: StoredCealCampaign = {
        projectId,
        title: body.title,
        status: body.closeAt > now ? 'open' : 'closed',
        openAt: body.openAt,
        closeAt: body.closeAt,
        totalWorkers: body.totalWorkers,
        createdAt: now,
        createdBy: callerUid,
      };
      const ref = await admin
        .firestore()
        .collection(CAMPAIGNS_COLLECTION)
        .add(payload);
      // CLAUDE.md #3/#14: state-changing write → awaited audit row.
      await auditServerEvent(
        req,
        'cealSm.campaign_created',
        'cealSm',
        {
          campaignId: ref.id,
          title: body.title,
          totalWorkers: body.totalWorkers,
          openAt: body.openAt,
          closeAt: body.closeAt,
        },
        { projectId },
      );
      return res.status(201).json({ id: ref.id, campaign: payload });
    } catch (err) {
      logger.error?.('cealSm.createCampaign.error', err);
      captureRouteError(err, 'cealSm.createCampaign');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/ceal-sm/campaigns ────────────────────────────────────

router.get('/:projectId/ceal-sm/campaigns', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!(await guard(callerUid, projectId, res))) return undefined;
  try {
    const db = admin.firestore();
    const snap = await db
      .collection(CAMPAIGNS_COLLECTION)
      .where('projectId', '==', projectId)
      .limit(50)
      .get();
    const nowIso = new Date().toISOString();
    const campaigns = await Promise.all(
      snap.docs.map(async (doc) => {
        const c = doc.data() as StoredCealCampaign;
        // Counts are metadata (participation tracking), never answer content.
        const responsesSnap = await doc.ref.collection('responses').get();
        const responseCount = responsesSnap.size;
        const callerHash = cealResponderHash(callerUid, doc.id);
        const hasResponded = responsesSnap.docs.some(
          (r) => r.id === callerHash,
        );
        return {
          id: doc.id,
          title: c.title,
          status: effectiveStatus(c, nowIso),
          openAt: c.openAt,
          closeAt: c.closeAt,
          totalWorkers: c.totalWorkers,
          createdAt: c.createdAt,
          responseCount,
          participationRate:
            c.totalWorkers > 0
              ? Math.min(1, responseCount / c.totalWorkers)
              : null,
          hasResponded,
        };
      }),
    );
    campaigns.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return res.json({ campaigns });
  } catch (err) {
    logger.error?.('cealSm.listCampaigns.error', err);
    captureRouteError(err, 'cealSm.listCampaigns');
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── POST /:projectId/ceal-sm/campaigns/:id/respond ───────────────────────

// Shape-level gate; the engine's validateCealAnswers enforces the official
// per-item ranges (e.g. VU items are 1-4, the rest 0-4) and completeness.
const respondSchema = z.object({
  answers: z.record(
    z.string().min(2).max(8),
    z.number().int().min(0).max(4),
  ),
});

router.post(
  '/:projectId/ceal-sm/campaigns/:id/respond',
  verifyAuth,
  validate(respondSchema),
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id: campaignId } = req.params;
    const body = req.body as z.infer<typeof respondSchema>;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      try {
        validateCealAnswers(body.answers);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('CEAL-SM:')) {
          return res
            .status(400)
            .json({ error: 'validation_error', message: err.message });
        }
        throw err;
      }

      const db = admin.firestore();
      const campaignRef = db.collection(CAMPAIGNS_COLLECTION).doc(campaignId);
      const campaignSnap = await campaignRef.get();
      if (!campaignSnap.exists) {
        return res.status(404).json({ error: 'campaign_not_found' });
      }
      const campaign = campaignSnap.data() as StoredCealCampaign;
      // Tenant isolation: a campaign of another project is invisible (404,
      // not 403, to avoid existence disclosure).
      if (campaign.projectId !== projectId) {
        return res.status(404).json({ error: 'campaign_not_found' });
      }
      const now = new Date().toISOString();
      if (campaign.status === 'closed' || now >= campaign.closeAt) {
        return res.status(409).json({ error: 'campaign_closed' });
      }
      if (now < campaign.openAt) {
        return res.status(409).json({ error: 'campaign_not_open' });
      }

      const responderHash = cealResponderHash(callerUid, campaignId);
      const responseRef = campaignRef.collection('responses').doc(responderHash);
      const existing = await responseRef.get();
      if (existing.exists) {
        return res.status(409).json({ error: 'already_responded' });
      }

      const payload: StoredCealResponse = {
        responderHash,
        answers: body.answers,
        submittedAt: now,
      };
      await responseRef.set(payload);
      // Audit row WITHOUT answers and without any responder identifier
      // beyond the verified-token stamp the audit middleware applies — the
      // response doc itself never stores the uid (anonymity-by-construction).
      await auditServerEvent(
        req,
        'cealSm.response_submitted',
        'cealSm',
        { projectId, campaignId },
        { projectId },
      );
      return res.status(201).json({ ok: true });
    } catch (err) {
      logger.error?.('cealSm.respond.error', err);
      captureRouteError(err, 'cealSm.respond');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

// ── GET /:projectId/ceal-sm/campaigns/:id/results ────────────────────────

router.get(
  '/:projectId/ceal-sm/campaigns/:id/results',
  verifyAuth,
  async (req, res) => {
    const callerUid = req.user!.uid;
    const { projectId, id: campaignId } = req.params;
    if (!(await guard(callerUid, projectId, res))) return undefined;
    try {
      const db = admin.firestore();
      const campaignRef = db.collection(CAMPAIGNS_COLLECTION).doc(campaignId);
      const campaignSnap = await campaignRef.get();
      if (!campaignSnap.exists) {
        return res.status(404).json({ error: 'campaign_not_found' });
      }
      const campaign = campaignSnap.data() as StoredCealCampaign;
      if (campaign.projectId !== projectId) {
        return res.status(404).json({ error: 'campaign_not_found' });
      }

      const responsesSnap = await campaignRef.collection('responses').get();
      const responses = responsesSnap.docs.map(
        (d) => (d.data() as StoredCealResponse).answers,
      );
      const nowIso = new Date().toISOString();
      const meta = {
        campaignId,
        title: campaign.title,
        status: effectiveStatus(campaign, nowIso),
        openAt: campaign.openAt,
        closeAt: campaign.closeAt,
        totalWorkers: campaign.totalWorkers,
        totalResponses: responses.length,
        participationRate:
          campaign.totalWorkers > 0
            ? Math.min(1, responses.length / campaign.totalWorkers)
            : null,
      };

      // k-gate (manual §3.2.1.1): below the threshold NO aggregate leaves
      // the server — only existence metadata, mirroring culturePulse's
      // insufficientResponses contract.
      if (responses.length < CEAL_ANONYMITY_THRESHOLD) {
        return res.json({
          ...meta,
          insufficientResponses: true,
          threshold: CEAL_ANONYMITY_THRESHOLD,
          result: null,
        });
      }

      const result = evaluateCealSmCenter({
        responses,
        totalWorkers: campaign.totalWorkers,
      });
      return res.json({ ...meta, insufficientResponses: false, result });
    } catch (err) {
      logger.error?.('cealSm.results.error', err);
      captureRouteError(err, 'cealSm.results');
      return res.status(500).json({ error: 'internal_error' });
    }
  },
);

export default router;
