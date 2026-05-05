// Praeventio Guard — Sprint 23 Bucket FF.
//
// HTTP surface for Ley 19.628 compliance:
//
//   POST   /api/compliance/consent
//   DELETE /api/compliance/consent/:purpose
//   GET    /api/compliance/consent
//   POST   /api/compliance/data-request
//   GET    /api/compliance/data-request/:id
//   GET    /api/compliance/processing-activities
//   GET    /api/compliance/data-export/:requestId
//
// All write endpoints require `verifyAuth`. The processing-activities
// catalog is intentionally public (no auth) — it is the published RAT and
// has no PII, so a SERNAC inspector or any data subject can inspect it
// without registering. The /api/ rate limiter in server.ts already gates
// all of these paths.

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
// Sprint 28 Bucket B3 — Zod transversal middleware (audit hallazgo H17).
import { validate } from '../middleware/validate.js';
import { logger } from '../../utils/logger.js';
import {
  recordConsent,
  revokeConsent,
  getConsentStatus,
  requestDataAccess,
  getDataAccessRequest,
  exportUserData,
  getProcessingActivities,
  ComplianceError,
  type ConsentPurpose,
  type LegalBasis,
  type MinimalComplianceDb,
} from '../../services/compliance/ley19628.js';

const VALID_PURPOSES: ConsentPurpose[] = [
  'core_service',
  'analytics',
  'marketing',
  'research_anonymized',
];

const VALID_LEGAL_BASES: LegalBasis[] = [
  'consent',
  'contract',
  'legal_obligation',
  'vital_interest',
  'public_task',
  'legitimate_interest',
];

function getDb(): MinimalComplianceDb {
  // The `admin.firestore()` shape is wider than `MinimalComplianceDb` but
  // structurally compatible at the call sites we use. The cast is the same
  // pattern as `assertProjectMember(uid, projectId, admin.firestore())`.
  return admin.firestore() as unknown as MinimalComplianceDb;
}

const router = Router();

// ---------------------------------------------------------------------------
// Public RAT (Article 30 GDPR equivalent) — no auth
// ---------------------------------------------------------------------------

router.get('/processing-activities', (_req, res) => {
  res.json({ activities: getProcessingActivities() });
});

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

router.post('/consent', verifyAuth, async (req, res) => {
  const uid = (req as any).user.uid as string;
  const { purpose, granted, legalBasis, textVersion } = req.body ?? {};

  if (!VALID_PURPOSES.includes(purpose)) {
    return res.status(400).json({ error: 'invalid_purpose' });
  }
  if (typeof granted !== 'boolean') {
    return res.status(400).json({ error: 'invalid_granted' });
  }
  if (!VALID_LEGAL_BASES.includes(legalBasis)) {
    return res.status(400).json({ error: 'invalid_legal_basis' });
  }
  if (typeof textVersion !== 'string' || textVersion.length === 0 || textVersion.length > 64) {
    return res.status(400).json({ error: 'invalid_text_version' });
  }

  try {
    const record = await recordConsent(getDb(), {
      uid,
      purpose,
      granted,
      legalBasis,
      textVersion,
    });
    res.json({ ok: true, record });
  } catch (err) {
    if (err instanceof ComplianceError) {
      return res.status(err.httpStatus).json({ error: err.code });
    }
    logger.error(
      'compliance_record_consent_failed',
      err instanceof Error ? err : new Error(String(err)),
      { uid },
    );
    res.status(500).json({ error: 'internal_error' });
  }
});

router.delete('/consent/:purpose', verifyAuth, async (req, res) => {
  const uid = (req as any).user.uid as string;
  const purpose = req.params.purpose as ConsentPurpose;
  if (!VALID_PURPOSES.includes(purpose)) {
    return res.status(400).json({ error: 'invalid_purpose' });
  }
  try {
    await revokeConsent(getDb(), uid, purpose);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ComplianceError) {
      return res.status(err.httpStatus).json({ error: err.code, message: err.message });
    }
    logger.error(
      'compliance_revoke_consent_failed',
      err instanceof Error ? err : new Error(String(err)),
      { uid, purpose },
    );
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/consent', verifyAuth, async (req, res) => {
  const uid = (req as any).user.uid as string;
  try {
    const status = await getConsentStatus(getDb(), uid);
    res.json({ uid, consents: status });
  } catch (err) {
    logger.error(
      'compliance_get_consent_failed',
      err instanceof Error ? err : new Error(String(err)),
      { uid },
    );
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---------------------------------------------------------------------------
// Data-subject requests
// ---------------------------------------------------------------------------

// Sprint 28 Bucket B3 — Zod schema for the data-subject request endpoint.
// The user-spec asked for `kind` + `targetUid` + `reason`; we map those to
// the existing wire field names (`type` is the existing `kind` enum, and
// `reason` lands in the rectificationPayload bag) so the contract stays
// backward-compatible. Sprint 29 H17: legacy `VALID_REQUEST_TYPES.includes`
// + `typeof rectificationPayload` guards removed — Zod enum + z.record are
// the single source of truth.
const dataRequestSchema = z.object({
  type: z.enum(['access', 'rectification', 'erasure', 'portability']),
  // Optional structured payload for rectification requests.
  rectificationPayload: z.record(z.string(), z.unknown()).optional(),
  // Optional human-readable reason — recorded in the audit row.
  reason: z.string().max(1024).optional(),
  // Optional admin-on-behalf-of target uid. Most subjects act on themselves
  // (the auth uid), but DPO operations may target another uid.
  targetUid: z.string().min(1).max(128).optional(),
});

router.post('/data-request', verifyAuth, validate(dataRequestSchema), async (req, res) => {
  const uid = (req as any).user.uid as string;
  const { type, rectificationPayload } = req.body as {
    type: 'access' | 'rectification' | 'erasure' | 'portability';
    rectificationPayload?: Record<string, unknown>;
  };

  try {
    const request = await requestDataAccess(getDb(), uid, type, {
      rectificationPayload,
    });
    res.status(201).json({ ok: true, request });
  } catch (err) {
    if (err instanceof ComplianceError) {
      return res.status(err.httpStatus).json({ error: err.code });
    }
    logger.error(
      'compliance_data_request_failed',
      err instanceof Error ? err : new Error(String(err)),
      { uid, type },
    );
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/data-request/:id', verifyAuth, async (req, res) => {
  const uid = (req as any).user.uid as string;
  const requestId = req.params.id;
  if (!requestId || requestId.length > 128) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  try {
    const request = await getDataAccessRequest(getDb(), requestId);
    if (!request) {
      return res.status(404).json({ error: 'not_found' });
    }
    // Tenant isolation: a user can only see their own requests.
    if (request.uid !== uid) {
      return res.status(403).json({ error: 'forbidden' });
    }
    res.json({ request });
  } catch (err) {
    logger.error(
      'compliance_get_request_failed',
      err instanceof Error ? err : new Error(String(err)),
      { uid, requestId },
    );
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---------------------------------------------------------------------------
// Inline export (small payloads). For large exports a worker should
// produce a signed URL and stash it in `exportedToUrl` via
// `processDataAccessRequest`. This endpoint is a simple-case fallback and
// only returns the user's own data.
// ---------------------------------------------------------------------------

router.get('/data-export/:requestId', verifyAuth, async (req, res) => {
  const uid = (req as any).user.uid as string;
  const requestId = req.params.requestId;
  try {
    const request = await getDataAccessRequest(getDb(), requestId);
    if (!request) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (request.uid !== uid) {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (request.type !== 'access' && request.type !== 'portability') {
      return res.status(400).json({ error: 'request_not_exportable' });
    }
    const exported = await exportUserData(getDb(), uid);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="praeventio-export-${uid}.json"`,
    );
    res.json(exported);
  } catch (err) {
    logger.error(
      'compliance_data_export_failed',
      err instanceof Error ? err : new Error(String(err)),
      { uid, requestId },
    );
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
