// Praeventio Guard — Sprint 28 Bucket B6.
//
// Express router for SUSESO DIAT/DIEP form generation.
//
// Endpoints:
//   POST /api/suseso/form                — create a form (auth required)
//   POST /api/suseso/form/:id/sign       — attach signature (auth required)
//   POST /api/suseso/form/:id/submit     — record mutualidad submission
//   GET  /api/suseso/verify/:folio       — public folio verification (no auth)
//
// Auth model: form-mutating endpoints require `verifyAuth` (Firebase ID
// token). The verify endpoint is INTENTIONALLY public — that's what the
// QR code on the printed PDF resolves to, and it returns no clinical data.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import {
  createSusesoForm,
  signForm,
  verifyFolio,
  submitToMutualidad,
  folioToDocId,
  type MinimalFormStore,
} from '../../services/suseso/susesoService.js';
import type { MinimalFolioStore } from '../../services/suseso/folioGenerator.js';
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

router.get('/verify/:folio', async (req, res) => {
  try {
    const result = await verifyFolio(req.params.folio, {
      formStore: buildFormStore(),
    });
    res.json(result);
  } catch (err) {
    logger.error('suseso_verify_failed', { err: String(err) });
    res.status(500).json({ valid: false, reason: 'verify_internal_error' });
  }
});

export default router;
