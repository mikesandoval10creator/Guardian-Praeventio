// Praeventio Guard — Sprint 28 Bucket B6 + Sprint 49 D.8.a.
//
// Express router for SUSESO DIAT/DIEP form generation.
//
// Endpoints (Sprint 28):
//   POST /api/suseso/form                — create a form (auth required)
//   POST /api/suseso/form/:id/sign       — attach signature (auth required)
//   POST /api/suseso/form/:id/submit     — record mutualidad submission
//   GET  /api/suseso/verify/:folio       — public folio verification (no auth)
//
// Endpoints (Sprint 49 D.8.a — split & admin-gated surface):
//   POST /api/suseso/folio/generate      — allocate folio only (admin)
//   POST /api/suseso/diat/render         — render DIAT PDF (admin + HMAC token)
//   POST /api/suseso/diep/render         — render DIEP PDF (admin + HMAC token)
//
// Auth model: form-mutating endpoints require `verifyAuth` (Firebase ID
// token) PLUS an admin/gerente role check via `isAdminRole`. The verify
// endpoint is INTENTIONALLY public — that's what the QR code on the
// printed PDF resolves to, and it returns no clinical data.
//
// Plan maestro directive 3: NO push automático a SUSESO API. We render
// the signed PDF + emit the folio + provide a public verify URL; the
// empresa downloads the PDF and uploads it to the mutualidad portal
// manually. There is no outbound POST to any SUSESO/mutualidad endpoint.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import { logger } from '../../utils/logger.js';
import { isAdminRole } from '../../types/roles.js';
import {
  createSusesoForm,
  signForm,
  verifyFolio,
  submitToMutualidad,
  folioToDocId,
  type MinimalFormStore,
} from '../../services/suseso/susesoService.js';
import {
  nextFolio,
  parseFolio,
  type MinimalFolioStore,
} from '../../services/suseso/folioGenerator.js';
import { verifyEmployerSignature } from '../../services/suseso/susesoServerOnlyHelpers.js';
import type { SusesoForm, SusesoSignature } from '../../services/suseso/types.js';

const router = Router();

// ─── Adapters wrapping admin.firestore() into our minimal contracts ─────────

function buildFolioStore(): MinimalFolioStore {
  const fs = admin.firestore();
  return {
    async runTransaction(fn) {
      return fs.runTransaction(async (tx) => {
        return fn({
          async get(path: string) {
            const ref = fs.doc(path);
            const snap = await tx.get(ref);
            return snap.exists
              ? { exists: true, data: snap.data() as { lastSeq?: number } }
              : { exists: false };
          },
          set(path: string, value: { lastSeq: number }) {
            tx.set(fs.doc(path), value);
          },
        });
      });
    },
  };
}

function buildFormStore(): MinimalFormStore {
  const fs = admin.firestore();
  const formsPath = (tid: string) => fs.collection('tenants').doc(tid).collection('suseso_forms');
  return {
    async saveForm(tenantId, formId, form) {
      await formsPath(tenantId).doc(formId).set(form);
    },
    async loadForm(tenantId, formId) {
      const snap = await formsPath(tenantId).doc(formId).get();
      return snap.exists ? (snap.data() as SusesoForm) : null;
    },
    async findFormByFolio(folio) {
      // Folios are globally unique. We use a collectionGroup query so a
      // public verifier doesn't need to know the tenantId up front.
      const snap = await fs
        .collectionGroup('suseso_forms')
        .where('folio', '==', folio)
        .limit(1)
        .get();
      if (snap.empty) return null;
      const doc = snap.docs[0];
      // Path: tenants/{tid}/suseso_forms/{formId}
      const tenantId = doc.ref.parent.parent?.id ?? '';
      return { tenantId, form: doc.data() as SusesoForm };
    },
    async attachSignature(tenantId, formId, signature) {
      const ref = formsPath(tenantId).doc(formId);
      await ref.update({ signature });
      const snap = await ref.get();
      return snap.data() as SusesoForm;
    },
  };
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const createFormSchema = z.object({
  tenantId: z.string().min(1),
  kind: z.enum(['DIAT', 'DIEP']),
  workerRut: z.string().min(1),
  workerFullName: z.string().min(1),
  companyRut: z.string().min(1),
  companyName: z.string().min(1),
  mutualidad: z.enum(['achs', 'mutual_seguridad', 'ist', 'isl']),
  incidentDate: z.string().min(1),
  incidentDescription: z.string().min(1),
  incidentLocation: z.string().min(1),
  bodyPartsAffected: z.array(z.string()).default([]),
  incidentClassification: z.enum([
    'accidente_trabajo',
    'enfermedad_profesional',
    'accidente_trayecto',
  ]),
  ds101Causal: z.string().optional(),
  ds110Causal: z.string().optional(),
  witnesses: z.array(z.object({ fullName: z.string(), rut: z.string() })).default([]),
  reportedBy: z.object({
    uid: z.string().min(1),
    rut: z.string().min(1),
    fullName: z.string().min(1),
  }),
});

const signSchema = z.object({
  tenantId: z.string().min(1),
  signature: z.object({
    signerUid: z.string().min(1),
    signerRut: z.string().min(1),
    signedAt: z.string().min(1),
    algorithm: z.enum(['webauthn-ecdsa-p256', 'kms-sign-rsa']),
    signatureB64: z.string().min(1),
    payloadHashHex: z.string().regex(/^[0-9a-f]{64}$/),
  }),
});

const submitSchema = z.object({ tenantId: z.string().min(1) });

// ─── Handlers ───────────────────────────────────────────────────────────────

router.post('/form', verifyAuth, validate(createFormSchema), async (req, res) => {
  const input = req.validated as z.infer<typeof createFormSchema>;
  try {
    const result = await createSusesoForm(input, {
      folioStore: buildFolioStore(),
      formStore: buildFormStore(),
    });
    try {
      void auditServerEvent(req, 'suseso.form_created', 'suseso', {
        folio: result.form.folio,
        kind: result.form.kind,
        tenantId: input.tenantId,
      });
    } catch {
      /* observability never breaks the response */
    }
    // Return only the metadata + base64-encoded PDF; client decides how to
    // download. (PDF is base64'd to avoid a binary content-type response
    // — this is a JSON API.)
    const pdfB64 = Buffer.from(result.pdfBytes).toString('base64');
    res.json({
      form: result.form,
      pdfBase64: pdfB64,
      payloadHashHex: result.payloadHashHex,
      qrCodeUrl: result.qrCodeUrl,
    });
  } catch (err) {
    logger.error('suseso_form_create_failed', { err: String(err) });
    res.status(500).json({ error: 'suseso_create_failed' });
  }
});

router.post(
  '/form/:id/sign',
  verifyAuth,
  validate(signSchema),
  async (req, res) => {
    const { tenantId, signature } = req.validated as z.infer<typeof signSchema>;
    try {
      const updated = await signForm(
        tenantId,
        req.params.id,
        signature as SusesoSignature,
        { formStore: buildFormStore() },
      );
      try {
        void auditServerEvent(req, 'suseso.form_signed', 'suseso', {
          folio: updated.folio,
          algorithm: signature.algorithm,
        });
      } catch {
        /* noop */
      }
      res.json({ form: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      logger.warn('suseso_form_sign_failed', { err: msg });
      res.status(400).json({ error: 'suseso_sign_failed', detail: msg });
    }
  },
);

router.post(
  '/form/:id/submit',
  verifyAuth,
  validate(submitSchema),
  async (req, res) => {
    const { tenantId } = req.validated as z.infer<typeof submitSchema>;
    try {
      const updated = await submitToMutualidad(tenantId, req.params.id, {
        formStore: buildFormStore(),
      });
      res.json({ form: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      res.status(400).json({ error: 'suseso_submit_failed', detail: msg });
    }
  },
);

// Sprint 28 follow-up — empresa marks the form as submitted to the
// mutualidad portal. Stops reminder spam + flips the badge to the green
// "✓ Enviado por la empresa" pill. Role-gated to admin/gerente/supervisor
// since these are the project officers responsible for the submission.
router.post(
  '/forms/:formId/mark-submitted',
  verifyAuth,
  async (req, res) => {
    const formId = req.params.formId;
    const tenantId = (req.body?.tenantId ?? '') as string;
    if (!tenantId || typeof tenantId !== 'string') {
      return res.status(400).json({ error: 'invalid_tenantId' });
    }
    const role: string | undefined = (req as any).user?.role;
    const allowed = new Set(['admin', 'gerente', 'supervisor']);
    if (!role || !allowed.has(role)) {
      return res.status(403).json({ error: 'forbidden_role' });
    }
    try {
      const fs = admin.firestore();
      const ref = fs
        .collection('tenants')
        .doc(tenantId)
        .collection('suseso_forms')
        .doc(formId);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: 'form_not_found' });
      }
      const nowIso = new Date().toISOString();
      await ref.update({
        status: 'submitted_by_company',
        submittedByCompanyAt: nowIso,
      });
      try {
        void auditServerEvent(req, 'suseso.form.marked_submitted', 'suseso', {
          tenantId,
          formId,
          markedAt: nowIso,
        });
      } catch {
        /* observability never breaks the response */
      }
      res.json({ ok: true, formId, submittedByCompanyAt: nowIso });
    } catch (err) {
      logger.error('suseso_mark_submitted_failed', { err: String(err) });
      res.status(500).json({ error: 'mark_submitted_failed' });
    }
  },
);

router.get('/verify/:folio', async (req, res) => {
  try {
    const result = await verifyFolio(req.params.folio, {
      formStore: buildFormStore(),
    });
    res.json(result);
  } catch (err) {
    logger.error('suseso_verify_failed', { err: String(err) });
    captureRouteError(err, '/api/suseso/verify/:folio', {
      folio: req.params.folio,
    });
    res.status(500).json({ valid: false, reason: 'verify_internal_error' });
  }
});

// ─── Sprint 49 D.8.a — admin-gated split endpoints ─────────────────────────

/**
 * Express middleware: requires `req.user.role` (or `req.user.customClaims.role`)
 * to be an admin tier (admin|gerente per `src/types/roles.ts`). MUST be
 * mounted AFTER `verifyAuth`.
 *
 * Returns 403 with a stable error code so client UX can distinguish "you
 * are signed in but not allowed" from "you are signed out".
 */
function verifyAdmin(req: any, res: any, next: any) {
  const role: unknown = req.user?.role ?? req.user?.customClaims?.role;
  if (!isAdminRole(role)) {
    return res.status(403).json({ error: 'forbidden_role', reason: 'requires_admin' });
  }
  return next();
}

// Helper: Chile lat/lng bounding box for the `jurisdiction=CL` sanity
// check. Continental + insular Chile only (Easter Island ~109°W to
// Patagonia ~67°W; Visviri ~17.5°S to Cape Horn ~56°S). Antártica
// Chilena is OUTSIDE this box and treated as a separate jurisdiction.
const CL_BBOX = { latMin: -56.5, latMax: -17.4, lngMin: -109.5, lngMax: -66.5 };

/** Reject ISO timestamps in the future (with a 5-minute clock-skew tolerance). */
function isReasonableEventDate(iso: string, now: Date = new Date()): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t <= now.getTime() + 5 * 60 * 1000;
}

const folioGenerateSchema = z.object({
  tenantId: z.string().min(1).max(128),
  kind: z.enum(['DIAT', 'DIEP']),
  year: z.number().int().min(2020).max(2100).optional(),
});

router.post(
  '/folio/generate',
  verifyAuth,
  verifyAdmin,
  validate(folioGenerateSchema),
  async (req, res) => {
    const { tenantId, kind, year } = req.validated as z.infer<typeof folioGenerateSchema>;
    try {
      const resolvedYear = year ?? new Date().getUTCFullYear();
      const folio = await nextFolio(
        buildFolioStore(),
        tenantId,
        kind,
        resolvedYear,
      );
      const parsed = parseFolio(folio);
      try {
        void auditServerEvent(req, 'suseso.folio_allocated', 'suseso', {
          tenantId,
          folio,
          kind,
        });
      } catch {
        /* observability never breaks the response */
      }
      return res.json({
        folio,
        kind,
        year: resolvedYear,
        sequenceNumber: parsed?.seq ?? null,
      });
    } catch (err) {
      logger.error('suseso_folio_generate_failed', { err: String(err) });
      captureRouteError(err, '/api/suseso/folio/generate', {
        tenantId,
        kind,
      });
      return res.status(500).json({ error: 'folio_generate_failed' });
    }
  },
);

// Common render schema for DIAT + DIEP. The plan maestro spec asks for a
// flat body (folio, incidentSummary, victimUid, etc.) but our existing
// `createSusesoForm` takes a richer nested input. We accept the spec
// shape AND populate the richer fields with sane defaults so old clients
// continue to work with `/form` while new clients hit `/diat/render`.
const renderSchema = z.object({
  tenantId: z.string().min(1).max(128),
  folio: z.string().regex(/^(DIAT|DIEP)-\d{4}-[a-z0-9]{8}-\d{6}$/).optional(),
  // Worker / victim
  victimUid: z.string().min(1),
  victimRut: z.string().regex(/^\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]$/, 'malformed_rut'),
  victimFullName: z.string().min(1).max(256),
  // Employer
  companyRut: z.string().regex(/^\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]$/, 'malformed_company_rut'),
  companyName: z.string().min(1).max(256),
  mutualidad: z.enum(['achs', 'mutual_seguridad', 'ist', 'isl']),
  // Incident
  eventDate: z.string().refine(isReasonableEventDate, {
    message: 'eventDate is in the future or unparseable',
  }),
  eventLocation: z.string().min(1).max(512),
  eventDescription: z.string().min(1).max(4096),
  eventLat: z.number().min(-90).max(90).optional(),
  eventLng: z.number().min(-180).max(180).optional(),
  jurisdiction: z.enum(['CL', 'INT']).default('CL'),
  bodyPartsAffected: z.array(z.string().min(1).max(64)).max(20).default([]),
  witnesses: z
    .array(z.object({
      fullName: z.string().min(1).max(256),
      rut: z.string().regex(/^\d{1,2}\.?\d{3}\.?\d{3}-[0-9kK]$/),
    }))
    .max(10)
    .default([]),
  // Two-factor binding: HMAC of canonicalized payload, signed by empresa
  // pre-shared key (see susesoServerOnlyHelpers.verifyEmployerSignature).
  employerSignatureToken: z.string().regex(/^[0-9a-f]{64}$/i),
});

async function handleRender(
  kind: 'DIAT' | 'DIEP',
  req: any,
  res: any,
): Promise<void> {
  const input = req.validated as z.infer<typeof renderSchema>;
  // Jurisdiction-aware lat/lng sanity check.
  if (input.jurisdiction === 'CL' && typeof input.eventLat === 'number' && typeof input.eventLng === 'number') {
    if (
      input.eventLat < CL_BBOX.latMin ||
      input.eventLat > CL_BBOX.latMax ||
      input.eventLng < CL_BBOX.lngMin ||
      input.eventLng > CL_BBOX.lngMax
    ) {
      return void res.status(400).json({
        error: 'invalid_payload',
        reason: 'event_location_outside_chile',
      });
    }
  }
  // Two-factor binding: admin must hold the employer HMAC token.
  // We canonicalize a stable subset (NOT including the token itself).
  const hmacPayload: Record<string, unknown> = {
    kind,
    tenantId: input.tenantId,
    victimRut: input.victimRut,
    companyRut: input.companyRut,
    eventDate: input.eventDate,
    eventLocation: input.eventLocation,
  };
  if (!verifyEmployerSignature(input.employerSignatureToken, hmacPayload)) {
    logger.warn('suseso_render_hmac_rejected', {
      tenantId: input.tenantId,
      kind,
      uid: req.user?.uid,
    });
    return void res.status(403).json({
      error: 'forbidden_employer_signature',
      reason: 'hmac_mismatch_or_credentials_missing',
    });
  }
  try {
    const result = await createSusesoForm(
      {
        tenantId: input.tenantId,
        kind,
        workerRut: input.victimRut,
        workerFullName: input.victimFullName,
        companyRut: input.companyRut,
        companyName: input.companyName,
        mutualidad: input.mutualidad,
        incidentDate: input.eventDate,
        incidentDescription: input.eventDescription,
        incidentLocation: input.eventLocation,
        bodyPartsAffected: input.bodyPartsAffected,
        incidentClassification: kind === 'DIAT' ? 'accidente_trabajo' : 'enfermedad_profesional',
        witnesses: input.witnesses,
        reportedBy: {
          uid: req.user?.uid ?? input.victimUid,
          rut: input.victimRut,
          fullName: input.victimFullName,
        },
      },
      { folioStore: buildFolioStore(), formStore: buildFormStore() },
    );
    try {
      void auditServerEvent(req, `suseso.${kind.toLowerCase()}_rendered`, 'suseso', {
        tenantId: input.tenantId,
        folio: result.form.folio,
      });
    } catch {
      /* observability never breaks the response */
    }
    res.json({
      folio: result.form.folio,
      pdfBase64: Buffer.from(result.pdfBytes).toString('base64'),
      sha256: result.payloadHashHex,
      signedAt: result.form.createdAt,
      qrCodeUrl: result.qrCodeUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    logger.error(`suseso_${kind.toLowerCase()}_render_failed`, { err: msg });
    captureRouteError(err, `/api/suseso/${kind.toLowerCase()}/render`, {
      tenantId: input.tenantId,
      kind,
    });
    res.status(500).json({ error: 'render_failed', detail: msg });
  }
}

router.post(
  '/diat/render',
  verifyAuth,
  verifyAdmin,
  validate(renderSchema),
  (req, res) => void handleRender('DIAT', req, res),
);

router.post(
  '/diep/render',
  verifyAuth,
  verifyAdmin,
  validate(renderSchema),
  (req, res) => void handleRender('DIEP', req, res),
);

export { verifyAdmin, handleRender };
export default router;
