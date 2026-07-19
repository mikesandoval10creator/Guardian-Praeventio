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
import { callerTenantOr403 } from '../auth/callerTenant.js';
import { callerHasRegulatoryRole } from '../auth/regulatoryRole.js';
import { getWebauthnRpId } from '../auth/rpId.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  createDs67Form,
  signForm as signDs67Form,
  ds67FolioToDocId,
  renderDs67UnsignedPayload,
  type MinimalDs67FormStore,
} from '../../services/compliance/ds67/ds67Service.js';
import {
  createDs76Form,
  signForm as signDs76Form,
  ds76FolioToDocId,
  renderDs76UnsignedPayload,
  type MinimalDs76FormStore,
} from '../../services/compliance/ds76/ds76Service.js';
import type { MinimalFolioStore } from '../../services/suseso/folioGenerator.js';
import type { Ds67Form, Ds67Signature } from '../../services/compliance/ds67/types.js';
import type { Ds76Form, Ds76Signature } from '../../services/compliance/ds76/types.js';
import { generateDs67Pdf } from '../../utils/ds67Certificate.js';
import { generateDs76Pdf } from '../../utils/ds76Certificate.js';
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
import { attestComplianceEvidence } from '../services/complianceEvidenceAttestation.js';
import {
  generateWebAuthnChallenge,
  storeWebAuthnChallenge,
} from '../../services/auth/webauthnChallenge.js';
import {
  attachComplianceSignatureAtomically,
  persistComplianceDigestAtomically,
} from '../services/firestoreComplianceDocument.js';

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
      return attachComplianceSignatureAtomically<Ds67Form, Ds67Signature>(
        fs,
        ref,
        signature,
      );
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
      return attachComplianceSignatureAtomically<Ds76Form, Ds76Signature>(
        fs,
        ref,
        signature,
      );
    },
  };
}

function buildDs67SigningDocuments(tenantId: string, formId: string): ComplianceSigningDocuments {
  const fs = admin.firestore();
  const formStore = buildDs67FormStore();
  return {
    loadForm: () => formStore.loadForm(tenantId, formId),
    renderUnsignedPayload: async (form) => renderDs67UnsignedPayload(form as Ds67Form),
    persistLegacyDigest: async (payloadHashHex, payloadRendererVersion) => {
      const ref = fs.collection('tenants').doc(tenantId).collection('ds67_forms').doc(formId);
      await persistComplianceDigestAtomically(fs, ref, payloadHashHex, payloadRendererVersion);
    },
  };
}

function buildDs76SigningDocuments(tenantId: string, formId: string): ComplianceSigningDocuments {
  const fs = admin.firestore();
  const formStore = buildDs76FormStore();
  return {
    loadForm: () => formStore.loadForm(tenantId, formId),
    renderUnsignedPayload: async (form) => renderDs76UnsignedPayload(form as Ds76Form),
    persistLegacyDigest: async (payloadHashHex, payloadRendererVersion) => {
      const ref = fs.collection('tenants').doc(tenantId).collection('ds76_forms').doc(formId);
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

function sendSigningError(
  res: Parameters<typeof callerTenantOr403>[1],
  err: unknown,
  documentKind: 'ds67' | 'ds76',
) {
  if (err instanceof ComplianceSignerIdentityError) {
    return res.status(422).json({ error: err.code });
  }
  if (err instanceof ComplianceSigningFlowError) {
    if (err.code === 'not_found') return res.status(404).json({ error: err.code });
    if (err.code === 'evidence_attestation_unavailable') {
      return res.status(503).json({ error: err.code });
    }
    if (err.code === 'webauthn_failed') {
      return res.status(401).json({
        error: `${documentKind}_sign_webauthn_failed`, reason: err.reason,
      });
    }
    return res.status(409).json({ error: err.code });
  }
  const detail = err instanceof Error ? err.message : 'unknown';
  return res.status(400).json({ error: `${documentKind}_sign_failed`, detail });
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
  // §2.9 (2026-06-01): full WebAuthn assertion. When
  // algorithm === 'webauthn-ecdsa-p256' these fields are REQUIRED and the
  // server runs the end-to-end ceremony (challenge consume + crypto verify +
  // counter monotonicity) before persisting. Previously a shape-valid
  // signatureB64 was persisted with NO cryptographic verification — any
  // authenticated user could POST an arbitrary base64 string. Mirrors the
  // hardened suseso.ts sign flow.
  webauthnAssertion: webauthnAssertionSchema,
}).strict();

// ─── DS 67 ──────────────────────────────────────────────────────────────────

router.post('/ds67', verifyAuth, validate(ds67Schema), async (req, res) => {
  const validated = req.validated as z.infer<typeof ds67Schema>;
  // tenantId is authoritative from the verified token — never the body (B5).
  const tenantId = callerTenantOr403(req, res, validated.tenantId);
  if (tenantId === null) return;
  // [P0][compliance] Tenant membership is not authorisation — creating a
  // regulatory filing requires a prevention/management role.
  if (!callerHasRegulatoryRole(req, res)) return;
  const input = { ...validated, tenantId };
  try {
    const result = await createDs67Form(input, {
      folioStore: buildFolioStore(),
      formStore: buildDs67FormStore(),
    });
    // P0 fix: previously this audit write was fire-and-forget (the promise was
    // discarded), so the response could ship before the row landed in
    // Firestore. For DS 67 / DS 76 that is a SUSESO audit-trail
    // gap risk. Now we `await` to guarantee the write attempt completes
    // before responding. Codex P2 3308579646: auditServerEvent catches its
    // own Firestore failures and resolves `false` (never rejects), so the
    // earlier try/catch never ran — we branch on the boolean return and
    // surface a Sentry breadcrumb so on-call sees the compliance gap (the
    // helper already logs to logger.error).
    const auditOk = await auditServerEvent(req, 'compliance.ds67_created', 'compliance', {
      folio: result.form.folio,
      tenantId: input.tenantId,
    });
    if (!auditOk) {
      captureRouteError(new Error('audit_write_failed'), 'ds67.audit', {
        audit_event: 'compliance.ds67_created',
        folio: result.form.folio,
        tenantId: input.tenantId,
      });
    }
    res.json({
      form: result.form,
      pdfBase64: Buffer.from(result.pdfBytes).toString('base64'),
      payloadHashHex: result.payloadHashHex,
    });
  } catch (err) {
    logger.error('ds67_create_failed', { err: String(err) });
    captureRouteError(err, 'ds67.create');
    res.status(500).json({ error: 'ds67_create_failed' });
  }
});

router.get('/ds67/:formId/pdf', verifyAuth, async (req, res) => {
  const tenantId = callerTenantOr403(req, res, req.query.tenantId);
  if (tenantId === null) return;
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
    return undefined;
  } catch (err) {
    logger.error('ds67_pdf_failed', { err: String(err) });
    captureRouteError(err, 'ds67.pdf');
    return res.status(500).json({ error: 'ds67_pdf_failed' });
  }
});

// §2.9 — issue a single-use WebAuthn challenge for signing this DS-67 form.
// The client passes the returned challengeId back to /sign after the
// biometric ceremony; verifyWebAuthnAssertion consumes it atomically.
router.get('/ds67/:formId/sign-challenge', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const tenantId = callerTenantOr403(req, res, req.query.tenantId);
  if (tenantId === null) return;
  try {
    const { buildWebAuthnDb } = await import('./curriculum.js');
    const challengesDb = buildWebAuthnDb();
    const issued = await issueComplianceWebAuthnChallenge({
      uid: callerUid, tenantId, formId: req.params.formId, documentKind: 'ds67',
    }, {
      documents: buildDs67SigningDocuments(tenantId, req.params.formId),
      resolveSigner: resolveRouteSigner,
      newChallengeId: () => generateWebAuthnChallenge().challengeId,
      storeChallenge: (uid, challengeId, challenge, options) =>
        storeWebAuthnChallenge(uid, challengeId, challenge, challengesDb, options),
      now: challengesDb.now,
    });
    res.json({
      challengeId: issued.challengeId,
      challenge: Buffer.from(issued.challenge).toString('base64'),
      formId: req.params.formId,
      payloadHashHex: issued.intent.payloadHashHex,
      rpId: getWebauthnRpId(),
    });
  } catch (err) {
    logger.warn('ds67_sign_challenge_failed', {
      formId: req.params.formId,
      reason: err instanceof ComplianceSigningFlowError ? err.code : 'internal',
    });
    if (err instanceof ComplianceSigningFlowError || err instanceof ComplianceSignerIdentityError) {
      sendSigningError(res, err, 'ds67');
    } else {
      res.status(500).json({ error: 'ds67_sign_challenge_failed' });
    }
  }
});

router.post(
  '/ds67/:formId/sign',
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
        uid: callerUid, tenantId, formId: req.params.formId,
        documentKind: 'ds67', assertion: webauthnAssertion,
      }, {
        documents: buildDs67SigningDocuments(tenantId, req.params.formId),
        resolveSigner: resolveRouteSigner,
        verifyAssertion: async (validateMetadata) => {
          const { verifyWebAuthnAssertion } = await import('../auth/webauthnAssertion.js');
          const { buildWebAuthnDb, buildWebAuthnCredentialsDb } = await import('./curriculum.js');
          return verifyWebAuthnAssertion({
            uid: callerUid, ...webauthnAssertion,
            expectedOrigin: process.env.APP_BASE_URL ?? 'http://localhost:5173',
            expectedRpId: getWebauthnRpId(),
            challengesDb: buildWebAuthnDb(),
            credentialsDb: buildWebAuthnCredentialsDb(),
            challengeMetadataValidator: validateMetadata,
          });
        },
        attestEvidence: attestComplianceEvidence,
      });
      const updated = await signDs67Form(
        tenantId,
        req.params.formId,
        signature as Ds67Signature,
        { formStore: buildDs67FormStore() },
      );
      const auditOk = await auditServerEvent(req, 'compliance.ds67_signed', 'compliance', {
        tenantId,
        formId: req.params.formId,
        algorithm: signature.algorithm,
        webauthnVerified: true,
      });
      if (!auditOk) {
        captureRouteError(new Error('audit_write_failed'), 'ds67.audit', {
          audit_event: 'compliance.ds67_signed',
          formId: req.params.formId,
        });
      }
      return res.json({ form: updated });
    } catch (err) {
      return sendSigningError(res, err, 'ds67');
    }
  },
);

// ─── DS 76 ──────────────────────────────────────────────────────────────────

router.post('/ds76', verifyAuth, validate(ds76Schema), async (req, res) => {
  const validated = req.validated as z.infer<typeof ds76Schema>;
  // tenantId is authoritative from the verified token — never the body (B5).
  const tenantId = callerTenantOr403(req, res, validated.tenantId);
  if (tenantId === null) return;
  // [P0][compliance] Tenant membership is not authorisation — creating a
  // regulatory filing requires a prevention/management role.
  if (!callerHasRegulatoryRole(req, res)) return;
  const input = { ...validated, tenantId };
  try {
    const result = await createDs76Form(input, {
      folioStore: buildFolioStore(),
      formStore: buildDs76FormStore(),
    });
    // P0 fix — see ds67 above. Codex P2 3308579646 contract: branch on the
    // helper's boolean return, not on a thrown error (the helper never
    // throws). On `false` we add a Sentry breadcrumb so compliance gaps
    // are observable on top of the helper's own logger.error.
    const auditOk = await auditServerEvent(req, 'compliance.ds76_created', 'compliance', {
      folio: result.form.folio,
      tenantId: input.tenantId,
    });
    if (!auditOk) {
      captureRouteError(new Error('audit_write_failed'), 'ds76.audit', {
        audit_event: 'compliance.ds76_created',
        folio: result.form.folio,
        tenantId: input.tenantId,
      });
    }
    res.json({
      form: result.form,
      pdfBase64: Buffer.from(result.pdfBytes).toString('base64'),
      payloadHashHex: result.payloadHashHex,
    });
  } catch (err) {
    logger.error('ds76_create_failed', { err: String(err) });
    captureRouteError(err, 'ds76.create');
    res.status(500).json({ error: 'ds76_create_failed' });
  }
});

router.get('/ds76/:formId/pdf', verifyAuth, async (req, res) => {
  const tenantId = callerTenantOr403(req, res, req.query.tenantId);
  if (tenantId === null) return;
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
    return undefined;
  } catch (err) {
    logger.error('ds76_pdf_failed', { err: String(err) });
    captureRouteError(err, 'ds76.pdf');
    return res.status(500).json({ error: 'ds76_pdf_failed' });
  }
});

// §2.9 — single-use WebAuthn challenge for signing this DS-76 form.
router.get('/ds76/:formId/sign-challenge', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;
  const tenantId = callerTenantOr403(req, res, req.query.tenantId);
  if (tenantId === null) return;
  try {
    const { buildWebAuthnDb } = await import('./curriculum.js');
    const challengesDb = buildWebAuthnDb();
    const issued = await issueComplianceWebAuthnChallenge({
      uid: callerUid, tenantId, formId: req.params.formId, documentKind: 'ds76',
    }, {
      documents: buildDs76SigningDocuments(tenantId, req.params.formId),
      resolveSigner: resolveRouteSigner,
      newChallengeId: () => generateWebAuthnChallenge().challengeId,
      storeChallenge: (uid, challengeId, challenge, options) =>
        storeWebAuthnChallenge(uid, challengeId, challenge, challengesDb, options),
      now: challengesDb.now,
    });
    res.json({
      challengeId: issued.challengeId,
      challenge: Buffer.from(issued.challenge).toString('base64'),
      formId: req.params.formId,
      payloadHashHex: issued.intent.payloadHashHex,
      rpId: getWebauthnRpId(),
    });
  } catch (err) {
    logger.warn('ds76_sign_challenge_failed', {
      formId: req.params.formId,
      reason: err instanceof ComplianceSigningFlowError ? err.code : 'internal',
    });
    if (err instanceof ComplianceSigningFlowError || err instanceof ComplianceSignerIdentityError) {
      sendSigningError(res, err, 'ds76');
    } else {
      res.status(500).json({ error: 'ds76_sign_challenge_failed' });
    }
  }
});

router.post(
  '/ds76/:formId/sign',
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
        uid: callerUid, tenantId, formId: req.params.formId,
        documentKind: 'ds76', assertion: webauthnAssertion,
      }, {
        documents: buildDs76SigningDocuments(tenantId, req.params.formId),
        resolveSigner: resolveRouteSigner,
        verifyAssertion: async (validateMetadata) => {
          const { verifyWebAuthnAssertion } = await import('../auth/webauthnAssertion.js');
          const { buildWebAuthnDb, buildWebAuthnCredentialsDb } = await import('./curriculum.js');
          return verifyWebAuthnAssertion({
            uid: callerUid, ...webauthnAssertion,
            expectedOrigin: process.env.APP_BASE_URL ?? 'http://localhost:5173',
            expectedRpId: getWebauthnRpId(),
            challengesDb: buildWebAuthnDb(),
            credentialsDb: buildWebAuthnCredentialsDb(),
            challengeMetadataValidator: validateMetadata,
          });
        },
        attestEvidence: attestComplianceEvidence,
      });
      const updated = await signDs76Form(
        tenantId,
        req.params.formId,
        signature as Ds76Signature,
        { formStore: buildDs76FormStore() },
      );
      const auditOk = await auditServerEvent(req, 'compliance.ds76_signed', 'compliance', {
        tenantId,
        formId: req.params.formId,
        algorithm: signature.algorithm,
        webauthnVerified: true,
      });
      if (!auditOk) {
        captureRouteError(new Error('audit_write_failed'), 'ds76.audit', {
          audit_event: 'compliance.ds76_signed',
          formId: req.params.formId,
        });
      }
      return res.json({ form: updated });
    } catch (err) {
      return sendSigningError(res, err, 'ds76');
    }
  },
);

// Re-export helpers used in test wiring.
export { ds67FolioToDocId, ds76FolioToDocId };
export default router;
