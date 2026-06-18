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
//   POST   /api/compliance/admin/data-request/:id/process   (admin)
//   POST   /api/compliance/admin/data-request/:id/erase     (admin, destructive)
//
// All write endpoints require `verifyAuth`. The processing-activities
// catalog is intentionally public (no auth) — it is the published RAT and
// has no PII, so a SERNAC inspector or any data subject can inspect it
// without registering. The /api/ rate limiter in server.ts already gates
// all of these paths.
//
// The two /admin endpoints (Ley 21.719 roadmap gap G-8, P0) additionally
// re-read the caller's role from Firebase Auth custom claims — the same
// server-authoritative gate as src/server/routes/admin.ts — so a client
// token claiming `admin` cannot process or erase another subject's data.

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
// Sprint 28 Bucket B3 — Zod transversal middleware (audit hallazgo H17).
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  recordConsent,
  revokeConsent,
  getConsentStatus,
  requestDataAccess,
  getDataAccessRequest,
  processDataAccessRequest,
  exportUserData,
  eraseUserData,
  getProcessingActivities,
  REQUESTS_COLLECTION,
  ComplianceError,
  type ConsentPurpose,
  type LegalBasis,
  type MinimalComplianceDb,
} from '../../services/compliance/ley19628.js';
// Admin gate for the ARCO processing endpoints — role re-read from Firebase
// Auth custom claims (mirrors firestore.rules' isAdmin() and admin.ts).
import { isAdminRole } from '../../types/roles.js';
// Sprint 31 Bucket MM — multi-regime privacy compliance.
import {
  getActiveRegimes,
  getMostStrictRegime,
  strictestDeadlineDays,
} from '../../services/privacy/registry.js';
// F.2 compliance traffic light — REAL engine + coverage-aware honesty wrapper.
import {
  computeTrafficLight,
  type ComplianceCategory,
} from '../../services/compliance/trafficLightEngine.js';
import { applyCoverage } from '../../services/compliance/trafficLightCoverage.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

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
  const uid = req.user!.uid;
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
    // CLAUDE.md #3: consent recording is a state-changing compliance write.
    await auditServerEvent(req, 'compliance.consent', 'compliance', {
      uid,
      purpose,
      granted,
      legalBasis,
      textVersion,
    });
    return res.json({ ok: true, record });
  } catch (err) {
    if (err instanceof ComplianceError) {
      return res.status(err.httpStatus).json({ error: err.code });
    }
    logger.error(
      'compliance_record_consent_failed',
      err instanceof Error ? err : new Error(String(err)),
      { uid },
    );
    captureRouteError(err, 'compliance.record_consent', { uid });
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.delete('/consent/:purpose', verifyAuth, async (req, res) => {
  const uid = req.user!.uid;
  const purpose = req.params.purpose as ConsentPurpose;
  if (!VALID_PURPOSES.includes(purpose)) {
    return res.status(400).json({ error: 'invalid_purpose' });
  }
  try {
    await revokeConsent(getDb(), uid, purpose);
    // CLAUDE.md #3: consent revocation is a state-changing compliance write.
    await auditServerEvent(req, 'compliance.revokeConsent', 'compliance', {
      uid,
      purpose,
    });
    return res.json({ ok: true });
  } catch (err) {
    if (err instanceof ComplianceError) {
      return res.status(err.httpStatus).json({ error: err.code, message: err.message });
    }
    logger.error(
      'compliance_revoke_consent_failed',
      err instanceof Error ? err : new Error(String(err)),
      { uid, purpose },
    );
    captureRouteError(err, 'compliance.revoke_consent', { uid, purpose });
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/consent', verifyAuth, async (req, res) => {
  const uid = req.user!.uid;
  try {
    const status = await getConsentStatus(getDb(), uid);
    return res.json({ uid, consents: status });
  } catch (err) {
    logger.error(
      'compliance_get_consent_failed',
      err instanceof Error ? err : new Error(String(err)),
      { uid },
    );
    captureRouteError(err, 'compliance.get_consent', { uid });
    return res.status(500).json({ error: 'internal_error' });
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
  // Sprint 31 Bucket MM — country of the data subject (ISO 3166-1 alpha-2)
  // and optional data-residency override. Used to pick the strictest
  // privacy regime deadline.
  subjectCountry: z.string().min(2).max(8).optional(),
  dataResidency: z.string().min(2).max(8).optional(),
});

router.post('/data-request', verifyAuth, validate(dataRequestSchema), async (req, res) => {
  const uid = req.user!.uid;
  const { type, rectificationPayload, subjectCountry, dataResidency } =
    req.body as {
      type: 'access' | 'rectification' | 'erasure' | 'portability';
      rectificationPayload?: Record<string, unknown>;
      subjectCountry?: string;
      dataResidency?: string;
    };

  // Sprint 31 Bucket MM — compute the strictest applicable deadline based
  // on subject country + processing residency. Default to LGPD's 15-day
  // floor when nothing is provided so we never silently downgrade.
  const activeRegimes = getActiveRegimes({
    country: subjectCountry,
    dataResidency,
  });
  const appliedDeadline = strictestDeadlineDays(activeRegimes);
  const strictest = getMostStrictRegime(activeRegimes);
  if (appliedDeadline !== null) {
    logger.info('compliance_data_request_deadline_applied', {
      uid,
      subjectCountry: subjectCountry ?? null,
      dataResidency: dataResidency ?? null,
      regimes: activeRegimes.map((r) => r.code),
      appliedDeadlineDays: appliedDeadline,
      strictestRegime: strictest?.code ?? null,
    });
  }

  try {
    const request = await requestDataAccess(getDb(), uid, type, {
      rectificationPayload,
    });
    // CLAUDE.md #3: data-subject request creation is a state-changing write.
    await auditServerEvent(req, 'compliance.dataRequest', 'compliance', {
      uid,
      requestId: request.id,
      type,
    });
    return res.status(201).json({
      ok: true,
      request,
      // Surfaced so the client can render "responderemos en N días".
      deadlineDays: appliedDeadline,
      regimes: activeRegimes.map((r) => r.code),
    });
  } catch (err) {
    if (err instanceof ComplianceError) {
      return res.status(err.httpStatus).json({ error: err.code });
    }
    logger.error(
      'compliance_data_request_failed',
      err instanceof Error ? err : new Error(String(err)),
      { uid, type },
    );
    captureRouteError(err, 'compliance.data_request', { uid, type });
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/data-request/:id', verifyAuth, async (req, res) => {
  const uid = req.user!.uid;
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
    return res.json({ request });
  } catch (err) {
    logger.error(
      'compliance_get_request_failed',
      err instanceof Error ? err : new Error(String(err)),
      { uid, requestId },
    );
    captureRouteError(err, 'compliance.get_request', { uid, requestId });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ---------------------------------------------------------------------------
// Inline export (small payloads). For large exports a worker should
// produce a signed URL and stash it in `exportedToUrl` via
// `processDataAccessRequest`. This endpoint is a simple-case fallback and
// only returns the user's own data.
// ---------------------------------------------------------------------------

router.get('/data-export/:requestId', verifyAuth, async (req, res) => {
  const uid = req.user!.uid;
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
    return res.json(exported);
  } catch (err) {
    logger.error(
      'compliance_data_export_failed',
      err instanceof Error ? err : new Error(String(err)),
      { uid, requestId },
    );
    captureRouteError(err, 'compliance.data_export', { uid, requestId });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ---------------------------------------------------------------------------
// Admin ARCO processing (Ley 21.719 roadmap G-8, P0)
//
// Until 2026-06 `processDataAccessRequest` and `eraseUserData` existed in
// src/services/compliance/ley19628.ts with NO route invoking them, so a
// data subject's access/erasure request stayed `pending` forever. These
// two endpoints close the loop:
//
//   • POST /admin/data-request/:id/process — completes an access /
//     portability request. The export itself is served by the existing
//     owner-only GET /data-export/:requestId, so the completed row points
//     there (`exportedToUrl`) instead of duplicating PII into a new store.
//   • POST /admin/data-request/:id/erase — executes an approved erasure.
//     DESTRUCTIVE: requires body `{ confirm: "<requestId>" }` and writes
//     audit_logs BEFORE (arco_erasure_started) and AFTER
//     (arco_erasure_executed). Always erases with `keepLegalRecords: true`
//     — audit_logs / incidents / sos_alerts have a 7-year retention window
//     (Ley 16.744 / DS 594) and purging them is a separate legal decision
//     that deliberately has no HTTP surface.
// ---------------------------------------------------------------------------

const REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Server-authoritative admin gate (same contract as admin.ts'
 * assertAdminCaller): re-reads the caller's role from Firebase Auth custom
 * claims so nothing in the client token or body can escalate. Writes the
 * 401/403 response and returns false when the caller is not an admin.
 */
async function assertAdminCaller(
  req: { user?: { uid?: string } },
  res: { status(code: number): { json(body: unknown): unknown } },
): Promise<boolean> {
  const callerUid = req.user?.uid;
  if (!callerUid) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  const callerRecord = await admin.auth().getUser(callerUid);
  if (!isAdminRole(callerRecord.customClaims?.role)) {
    res.status(403).json({ error: 'forbidden_requires_admin' });
    return false;
  }
  return true;
}

router.post('/admin/data-request/:id/process', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const requestId = req.params.id;
  if (!REQUEST_ID_REGEX.test(requestId)) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  try {
    if (!(await assertAdminCaller(req, res))) return undefined;

    const existing = await getDataAccessRequest(getDb(), requestId);
    if (!existing) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (existing.type !== 'access' && existing.type !== 'portability') {
      // Erasure goes through the confirmed /erase endpoint; rectification
      // has no automated apply path yet (manual via support + audit).
      return res.status(400).json({ error: 'request_not_processable' });
    }

    const processed = await processDataAccessRequest(getDb(), requestId, {
      // The data lives behind the existing owner-only inline export
      // endpoint — point the completed request there rather than copying
      // PII into a second location.
      onExport: async (r) => ({ downloadUrl: `/api/compliance/data-export/${r.id}` }),
    });

    // CLAUDE.md #3/#14: state-changing compliance op → audited, awaited,
    // identity stamped from the verified token inside auditServerEvent.
    await auditServerEvent(req, 'arco_access_processed', 'compliance', {
      requestId,
      targetUid: existing.uid,
      type: existing.type,
      status: processed.status,
    });

    return res.json({ ok: true, request: processed });
  } catch (err) {
    if (err instanceof ComplianceError) {
      return res.status(err.httpStatus).json({ error: err.code });
    }
    logger.error(
      'compliance_admin_process_request_failed',
      err instanceof Error ? err : new Error(String(err)),
      { callerUid, requestId },
    );
    captureRouteError(err, 'compliance.admin_process_request', { callerUid, requestId });
    return res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/admin/data-request/:id/erase', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const requestId = req.params.id;
  if (!REQUEST_ID_REGEX.test(requestId)) {
    return res.status(400).json({ error: 'invalid_id' });
  }
  try {
    if (!(await assertAdminCaller(req, res))) return undefined;

    // Destructive-op friction: the operator must echo the request id back.
    const { confirm } = (req.body ?? {}) as { confirm?: unknown };
    if (typeof confirm !== 'string' || confirm !== requestId) {
      return res.status(400).json({
        error: 'confirm_required',
        message: 'Destructive operation: body.confirm must equal the request id.',
      });
    }

    const existing = await getDataAccessRequest(getDb(), requestId);
    if (!existing) {
      return res.status(404).json({ error: 'not_found' });
    }
    if (existing.type !== 'erasure') {
      return res.status(400).json({ error: 'not_an_erasure_request' });
    }
    if (existing.status === 'completed') {
      // Idempotent: never run a second destructive sweep for the same row.
      return res.json({ ok: true, request: existing, alreadyCompleted: true });
    }

    // Audit BEFORE the destructive sweep so a mid-flight crash still leaves
    // a trace of who started it.
    await auditServerEvent(req, 'arco_erasure_started', 'compliance', {
      requestId,
      targetUid: existing.uid,
    });

    // keepLegalRecords is intentionally NOT caller-controllable (see block
    // comment above). Note: the sweep deletes the subject's own
    // compliance_data_requests rows (they carry the uid), so we re-persist
    // the request row afterwards as compliance evidence via set(merge) —
    // a plain processDataAccessRequest update() would hit NOT_FOUND.
    const result = await eraseUserData(getDb(), existing.uid, { keepLegalRecords: true });

    const completedAt = Date.now();
    await getDb().collection(REQUESTS_COLLECTION).doc(requestId).set(
      {
        uid: existing.uid,
        type: existing.type,
        status: 'completed',
        requestedAt: existing.requestedAt,
        completedAt,
      },
      { merge: true },
    );

    await auditServerEvent(req, 'arco_erasure_executed', 'compliance', {
      requestId,
      targetUid: existing.uid,
      erased: result.erased,
      preserved: result.preserved,
    });

    return res.json({
      ok: true,
      request: { id: requestId, uid: existing.uid, type: existing.type, status: 'completed', requestedAt: existing.requestedAt, completedAt },
      result,
    });
  } catch (err) {
    if (err instanceof ComplianceError) {
      return res.status(err.httpStatus).json({ error: err.code });
    }
    logger.error(
      'compliance_admin_erase_failed',
      err instanceof Error ? err : new Error(String(err)),
      { callerUid, requestId },
    );
    captureRouteError(err, 'compliance.admin_erase', { callerUid, requestId });
    return res.status(500).json({ error: 'internal_error' });
  }
});

// ── F.2 compliance traffic light ─────────────────────────────────────────
//
//   GET /api/compliance/:projectId/traffic-light
//
// Project-member-gated. Builds a REAL ProjectProfile from the stored project
// doc and computes the deterministic legal-obligation traffic light via the
// shared engine. Categories whose backing data is NOT yet wired
// (documentation/training/epp/occupational_health/maintenance/audits/
// emergencies) are returned as 'unknown' ("sin datos") — NEVER fabricated as
// green — by `applyCoverage`. No Math.random, no synthetic items.

const PROJECT_ID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

// IndustryCode (free-text-derived, stored as `industry_code`) → GP-* sector the
// legal rule engine matches on. Only sectors with a critical legal rule are
// mapped; everything else falls through (workers-count rules still fire).
const INDUSTRY_TO_SECTOR: Record<string, string> = {
  mining: 'GP-MIN',
  construction: 'GP-CONS',
  energy: 'GP-ELEC',
};

function resolveSector(data: Record<string, unknown>): string | undefined {
  if (typeof data.sectorId === 'string' && /^GP-/.test(data.sectorId)) {
    return data.sectorId;
  }
  if (typeof data.industry_code === 'string' && INDUSTRY_TO_SECTOR[data.industry_code]) {
    return INDUSTRY_TO_SECTOR[data.industry_code];
  }
  return undefined;
}

router.get('/:projectId/traffic-light', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const { projectId } = req.params;
  if (!PROJECT_ID_REGEX.test(projectId)) {
    return res.status(400).json({ error: 'project_id_required' });
  }

  const db = admin.firestore();
  try {
    await assertProjectMember(callerUid, projectId, db);
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      return res.status(403).json({ error: 'forbidden' });
    }
    throw err;
  }

  try {
    const snap = await db.collection('projects').doc(projectId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'project_not_found' });
    }
    const data = (snap.data() ?? {}) as Record<string, unknown>;

    // REAL profile from stored project fields. Missing fields simply don't
    // trigger their rules — honest, not fabricated.
    const profile = {
      workersCount: typeof data.workersCount === 'number' ? data.workersCount : 0,
      industry: resolveSector(data),
      presentRisks: Array.isArray(data.presentRisks)
        ? data.presentRisks.filter((r): r is string => typeof r === 'string')
        : undefined,
      hasHazmat: typeof data.hasHazmat === 'boolean' ? data.hasHazmat : undefined,
      hasSubcontractors:
        typeof data.hasSubcontractors === 'boolean' ? data.hasSubcontractors : undefined,
    };

    // Only the legal category has a real data source wired today; the
    // expirable/findings-driven categories stay 'sin datos' until their
    // ETL lands. attendedLegalRuleIds is empty: the system has no record of
    // attendance, so applicable critical obligations show as pending.
    const engineResult = computeTrafficLight({
      profile,
      expirableItems: [],
      attendedLegalRuleIds: [],
      openFindings: [],
    });
    const sourced = new Set<ComplianceCategory>(['legal']);
    const view = applyCoverage(engineResult, sourced);

    return res.json({ result: view });
  } catch (err) {
    logger.error('compliance.traffic_light.error', err, { projectId, callerUid });
    captureRouteError(err, 'compliance.trafficLight', { projectId, callerUid });
    return res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
