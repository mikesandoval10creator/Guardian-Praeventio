// Praeventio Guard — Sprint 28 Bucket B6.
//
// SUSESO form orchestration service.
//
// Responsibilities:
//   1. `createSusesoForm` — allocate a folio (atomic Firestore counter),
//      build the form record, render the PDF, compute its SHA-256 hash,
//      build the QR-verification payload, and persist the form.
//   2. `signForm`         — attach a signature to an existing form. The
//      caller is responsible for actually invoking WebAuthn / KMS-sign
//      and producing the (signatureB64, algorithm) pair; this service
//      validates the inputs, recomputes the body hash, and stores the
//      signature on the form record.
//   3. `verifyFolio`      — read a form by folio and return ONLY the
//      verification surface (kind, signedAt, signerRut). Designed for
//      a public endpoint — no clinical data is exposed.
//   4. `submitToMutualidad` — placeholder. The mutualidades (ACHS,
//      Mutual Seguridad, IST) do NOT publish public submission APIs as
//      of 2026-05; the operative flow is "download signed PDF + upload
//      via mutualidad portal". This method records the intent and
//      timestamp for audit but performs no network call. See follow-up
//      note in the function body for re-evaluation criteria.
//
// Persistence model: forms live at
// `tenants/{tenantId}/suseso_forms/{formId}` and are IMMUTABLE post-
// creation (Firestore rules enforce `allow update: if false`). Adding
// a signature is the ONE exception, allowed via Admin-SDK write only —
// the rules block client updates outright.

import {
  type SusesoForm,
  type SusesoFormKind,
  type SusesoSignature,
  type SusesoVerificationResult,
} from './types.js';
import {
  type MinimalFolioStore,
  nextFolio,
  parseFolio,
} from './folioGenerator.js';
import { generateSusesoPdf } from '../../utils/susesoCertificate.js';
import { matchesPersistedComplianceSignatureContext } from '../compliance/complianceSignature.js';
import type {
  ComplianceSignatureVerificationOutcome,
} from '../compliance/complianceSignature.js';
import type { ComplianceSigningContext } from '../auth/complianceSigningIntent.js';

/**
 * Tiny Firestore-shaped contract used by this service. Tests pass an
 * in-memory implementation; production passes a thin wrapper over
 * `admin.firestore()`.
 */
export interface MinimalFormStore {
  /** Save the form record. Idempotent on (tenantId, formId). */
  saveForm(tenantId: string, formId: string, form: SusesoForm): Promise<void>;
  /** Read a form by id, or null. */
  loadForm(tenantId: string, formId: string): Promise<SusesoForm | null>;
  /** Read a form by folio (cross-tenant index). */
  findFormByFolio(folio: string): Promise<
    | { tenantId: string; formId: string; form: SusesoForm }
    | { ambiguous: true }
    | null
  >;
  /** Apply signature mutation. Service-only, never client-callable. */
  attachSignature(
    tenantId: string,
    formId: string,
    signature: SusesoSignature,
  ): Promise<SusesoForm>;
}

export interface CreateSusesoFormInput {
  tenantId: string;
  kind: SusesoFormKind;
  workerRut: string;
  workerFullName: string;
  companyRut: string;
  companyName: string;
  mutualidad: SusesoForm['mutualidad'];
  incidentDate: string;
  incidentDescription: string;
  incidentLocation: string;
  bodyPartsAffected: string[];
  incidentClassification: SusesoForm['incidentClassification'];
  ds101Causal?: string;
  ds110Causal?: string;
  witnesses: SusesoForm['witnesses'];
  reportedBy: SusesoForm['reportedBy'];
}

export interface CreateSusesoFormResult {
  form: SusesoForm;
  pdfBytes: Uint8Array;
  /** Digest the PDF body — what a future signature must cover. */
  payloadHashHex: string;
  /** URL the QR encodes — public verification page. */
  qrCodeUrl: string;
}

/**
 * Compute SHA-256 of bytes. Uses Web Crypto when available (browser,
 * modern Node ≥18 with global `crypto`), falls back to `node:crypto`
 * inside test environments where `globalThis.crypto.subtle` exists.
 */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle =
    typeof globalThis !== 'undefined' &&
    (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle) {
    const buf = await subtle.digest('SHA-256', bytes);
    const arr = new Uint8Array(buf);
    return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Node fallback (node:crypto is always present in our test env).
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
}

export interface SusesoUnsignedPayload {
  pdfBytes: Uint8Array;
  payloadHashHex: string;
  payloadRendererVersion: 1;
}

/** Rebuild the exact unsigned bytes covered by a SUSESO signature. */
export async function renderSusesoUnsignedPayload(
  form: SusesoForm,
): Promise<SusesoUnsignedPayload> {
  const unsignedForm: SusesoForm = { ...form };
  delete unsignedForm.signature;
  delete unsignedForm.submittedAt;
  delete unsignedForm.payloadHashHex;
  delete unsignedForm.payloadRendererVersion;
  const pdfBytes = generateSusesoPdf(unsignedForm);
  return {
    pdfBytes,
    payloadHashHex: await sha256Hex(pdfBytes),
    payloadRendererVersion: 1,
  };
}

/**
 * Build a deterministic Firestore doc id from a folio. Folios are
 * already globally unique within the (tenantId, year, kind) space, so
 * we use them directly — easier to grep in audit logs.
 */
export function folioToDocId(folio: string): string {
  return folio.toLowerCase();
}

/**
 * Build the QR payload URL. The QR should be small enough that any
 * phone camera reads it, so we keep ONLY the folio in the URL — the
 * public verifier page loads the rest.
 *
 * Points at the human page (`/verificar/:folio`), NOT at
 * `/api/suseso/verify/:folio`: whoever scans this is a fiscalizador or a
 * worker holding a printed DIAT/DIEP, and a phone camera opening raw JSON
 * reads as "this document is broken". The API endpoint is unchanged and
 * remains the integration surface.
 *
 * `baseUrl` defaults to relative path, but server-side renders may
 * need an absolute URL — we leave that decision to the caller.
 */
export function buildVerificationUrl(folio: string, baseUrl = ''): string {
  return `${baseUrl}/verificar/${encodeURIComponent(folio)}`;
}

/**
 * Allocate a folio + render the PDF + persist the form. The returned
 * `pdfBytes` and `payloadHashHex` are the inputs the signing flow
 * needs in step 2.
 */
export async function createSusesoForm(
  input: CreateSusesoFormInput,
  deps: {
    folioStore: MinimalFolioStore;
    formStore: MinimalFormStore;
    /** Override "now" for deterministic tests. */
    now?: () => Date;
    /** Override base URL for the QR (e.g. 'https://praeventio.app'). */
    publicBaseUrl?: string;
  },
): Promise<CreateSusesoFormResult> {
  // 1. Validate kind/causal pair early so we don't waste a folio on
  //    an invalid form.
  if (input.kind === 'DIAT' && input.ds110Causal) {
    throw new Error('DIAT cannot carry ds110Causal — that is for DIEP only.');
  }
  if (input.kind === 'DIEP' && input.ds101Causal) {
    throw new Error('DIEP cannot carry ds101Causal — that is for DIAT only.');
  }

  // 2. Allocate folio atomically.
  const now = (deps.now ?? (() => new Date()))();
  const year = now.getUTCFullYear();
  const folio = await nextFolio(deps.folioStore, input.tenantId, input.kind, year);

  // 3. Build the form record.
  const form: SusesoForm = {
    kind: input.kind,
    folio,
    workerRut: input.workerRut,
    workerFullName: input.workerFullName,
    companyRut: input.companyRut,
    companyName: input.companyName,
    mutualidad: input.mutualidad,
    incidentDate: input.incidentDate,
    incidentDescription: input.incidentDescription,
    incidentLocation: input.incidentLocation,
    bodyPartsAffected: input.bodyPartsAffected,
    incidentClassification: input.incidentClassification,
    ds101Causal: input.ds101Causal,
    ds110Causal: input.ds110Causal,
    witnesses: input.witnesses,
    reportedBy: input.reportedBy,
    createdAt: now.toISOString(),
  };

  // 4. Render the PDF + hash.
  const payload = await renderSusesoUnsignedPayload(form);
  form.payloadHashHex = payload.payloadHashHex;
  form.payloadRendererVersion = payload.payloadRendererVersion;

  // 5. Persist.
  const formId = folioToDocId(folio);
  await deps.formStore.saveForm(input.tenantId, formId, form);

  return {
    form,
    pdfBytes: payload.pdfBytes,
    payloadHashHex: payload.payloadHashHex,
    qrCodeUrl: buildVerificationUrl(folio, deps.publicBaseUrl),
  };
}

/**
 * Attach a signature to an existing form. Idempotency: if the form is
 * already signed, the call throws — re-signing requires a new folio
 * (immutability invariant of Ley 16.744 art. 76).
 */
export async function signForm(
  tenantId: string,
  formId: string,
  signature: SusesoSignature,
  deps: { formStore: MinimalFormStore },
): Promise<SusesoForm> {
  const existing = await deps.formStore.loadForm(tenantId, formId);
  if (!existing) {
    throw new Error(`Form not found: ${tenantId}/${formId}`);
  }
  if (existing.signature) {
    throw new Error('Form already signed — re-signing requires a new folio.');
  }
  // Sanity-check the signature shape. Full crypto verification happens
  // at the WebAuthn / KMS layer; here we just guard against obviously
  // malformed inputs.
  if (!signature.signerUid || !signature.signerRut) {
    throw new Error('Signature missing signer identity.');
  }
  if (!signature.signatureB64 || !signature.payloadHashHex) {
    throw new Error('Signature missing signatureB64 or payloadHashHex.');
  }
  if (!/^[0-9a-f]{64}$/.test(signature.payloadHashHex)) {
    throw new Error('payloadHashHex must be a 64-char lowercase hex digest.');
  }
  if (
    !existing.payloadHashHex ||
    !matchesPersistedComplianceSignatureContext(signature, {
      tenantId,
      formId,
      documentKind: 'suseso',
      payloadHashHex: existing.payloadHashHex,
      signerUid: signature.signerUid,
      signerRut: signature.signerRut,
    })
  ) {
    throw new Error('Signature must contain bound compliance evidence for this form.');
  }
  return deps.formStore.attachSignature(tenantId, formId, signature);
}

/**
 * Public verification surface. SAFE to expose without auth — returns
 * only metadata that doesn't leak medical or RUT-of-victim data.
 */
export async function verifyFolio(
  folio: string,
  deps: {
    formStore: MinimalFormStore;
    verifySignature?(input: {
      context: ComplianceSigningContext;
      payloadBytes: Uint8Array;
      signature: SusesoSignature;
    }): Promise<ComplianceSignatureVerificationOutcome>;
  },
): Promise<SusesoVerificationResult> {
  if (!parseFolio(folio)) {
    return { valid: false, reason: 'malformed_folio' };
  }
  const found = await deps.formStore.findFormByFolio(folio);
  if (!found) {
    return { valid: false, reason: 'unknown_folio' };
  }
  if ('ambiguous' in found) {
    return { valid: false, verificationStatus: 'unverifiable', reason: 'ambiguous_folio' };
  }
  if (!found.form.signature) {
    return { valid: false, kind: found.form.kind, reason: 'unsigned' };
  }
  if (
    found.form.payloadRendererVersion === undefined ||
    found.form.payloadHashHex === undefined
  ) {
    return {
      valid: false,
      kind: found.form.kind,
      verificationStatus: 'unverifiable',
      reason: 'legacy_unverifiable',
    };
  }
  const payload = await renderSusesoUnsignedPayload(found.form);
  if (
    found.form.payloadRendererVersion !== payload.payloadRendererVersion ||
    found.form.payloadHashHex !== payload.payloadHashHex
  ) {
    return {
      valid: false,
      kind: found.form.kind,
      verificationStatus: 'invalid',
      reason: 'payload_hash_mismatch',
    };
  }
  if (!deps.verifySignature) {
    return {
      valid: false,
      kind: found.form.kind,
      verificationStatus: 'unverifiable',
      reason: 'verification_service_unavailable',
    };
  }
  const outcome = await deps.verifySignature({
    context: {
      tenantId: found.tenantId,
      formId: found.formId,
      documentKind: 'suseso',
      payloadHashHex: payload.payloadHashHex,
      signerUid: found.form.signature.signerUid,
      signerRut: found.form.signature.signerRut,
    },
    payloadBytes: payload.pdfBytes,
    signature: found.form.signature,
  });
  if (outcome.status !== 'verified') {
    return {
      valid: false,
      kind: found.form.kind,
      verificationStatus: outcome.status,
      reason: outcome.reason,
    };
  }
  return {
    valid: true,
    verificationStatus: 'verified',
    kind: found.form.kind,
    signedAt: found.form.signature.signedAt,
    // Reveal ONLY the signer's RUT (the legally-responsible party),
    // never the worker/victim's RUT.
    signerRut: found.form.signature.signerRut,
  };
}

/**
 * Mark a form as submitted to its mutualidad. NO API CALL is made.
 *
 * As of 2026-05, no Chilean mutualidad publishes a public submission
 * API; the operative pattern is "operator downloads the signed PDF
 * and uploads it via the mutualidad's web portal". This method
 * records the timestamp for audit-trail completeness so we can later
 * prove the form left our system on a given date.
 *
 * FOLLOW-UP (Sprint 29+): when ACHS-Mutual-IST publish a real REST API
 * (currently rumored but not specced), replace this stub with the
 * actual HTTP submission and validate the returned mutualidad-side
 * folio against ours.
 */
export async function submitToMutualidad(
  tenantId: string,
  formId: string,
  deps: { formStore: MinimalFormStore; now?: () => Date },
): Promise<SusesoForm> {
  const existing = await deps.formStore.loadForm(tenantId, formId);
  if (!existing) {
    throw new Error(`Form not found: ${tenantId}/${formId}`);
  }
  if (!existing.signature) {
    throw new Error('Cannot submit unsigned form to mutualidad.');
  }
  const submittedAt = (deps.now ?? (() => new Date()))().toISOString();
  // We piggy-back on attachSignature's "service-only update" contract:
  // adding submittedAt is the only other allowed mutation. To keep the
  // store interface tight, we fold it into a re-save after defensively
  // re-loading; in production this becomes a single Admin-SDK update.
  const updated = { ...existing, submittedAt };
  await deps.formStore.saveForm(tenantId, formId, updated);
  return updated;
}
