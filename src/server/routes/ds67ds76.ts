// Praeventio Guard — Sprint 31 Bucket PP.
//
// Express router for DS 67 (Reglamento Interno) + DS 76 (Reglamento
// Subcontratación Mining) PDF generation.
//
// Endpoints (all under /api/compliance):
//   POST /ds67                       — create DS-67 form (auth)
//   GET  /ds67/:formId/pdf           — fetch binary PDF (auth)
//   POST /ds67/:formId/sign          — attach WebAuthn signature (auth)
//   POST /ds76                       — create DS-76 form (auth)
//   GET  /ds76/:formId/pdf           — fetch binary PDF (auth)
//   POST /ds76/:formId/sign          — attach WebAuthn signature (auth)
//
// Adapters wrap admin.firestore() into the MinimalFolioStore /
// MinimalDsXXFormStore contracts so the service stays
// framework-agnostic and unit-testable without firebase-admin.

import { Router } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { validate } from '../middleware/validate.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import {
  createDs67Form,
  signForm as signDs67Form,
  ds67FolioToDocId,
  type MinimalDs67FormStore,
} from '../../services/compliance/ds67/ds67Service.js';
import {
  createDs76Form,
  signForm as signDs76Form,
  ds76FolioToDocId,
  type MinimalDs76FormStore,
} from '../../services/compliance/ds76/ds76Service.js';
import type { MinimalFolioStore } from '../../services/suseso/folioGenerator.js';
import type { Ds67Form, Ds67Signature } from '../../services/compliance/ds67/types.js';
import type { Ds76Form, Ds76Signature } from '../../services/compliance/ds76/types.js';
import { generateDs67Pdf } from '../../utils/ds67Certificate.js';
import { generateDs76Pdf } from '../../utils/ds76Certificate.js';

const router = Router();

// ─── Adapters wrapping admin.firestore() ────────────────────────────────────

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

function buildDs67FormStore(): MinimalDs67FormStore {
  const fs = admin.firestore();
  const formsPath = (tid: string) =>
    fs.collection('tenants').doc(tid).collection('ds67_forms');
  return {
    async saveForm(tenantId, formId, form) {
      await formsPath(tenantId).doc(formId).set(form);
    },
    async loadForm(tenantId, formId) {
      const snap = await formsPath(tenantId).doc(formId).get();
      return snap.exists ? (snap.data() as Ds67Form) : null;
    },
    async listVersions(tenantId) {
      const snap = await formsPath(tenantId).orderBy('createdAt', 'desc').get();
      return snap.docs.map((d) => d.data() as Ds67Form);
    },
    async attachSignature(tenantId, formId, signature) {
      const ref = formsPath(tenantId).doc(formId);
      await ref.update({ signature });
      const snap = await ref.get();
      return snap.data() as Ds67Form;
    },
  };
}

function buildDs76FormStore(): MinimalDs76FormStore {
  const fs = admin.firestore();
  const formsPath = (tid: string) =>
    fs.collection('tenants').doc(tid).collection('ds76_forms');
  return {
    async saveForm(tenantId, formId, form) {
      await formsPath(tenantId).doc(formId).set(form);
    },
    async loadForm(tenantId, formId) {
      const snap = await formsPath(tenantId).doc(formId).get();
      return snap.exists ? (snap.data() as Ds76Form) : null;
    },
    async listVersions(tenantId) {
      const snap = await formsPath(tenantId).orderBy('createdAt', 'desc').get();
      return snap.docs.map((d) => d.data() as Ds76Form);
    },
    async attachSignature(tenantId, formId, signature) {
      const ref = formsPath(tenantId).doc(formId);
      await ref.update({ signature });
      const snap = await ref.get();
      return snap.data() as Ds76Form;
    },
  };
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const ds67Schema = z.object({
  tenantId: z.string().min(1),
  companyName: z.string().min(1),
  companyRut: z.string().min(1),
  companyAddress: z.string().min(1),
  scopeOfApplication: z.string().min(1),
  workerObligations: z.array(z.string()).default([]),
  workerProhibitions: z.array(z.string()).default([]),
  sanctions: z.string().min(1),
  complaintProcedure: z.string().min(1),
  effectiveFrom: z.string().min(1),
  effectiveUntil: z.string().optional(),
});

const ds76Schema = z.object({
  tenantId: z.string().min(1),
  principalCompanyName: z.string().min(1),
  principalCompanyRut: z.string().min(1),
  contractorCompanyName: z.string().min(1),
  contractorCompanyRut: z.string().min(1),
  worksiteName: z.string().min(1),
  worksiteAddress: z.string().min(1),
  sstManagementPlan: z.string().min(1),
  managementSystemDescription: z.string().min(1),
  supervisionScheme: z.string().min(1),
  trainingItems: z
    .array(z.object({ topic: z.string(), hours: z.number().nonnegative() }))
    .default([]),
  susesoFiscalizationRecord: z.string().min(1),
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

// ─── DS 67 ──────────────────────────────────────────────────────────────────

router.post('/ds67', verifyAuth, validate(ds67Schema), async (req, res) => {
  const input = req.validated as z.infer<typeof ds67Schema>;
  try {
    const result = await createDs67Form(input, {
      folioStore: buildFolioStore(),
      formStore: buildDs67FormStore(),
    });
    try {
      void auditServerEvent(req, 'compliance.ds67_created', 'compliance', {
        folio: result.form.folio,
        tenantId: input.tenantId,
      });
    } catch {
      /* observability never breaks the response */
    }
    res.json({
      form: result.form,
      pdfBase64: Buffer.from(result.pdfBytes).toString('base64'),
      payloadHashHex: result.payloadHashHex,
    });
  } catch (err) {
    logger.error('ds67_create_failed', { err: String(err) });
    res.status(500).json({ error: 'ds67_create_failed' });
  }
});

router.get('/ds67/:formId/pdf', verifyAuth, async (req, res) => {
  const tenantId = (req.query.tenantId ?? '') as string;
  if (!tenantId) {
    return res.status(400).json({ error: 'tenantId required' });
  }
  try {
    const formStore = buildDs67FormStore();
    const form = await formStore.loadForm(tenantId, req.params.formId);
    if (!form) return res.status(404).json({ error: 'not_found' });
    const bytes = generateDs67Pdf(form);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${form.folio}.pdf"`,
    );
    res.end(Buffer.from(bytes));
  } catch (err) {
    logger.error('ds67_pdf_failed', { err: String(err) });
    res.status(500).json({ error: 'ds67_pdf_failed' });
  }
});

router.post(
  '/ds67/:formId/sign',
  verifyAuth,
  validate(signSchema),
  async (req, res) => {
    const { tenantId, signature } = req.validated as z.infer<typeof signSchema>;
    try {
      const updated = await signDs67Form(
        tenantId,
        req.params.formId,
        signature as Ds67Signature,
        { formStore: buildDs67FormStore() },
      );
      res.json({ form: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      res.status(400).json({ error: 'ds67_sign_failed', detail: msg });
    }
  },
);

// ─── DS 76 ──────────────────────────────────────────────────────────────────

router.post('/ds76', verifyAuth, validate(ds76Schema), async (req, res) => {
  const input = req.validated as z.infer<typeof ds76Schema>;
  try {
    const result = await createDs76Form(input, {
      folioStore: buildFolioStore(),
      formStore: buildDs76FormStore(),
    });
    try {
      void auditServerEvent(req, 'compliance.ds76_created', 'compliance', {
        folio: result.form.folio,
        tenantId: input.tenantId,
      });
    } catch {
      /* noop */
    }
    res.json({
      form: result.form,
      pdfBase64: Buffer.from(result.pdfBytes).toString('base64'),
      payloadHashHex: result.payloadHashHex,
    });
  } catch (err) {
    logger.error('ds76_create_failed', { err: String(err) });
    res.status(500).json({ error: 'ds76_create_failed' });
  }
});

router.get('/ds76/:formId/pdf', verifyAuth, async (req, res) => {
  const tenantId = (req.query.tenantId ?? '') as string;
  if (!tenantId) {
    return res.status(400).json({ error: 'tenantId required' });
  }
  try {
    const formStore = buildDs76FormStore();
    const form = await formStore.loadForm(tenantId, req.params.formId);
    if (!form) return res.status(404).json({ error: 'not_found' });
    const bytes = generateDs76Pdf(form);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${form.folio}.pdf"`,
    );
    res.end(Buffer.from(bytes));
  } catch (err) {
    logger.error('ds76_pdf_failed', { err: String(err) });
    res.status(500).json({ error: 'ds76_pdf_failed' });
  }
});

router.post(
  '/ds76/:formId/sign',
  verifyAuth,
  validate(signSchema),
  async (req, res) => {
    const { tenantId, signature } = req.validated as z.infer<typeof signSchema>;
    try {
      const updated = await signDs76Form(
        tenantId,
        req.params.formId,
        signature as Ds76Signature,
        { formStore: buildDs76FormStore() },
      );
      res.json({ form: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      res.status(400).json({ error: 'ds76_sign_failed', detail: msg });
    }
  },
);

// Re-export helpers used in test wiring.
export { ds67FolioToDocId, ds76FolioToDocId };
export default router;
