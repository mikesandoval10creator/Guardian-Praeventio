import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import admin from 'firebase-admin';
import { validate } from '../middleware/validate.js';
import { verifyPinnedComplianceKmsServiceAccount } from '../middleware/verifyPinnedServiceAccount.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import {
  ComplianceSigningFlowError,
  completeComplianceKmsSigning,
  type ComplianceSigningDocuments,
} from '../services/complianceWebAuthnSigning.js';
import {
  ComplianceSignerIdentityError,
  resolveConfiguredKmsSigner,
} from '../services/complianceSignerIdentity.js';
import {
  ComplianceKmsSigningError,
  signCompliancePayloadWithKms,
} from '../../services/compliance/cloudKmsComplianceSigner.js';
import {
  renderSusesoUnsignedPayload,
  signForm as signSusesoForm,
  type MinimalFormStore,
} from '../../services/suseso/susesoService.js';
import type { SusesoForm, SusesoSignature } from '../../services/suseso/types.js';
import {
  renderDs67UnsignedPayload,
  signForm as signDs67Form,
  type MinimalDs67FormStore,
} from '../../services/compliance/ds67/ds67Service.js';
import type { Ds67Form, Ds67Signature } from '../../services/compliance/ds67/types.js';
import {
  renderDs76UnsignedPayload,
  signForm as signDs76Form,
  type MinimalDs76FormStore,
} from '../../services/compliance/ds76/ds76Service.js';
import type { Ds76Form, Ds76Signature } from '../../services/compliance/ds76/types.js';

type KmsDocumentKind = 'suseso' | 'ds67' | 'ds76';
type SignedDocument = SusesoForm | Ds67Form | Ds76Form;

const bodySchema = z.object({ tenantId: z.string().min(1) }).strict();

function collectionName(kind: KmsDocumentKind): string {
  return kind === 'suseso' ? 'suseso_forms' : `${kind}_forms`;
}

function documentRef(kind: KmsDocumentKind, tenantId: string, formId: string) {
  return admin.firestore()
    .collection('tenants').doc(tenantId)
    .collection(collectionName(kind)).doc(formId);
}

function buildDocuments(
  kind: KmsDocumentKind,
  tenantId: string,
  formId: string,
): ComplianceSigningDocuments {
  const ref = documentRef(kind, tenantId, formId);
  return {
    async loadForm() {
      const snap = await ref.get();
      return snap.exists ? (snap.data() as SignedDocument) : null;
    },
    async renderUnsignedPayload(form) {
      if (kind === 'suseso') return renderSusesoUnsignedPayload(form as SusesoForm);
      if (kind === 'ds67') return renderDs67UnsignedPayload(form as Ds67Form);
      return renderDs76UnsignedPayload(form as Ds76Form);
    },
    async persistLegacyDigest(payloadHashHex, payloadRendererVersion) {
      await ref.update({ payloadHashHex, payloadRendererVersion });
    },
  };
}

function buildAtomicStore(kind: KmsDocumentKind) {
  const fs = admin.firestore();
  return {
    async saveForm(tenantId: string, formId: string, form: SignedDocument) {
      await documentRef(kind, tenantId, formId).set(form);
    },
    async loadForm(tenantId: string, formId: string) {
      const snap = await documentRef(kind, tenantId, formId).get();
      return snap.exists ? (snap.data() as SignedDocument) : null;
    },
    async attachSignature(
      tenantId: string,
      formId: string,
      signature: SusesoSignature | Ds67Signature | Ds76Signature,
    ) {
      const ref = documentRef(kind, tenantId, formId);
      return fs.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new ComplianceSigningFlowError('not_found');
        const current = snap.data() as SignedDocument;
        if (current.signature) throw new ComplianceSigningFlowError('already_signed');
        tx.update(ref, { signature });
        return { ...current, signature } as SignedDocument;
      });
    },
  };
}

async function signDocumentWithKms(
  kind: KmsDocumentKind,
  tenantId: string,
  formId: string,
): Promise<SignedDocument> {
  if (process.env.COMPLIANCE_KMS_SIGNING_ENABLED !== 'true') {
    throw new ComplianceKmsSigningError('kms_not_configured');
  }
  const signer = resolveConfiguredKmsSigner();
  const signature = await completeComplianceKmsSigning({
    uid: signer.uid,
    tenantId,
    formId,
    documentKind: kind,
  }, {
    documents: buildDocuments(kind, tenantId, formId),
    resolveSigner: async () => signer,
    signPayload: (payload) => signCompliancePayloadWithKms(payload),
  });

  const atomicStore = buildAtomicStore(kind);
  if (kind === 'suseso') {
    return signSusesoForm(tenantId, formId, signature, {
      formStore: {
        ...atomicStore,
        findFormByFolio: async () => null,
      } as MinimalFormStore,
    });
  }
  if (kind === 'ds67') {
    return signDs67Form(tenantId, formId, signature, {
      formStore: {
        ...atomicStore,
        listVersions: async () => [],
      } as MinimalDs67FormStore,
    });
  }
  return signDs76Form(tenantId, formId, signature, {
    formStore: {
      ...atomicStore,
      listVersions: async () => [],
    } as MinimalDs76FormStore,
  });
}

export interface ComplianceKmsSigningRouterDependencies {
  verifyCaller: RequestHandler;
  signDocument(
    kind: KmsDocumentKind,
    tenantId: string,
    formId: string,
  ): Promise<SignedDocument>;
  auditSignature(
    req: Request,
    kind: KmsDocumentKind,
    tenantId: string,
    formId: string,
    form: SignedDocument,
  ): Promise<void>;
}

function errorStatus(error: unknown): number {
  if (error instanceof ComplianceSigningFlowError) {
    if (error.code === 'not_found') return 404;
    if (
      error.code === 'already_signed' ||
      error.code === 'payload_hash_mismatch' ||
      error.code === 'intent_context_mismatch'
    ) return 409;
    return 400;
  }
  if (error instanceof ComplianceSignerIdentityError) return 503;
  if (error instanceof ComplianceKmsSigningError) {
    return error.code === 'kms_not_configured' || error.code === 'kms_unavailable'
      ? 503
      : 502;
  }
  return 500;
}

export function createComplianceKmsSigningRouter(
  deps: ComplianceKmsSigningRouterDependencies,
) {
  const router = Router();
  const register = (path: string, kind: KmsDocumentKind, param: 'id' | 'formId') => {
    router.post(path, deps.verifyCaller, validate(bodySchema), async (req, res) => {
      const { tenantId } = req.validated as z.infer<typeof bodySchema>;
      const formId = req.params[param];
      try {
        const form = await deps.signDocument(kind, tenantId, formId);
        await deps.auditSignature(req, kind, tenantId, formId, form);
        return res.json({ form });
      } catch (error) {
        const status = errorStatus(error);
        const code =
          error instanceof ComplianceSigningFlowError ||
          error instanceof ComplianceSignerIdentityError ||
          error instanceof ComplianceKmsSigningError
            ? error.code
            : 'compliance_kms_sign_failed';
        return res.status(status).json({ error: code });
      }
    });
  };

  register('/suseso/form/:id/kms-sign', 'suseso', 'id');
  register('/compliance/ds67/:formId/kms-sign', 'ds67', 'formId');
  register('/compliance/ds76/:formId/kms-sign', 'ds76', 'formId');
  return router;
}

const router = createComplianceKmsSigningRouter({
  verifyCaller: verifyPinnedComplianceKmsServiceAccount,
  signDocument: signDocumentWithKms,
  async auditSignature(req, kind, tenantId, formId, form) {
    const signerUid = form.signature?.signerUid ?? 'compliance-kms';
    await auditServerEvent(req, `compliance.${kind}_kms_signed`, 'compliance', {
      tenantId,
      formId,
      keyVersion: form.signature?.kmsKeyVersion ?? null,
    }, {
      actorOverride: { uid: signerUid },
    });
  },
});

export default router;
