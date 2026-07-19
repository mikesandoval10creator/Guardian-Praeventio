import {
  createComplianceSigningIntent,
  matchesComplianceSigningContext,
  type ComplianceDocumentKind,
  type ComplianceSigningContext,
  type ComplianceSigningIntentV1,
} from '../../services/auth/complianceSigningIntent.js';
import {
  buildWebAuthnComplianceSignature,
  buildComplianceKmsSigningPayload,
  buildKmsComplianceSignature,
  type ComplianceArchiveAttestation,
  type TrustedComplianceSigner,
  type VerifiedWebAuthnComplianceSignature,
  type VerifiedKmsComplianceSignature,
} from '../../services/compliance/complianceSignature.js';

export type ComplianceSigningFlowErrorCode =
  | 'not_found'
  | 'already_signed'
  | 'payload_hash_mismatch'
  | 'intent_context_mismatch'
  | 'webauthn_failed'
  | 'evidence_attestation_unavailable';

export class ComplianceSigningFlowError extends Error {
  constructor(
    readonly code: ComplianceSigningFlowErrorCode,
    readonly reason?: string,
  ) {
    super(reason ? `${code}: ${reason}` : code);
    this.name = 'ComplianceSigningFlowError';
  }
}

export interface ComplianceSignableForm {
  signature?: unknown;
  payloadHashHex?: string;
  payloadRendererVersion?: number;
}

export interface ComplianceUnsignedPayload {
  pdfBytes: Uint8Array;
  payloadHashHex: string;
  /**
   * Which byte-rendering contract produced `pdfBytes`. Per-document, not
   * global: DS 67 / DS 76 still emit v1, SUSESO emits v2 (its body now
   * carries the verification QR). Verification renders at the version
   * stored on the document, so signatures survive a renderer bump.
   */
  payloadRendererVersion: 1 | 2;
}

export interface ComplianceSigningDocuments {
  loadForm(): Promise<ComplianceSignableForm | null>;
  renderUnsignedPayload(form: ComplianceSignableForm): Promise<ComplianceUnsignedPayload>;
  persistLegacyDigest(payloadHashHex: string, payloadRendererVersion: 1 | 2): Promise<void>;
}

export interface ComplianceSigningTarget {
  uid: string;
  tenantId: string;
  formId: string;
  documentKind: ComplianceDocumentKind;
}

export interface ComplianceWebAuthnAssertion {
  challengeId: string;
  credentialId: string;
  rawId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  type: 'public-key';
  clientExtensionResults: Record<string, unknown>;
}

interface PreparedSigningContext {
  signer: TrustedComplianceSigner;
  context: ComplianceSigningContext;
  payload: ComplianceUnsignedPayload;
}

async function prepareSigningContext(
  target: ComplianceSigningTarget,
  documents: ComplianceSigningDocuments,
  resolveSigner: (uid: string) => Promise<TrustedComplianceSigner>,
): Promise<PreparedSigningContext> {
  const form = await documents.loadForm();
  if (!form) throw new ComplianceSigningFlowError('not_found');
  if (form.signature) throw new ComplianceSigningFlowError('already_signed');

  const payload = await documents.renderUnsignedPayload(form);
  const hasStoredHash = form.payloadHashHex !== undefined;
  const hasStoredVersion = form.payloadRendererVersion !== undefined;
  if (!hasStoredHash && !hasStoredVersion) {
    await documents.persistLegacyDigest(payload.payloadHashHex, payload.payloadRendererVersion);
  } else if (
    form.payloadHashHex !== payload.payloadHashHex ||
    form.payloadRendererVersion !== payload.payloadRendererVersion
  ) {
    throw new ComplianceSigningFlowError('payload_hash_mismatch');
  }

  const signer = await resolveSigner(target.uid);
  return {
    signer,
    context: {
      tenantId: target.tenantId,
      formId: target.formId,
      documentKind: target.documentKind,
      payloadHashHex: payload.payloadHashHex,
      signerUid: signer.uid,
      signerRut: signer.rut,
    },
    payload,
  };
}

export async function issueComplianceWebAuthnChallenge(
  target: ComplianceSigningTarget,
  deps: {
    documents: ComplianceSigningDocuments;
    resolveSigner(uid: string): Promise<TrustedComplianceSigner>;
    storeChallenge(
      uid: string,
      challengeId: string,
      challenge: Uint8Array,
      options: { metadata: ComplianceSigningIntentV1; ttlMs: number },
    ): Promise<void>;
    newChallengeId(): string;
    now?: () => number;
    randomBytes?: () => Uint8Array;
  },
): Promise<{
  challengeId: string;
  challenge: Uint8Array;
  intent: ComplianceSigningIntentV1;
}> {
  const prepared = await prepareSigningContext(target, deps.documents, deps.resolveSigner);
  const ttlMs = 5 * 60 * 1000;
  const created = createComplianceSigningIntent(prepared.context, {
    now: deps.now,
    randomBytes: deps.randomBytes,
    ttlMs,
  });
  const challengeId = deps.newChallengeId();
  if (!challengeId) throw new TypeError('newChallengeId returned an empty value');
  await deps.storeChallenge(target.uid, challengeId, created.challenge, {
    metadata: created.intent,
    ttlMs,
  });
  return { challengeId, challenge: created.challenge, intent: created.intent };
}

export async function completeComplianceWebAuthnSigning(
  target: ComplianceSigningTarget & { assertion: ComplianceWebAuthnAssertion },
  deps: {
    documents: ComplianceSigningDocuments;
    resolveSigner(uid: string): Promise<TrustedComplianceSigner>;
    verifyAssertion(
      validateMetadata: (metadata: unknown) => boolean,
    ): Promise<{
      verified: boolean;
      reason?: string;
      verifiedCredentialId?: string;
      verifiedCredentialPublicKeyB64?: string;
      verifiedOrigin?: string;
      verifiedRpId?: string;
      challengeMetadata?: unknown;
    }>;
    attestEvidence(evidence: unknown): ComplianceArchiveAttestation;
    now?: () => Date;
  },
): Promise<VerifiedWebAuthnComplianceSignature> {
  const prepared = await prepareSigningContext(target, deps.documents, deps.resolveSigner);
  const validateMetadata = (metadata: unknown): boolean =>
    matchesComplianceSigningContext(
      metadata as ComplianceSigningIntentV1,
      prepared.context,
    );
  const verdict = await deps.verifyAssertion(validateMetadata);
  if (
    !verdict.verified ||
    !verdict.verifiedCredentialId ||
    !verdict.verifiedCredentialPublicKeyB64 ||
    !verdict.verifiedOrigin ||
    !verdict.verifiedRpId
  ) {
    throw new ComplianceSigningFlowError('webauthn_failed', verdict.reason);
  }
  if (!validateMetadata(verdict.challengeMetadata)) {
    throw new ComplianceSigningFlowError('intent_context_mismatch');
  }

  const evidence = buildWebAuthnComplianceSignature({
    intent: verdict.challengeMetadata as ComplianceSigningIntentV1,
    signer: prepared.signer,
    assertion: target.assertion,
    verifiedCredentialId: verdict.verifiedCredentialId,
    verificationKey: {
      publicKeyB64: verdict.verifiedCredentialPublicKeyB64,
      origin: verdict.verifiedOrigin,
      rpId: verdict.verifiedRpId,
    },
    now: deps.now,
  });
  try {
    return {
      ...evidence,
      archiveAttestation: deps.attestEvidence(evidence),
    };
  } catch {
    throw new ComplianceSigningFlowError('evidence_attestation_unavailable');
  }
}

export async function completeComplianceKmsSigning(
  target: ComplianceSigningTarget,
  deps: {
    documents: ComplianceSigningDocuments;
    resolveSigner(uid: string): Promise<TrustedComplianceSigner>;
    signPayload(payload: Uint8Array): Promise<{
      signatureB64: string;
      keyVersion: string;
      publicKeyPem: string;
    }>;
    attestEvidence(evidence: unknown): ComplianceArchiveAttestation;
    now?: () => Date;
  },
): Promise<VerifiedKmsComplianceSignature> {
  const prepared = await prepareSigningContext(target, deps.documents, deps.resolveSigner);
  if (prepared.signer.kind !== 'kms') {
    throw new TypeError('KMS signing requires the configured machine identity');
  }
  const kmsEvidence = await deps.signPayload(buildComplianceKmsSigningPayload(prepared.context));
  const evidence = buildKmsComplianceSignature({
    context: prepared.context,
    signer: prepared.signer,
    signatureB64: kmsEvidence.signatureB64,
    keyVersion: kmsEvidence.keyVersion,
    publicKeyPem: kmsEvidence.publicKeyPem,
    now: deps.now,
  });
  try {
    return {
      ...evidence,
      archiveAttestation: deps.attestEvidence(evidence),
    };
  } catch {
    throw new ComplianceSigningFlowError('evidence_attestation_unavailable');
  }
}
