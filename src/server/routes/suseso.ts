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
import { captureRouteError } from '../middleware/captureRouteError.js';
import { susesoVerifyLimiter } from '../middleware/limiters.js';
import { callerTenantOr403 } from '../auth/callerTenant.js';
import { callerHasRegulatoryRole } from '../auth/regulatoryRole.js';
import { getWebauthnExpectedOrigin, getWebauthnRpId } from '../auth/rpId.js';
import { logger } from '../../utils/logger.js';
import {
  createSusesoForm,
  signForm,
  verifyFolio,
  submitToMutualidad,
  folioToDocId,
  renderSusesoUnsignedPayload,
  type MinimalFormStore,
} from '../../services/suseso/susesoService.js';
import type { MinimalFolioStore } from '../../services/suseso/folioGenerator.js';
import type { SusesoForm, SusesoSignature } from '../../services/suseso/types.js';
import {
  ComplianceSigningFlowError,
  completeComplianceWebAuthnSigning,
  issueComplianceWebAuthnChallenge,
  type ComplianceSigningDocuments,
} from '../services/complianceWebAuthnSigning.js';
import {
  ComplianceSignerIdentityError,
  resolveHumanComplianceSigner,
} from '../services/complianceSignerIdentity.js';
import {
  generateWebAuthnChallenge,
  storeWebAuthnChallenge,
} from '../../services/auth/webauthnChallenge.js';
import {
  attachComplianceSignatureAtomically,
  persistComplianceDigestAtomically,
} from '../services/firestoreComplianceDocument.js';
import { findByCredentialId } from '../../services/auth/webauthnCredentialStore.js';
import { getComplianceKmsPublicKey } from '../../services/compliance/cloudKmsComplianceSigner.js';
import { verifyPersistedComplianceSignature } from '../services/complianceSignatureVerification.js';
import { attestComplianceEvidence } from '../services/complianceEvidenceAttestation.js';

const router = Router();

// â”€â”€â”€ Adapters wrapping admin.firestore() into our minimal contracts â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        .limit(2)
        .get();
      if (snap.empty) return null;
      if (snap.docs.length > 1) return { ambiguous: true };
      const doc = snap.docs[0];
      // Path: tenants/{tid}/suseso_forms/{formId}
      const tenantId = doc.ref.parent.parent?.id ?? '';
      return { tenantId, formId: doc.id, form: doc.data() as SusesoForm };
    },
    async attachSignature(tenantId, formId, signature) {
      const ref = formsPath(tenantId).doc(formId);
      return attachComplianceSignatureAtomically<SusesoForm, SusesoSignature>(
        fs,
        ref,
        signature,
      );
    },
  };
}

function buildSigningDocuments(tenantId: string, formId: string): ComplianceSigningDocuments {
  const fs = admin.firestore();
  const formStore = buildFormStore();
  return {
    loadForm: () => formStore.loadForm(tenantId, formId),
    renderUnsignedPayload: async (form) =>
      renderSusesoUnsignedPayload(form as SusesoForm),
    persistLegacyDigest: async (payloadHashHex, payloadRendererVersion) => {
      const ref = fs.collection('tenants').doc(tenantId).collection('suseso_forms').doc(formId);
      await persistComplianceDigestAtomically(fs, ref, payloadHashHex, payloadRendererVersion);
    },
  };
}

async function resolveRouteSigner(uid: string) {
  return resolveHumanComplianceSigner(uid, {
    async loadSignerProfile(profileUid) {
      const snap = await admin.firestore().collection('users').doc(profileUid).get();
      return snap.exists ? (snap.data() as Record<string, unknown>) : null;
    },
  });
}

function sendSigningError(res: Parameters<typeof callerTenantOr403>[1], err: unknown) {
  if (err instanceof ComplianceSignerIdentityError) {
    return res.status(422).json({ error: err.code });
  }
  if (err instanceof ComplianceSigningFlowError) {
    if (err.code === 'not_found') return res.status(404).json({ error: err.code });
    if (err.code === 'evidence_attestation_unavailable') {
      return res.status(503).json({ error: err.code });
    }
    if (err.code === 'webauthn_failed') {
      return res.status(401).json({ error: 'suseso_sign_webauthn_failed', reason: err.reason });
    }
    return res.status(409).json({ error: err.code });
  }
  const detail = err instanceof Error ? err.message : 'unknown';
  return res.status(400).json({ error: 'suseso_sign_failed', detail });
}

// â”€â”€â”€ Schemas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

const webauthnAssertionSchema = z.object({
  challengeId: z.string().min(1),
  credentialId: z.string().min(1),
  rawId: z.string().min(1),
  clientDataJSON: z.string().min(1),
  authenticatorData: z.string().min(1),
  signature: z.string().min(1),
  type: z.literal('public-key'),
  clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
}).strict();

const signSchema = z.object({
  tenantId: z.string().min(1),
  // 2026-05-15 (Regla #3): WebAuthn assertion completa. Cuando
  // algorithm === 'webauthn-ecdsa-p256', estos campos son obligatorios y
  // el server ejecuta la ceremonia end-to-end (challenge consume + crypto
  // verify + counter monotonicity). Sin esto, una signature WebAuthn
  // shape-valid se podía persistir sin validación criptográfica.
  webauthnAssertion: webauthnAssertionSchema,
}).strict();

const submitSchema = z.object({ tenantId: z.string().min(1) });

// â”€â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post('/form', verifyAuth, validate(createFormSchema), async (req, res) => {
  const validated = req.validated as z.infer<typeof createFormSchema>;
  // tenantId is authoritative from the verified token — never the body.
  const tenantId = callerTenantOr403(req, res, validated.tenantId);
  if (tenantId === null) return;
  // [P0][compliance] Tenant membership is not authorisation — creating a
  // regulatory filing requires a prevention/management role.
  if (!callerHasRegulatoryRole(req, res)) return;
  const input = { ...validated, tenantId };
  try {
    const result = await createSusesoForm(input, {
      folioStore: buildFolioStore(),
      formStore: buildFormStore(),
      // The verification URL is handed to someone holding a printed
      // document, so it has to stand on its own — absolute, not a path
      // that only resolves if you are already inside the app. Falls back
      // to the relative path when APP_BASE_URL is unset (dev).
      publicBaseUrl: process.env.APP_BASE_URL,
    });
    // P0 fix: Codex P2 3308579646 — auditServerEvent returns boolean,
    // never throws. Branch on the return; helper already logs failures.
    // Form is already persisted upstream by createSusesoForm, so we
    // never block the response.
    const auditOk = await auditServerEvent(req, 'suseso.form_created', 'suseso', {
      folio: result.form.folio,
      kind: result.form.kind,
      tenantId: input.tenantId,
    });
    if (!auditOk) {
      captureRouteError(new Error('audit_write_failed'), 'suseso.audit', {
        audit_event: 'suseso.form_created',
        folio: result.form.folio,
        tenantId: input.tenantId,
      });
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
    const { tenantId: bodyTenantId, webauthnAssertion } =
      req.validated as z.infer<typeof signSchema>;
    const tenantId = callerTenantOr403(req, res, bodyTenantId);
    if (tenantId === null) return;
    // [P0][compliance] Signing binds the company's name to the filing.
    if (!callerHasRegulatoryRole(req, res)) return;
    const callerUid = req.user!.uid;
    try {
      const signature = await completeComplianceWebAuthnSigning({
        uid: callerUid,
        tenantId,
        formId: req.params.id,
        documentKind: 'suseso',
        assertion: webauthnAssertion,
      }, {
        documents: buildSigningDocuments(tenantId, req.params.id),
        resolveSigner: resolveRouteSigner,
        verifyAssertion: async (validateMetadata) => {
          const { verifyWebAuthnAssertion } = await import('../auth/webauthnAssertion.js');
          const { buildWebAuthnDb, buildWebAuthnCredentialsDb } = await import('./curriculum.js');
          return verifyWebAuthnAssertion({
            uid: callerUid,
            ...webauthnAssertion,
            expectedOrigin: process.env.APP_BASE_URL ?? 'http://localhost:5173',
            expectedRpId: getWebauthnRpId(),
            challengesDb: buildWebAuthnDb(),
            credentialsDb: buildWebAuthnCredentialsDb(),
            challengeMetadataValidator: validateMetadata,
          });
        },
        attestEvidence: attestComplianceEvidence,
      });

      const updated = await signForm(
        tenantId,
        req.params.id,
        signature as SusesoSignature,
        { formStore: buildFormStore() },
      );
      // Codex P2 3308579646: branch on boolean return; helper logs internally.
      const auditOk = await auditServerEvent(req, 'suseso.form_signed', 'suseso', {
        folio: updated.folio,
        algorithm: signature.algorithm,
        webauthnVerified: true,
      });
      if (!auditOk) {
        captureRouteError(new Error('audit_write_failed'), 'suseso.audit', {
          audit_event: 'suseso.form_signed',
          folio: updated.folio,
        });
      }
      return res.json({ form: updated });
    } catch (err) {
      logger.warn('suseso_form_sign_failed', {
        formId: req.params.id,
        reason: err instanceof ComplianceSigningFlowError ? err.code : 'internal',
      });
      return sendSigningError(res, err);
    }
  },
);

// 2026-05-15 (Regla #3): endpoint nuevo para issuar challenge WebAuthn
// específicamente para firmar DIAT/DIEP. El challenge se ata al `formId`
// implícitamente porque el cliente debe pasar el mismo `challengeId` al
// llamar `/sign` después de la ceremonia biométrica.
router.get('/form/:id/sign-challenge', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const tenantId = callerTenantOr403(req, res, req.query.tenantId);
  if (tenantId === null) return;
  try {
    const { buildWebAuthnDb } = await import('./curriculum.js');
    const challengesDb = buildWebAuthnDb();
    const issued = await issueComplianceWebAuthnChallenge({
      uid: callerUid,
      tenantId,
      formId: req.params.id,
      documentKind: 'suseso',
    }, {
      documents: buildSigningDocuments(tenantId, req.params.id),
      resolveSigner: resolveRouteSigner,
      newChallengeId: () => generateWebAuthnChallenge().challengeId,
      storeChallenge: (uid, challengeId, challenge, options) =>
        storeWebAuthnChallenge(uid, challengeId, challenge, challengesDb, options),
      now: challengesDb.now,
    });
    res.json({
      challengeId: issued.challengeId,
      challenge: Buffer.from(issued.challenge).toString('base64'),
      formId: req.params.id,
      payloadHashHex: issued.intent.payloadHashHex,
      rpId: getWebauthnRpId(),
    });
  } catch (err) {
    logger.warn('suseso_sign_challenge_failed', {
      formId: req.params.id,
      reason: err instanceof ComplianceSigningFlowError ? err.code : 'internal',
    });
    if (
      err instanceof ComplianceSigningFlowError ||
      err instanceof ComplianceSignerIdentityError
    ) {
      sendSigningError(res, err);
    } else {
      res.status(500).json({ error: 'suseso_sign_challenge_failed' });
    }
  }
});

router.post(
  '/form/:id/submit',
  verifyAuth,
  validate(submitSchema),
  async (req, res) => {
    const { tenantId: bodyTenantId } = req.validated as z.infer<typeof submitSchema>;
    const tenantId = callerTenantOr403(req, res, bodyTenantId);
    if (tenantId === null) return;
    // [P0][compliance] Submitting sends the filing to the mutualidad.
    if (!callerHasRegulatoryRole(req, res)) return;
    try {
      const updated = await submitToMutualidad(tenantId, req.params.id, {
        formStore: buildFormStore(),
      });
      return res.json({ form: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return res.status(400).json({ error: 'suseso_submit_failed', detail: msg });
    }
  },
);

// Sprint 28 follow-up — empresa marks the form as submitted to the
// mutualidad portal. Stops reminder spam + flips the badge to the green
// "âœ“ Enviado por la empresa" pill. Role-gated to admin/gerente/supervisor
// since these are the project officers responsible for the submission.
router.post(
  '/forms/:formId/mark-submitted',
  verifyAuth,
  async (req, res) => {
    const formId = req.params.formId;
    // tenantId is authoritative from the verified token — never the body.
    const tenantId = callerTenantOr403(req, res, req.body?.tenantId);
    if (tenantId === null) return;
    const role: string | undefined = req.user?.role;
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
      // Codex P2 3308579646: branch on boolean return; helper logs internally.
      const auditOk = await auditServerEvent(req, 'suseso.form.marked_submitted', 'suseso', {
        tenantId,
        formId,
        markedAt: nowIso,
      });
      if (!auditOk) {
        captureRouteError(new Error('audit_write_failed'), 'suseso.audit', {
          audit_event: 'suseso.form.marked_submitted',
          tenantId,
          formId,
        });
      }
      return res.json({ ok: true, formId, submittedByCompanyAt: nowIso });
    } catch (err) {
      logger.error('suseso_mark_submitted_failed', { err: String(err) });
      return res.status(500).json({ error: 'mark_submitted_failed' });
    }
  },
);

// Sprint E backend debt 2026-05-16: el endpoint sigue público (regla de
// verificabilidad pública de DIAT/DIEP), pero ahora con limiter dedicado
// (30 req/min/IP). Bloquea enumeración secuencial de folios + DoS de
// reads Firestore sin afectar a fiscalizadores legítimos.
router.get('/verify/:folio', susesoVerifyLimiter, async (req, res) => {
  try {
    const result = await verifyFolio(req.params.folio, {
      formStore: buildFormStore(),
      verifySignature: async (input) => {
        const { buildWebAuthnCredentialsDb } = await import('./curriculum.js');
        return verifyPersistedComplianceSignature(input, {
          resolveWebAuthnCredential: async (credentialId) => {
            const stored = await findByCredentialId(
              credentialId,
              buildWebAuthnCredentialsDb(),
            );
            if (!stored) return null;
            return {
              uid: stored.uid,
              publicKeyB64: stored.credential.publicKey,
              origin: getWebauthnExpectedOrigin(),
              rpId: getWebauthnRpId(),
            };
          },
          resolveKmsPublicKey: async (keyVersion) =>
            getComplianceKmsPublicKey(keyVersion),
        });
      },
    });
    res.json(result);
  } catch (err) {
    logger.error('suseso_verify_failed', { err: String(err) });
    res.status(500).json({ valid: false, reason: 'verify_internal_error' });
  }
});

export default router;
