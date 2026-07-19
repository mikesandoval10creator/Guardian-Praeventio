// Praeventio Guard — Sprint 31 Bucket PP.
//
// DS 76/2007 Reglamento Subcontratación Mining service. Mirrors DS-67
// orchestration: atomic folio + jsPDF body + SHA-256 + WebAuthn signature.

import type { Ds76Form, Ds76Signature } from './types.js';
import {
  type MinimalFolioStore,
  tenantSlug,
} from '../../suseso/folioGenerator.js';
import { generateDs76Pdf } from '../../../utils/ds76Certificate.js';
import { matchesPersistedComplianceSignatureContext } from '../complianceSignature.js';
import { awardXp } from '../../gamification/positiveXp.js';
import {
  JurisdictionNotSupportedError,
  type ResolveCountryFn,
} from '../ds67/ds67Service.js';
import type { CountryCode } from '../../normativa/countryPacks.js';

// ─── Sprint 33 wire W6 — country gate ───────────────────────────────────────
//
// DS 76/2007 (Reglamento Especial Subcontratación) is Chile-specific
// (Ley 16.744 + Ley 20.123). Non-CL projects must use their own emission
// adapter (per ADR-0014). Until those exist, throw the shared
// `JurisdictionNotSupportedError` and 400 at the API layer.
async function resolveCountrySafelyDs76(
  resolveCountry: ResolveCountryFn | undefined,
  tenantId: string,
  formId: string,
): Promise<CountryCode> {
  if (!resolveCountry) return 'CL';
  try {
    const c = await resolveCountry();
    return c ?? 'CL';
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(
        '[ds76Service] resolveCountry threw — defaulting to CL',
        { tenantId, formId, err },
      );
    }
    return 'CL';
  }
}

export function formatDs76Folio(
  year: number,
  tenantId: string,
  seq: number,
): string {
  return `DS76-${year}-${tenantSlug(tenantId)}-${String(seq).padStart(6, '0')}`;
}

export function parseDs76Folio(folio: string): {
  year: number;
  tenantSlug: string;
  seq: number;
} | null {
  const m = /^DS76-(\d{4})-([a-z0-9]{8})-(\d{6})$/.exec(folio);
  if (!m) return null;
  return { year: Number(m[1]), tenantSlug: m[2], seq: Number(m[3]) };
}

export async function nextDs76Folio(
  store: MinimalFolioStore,
  tenantId: string,
  year: number = new Date().getUTCFullYear(),
): Promise<string> {
  const counterPath = `tenants/${tenantId}/ds76_counters/${year}`;
  const seq = await store.runTransaction(async (tx) => {
    const snap = await tx.get(counterPath);
    const current =
      snap.exists && typeof snap.data?.lastSeq === 'number'
        ? snap.data.lastSeq
        : 0;
    const next = current + 1;
    tx.set(counterPath, { lastSeq: next });
    return next;
  });
  return formatDs76Folio(year, tenantId, seq);
}

export interface MinimalDs76FormStore {
  saveForm(tenantId: string, formId: string, form: Ds76Form): Promise<void>;
  loadForm(tenantId: string, formId: string): Promise<Ds76Form | null>;
  listVersions(tenantId: string): Promise<Ds76Form[]>;
  attachSignature(
    tenantId: string,
    formId: string,
    signature: Ds76Signature,
  ): Promise<Ds76Form>;
}

export function ds76FolioToDocId(folio: string): string {
  return folio.toLowerCase();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle =
    typeof globalThis !== 'undefined' &&
    (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (subtle) {
    const buf = await subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  const nodeCrypto = await import('node:crypto');
  return nodeCrypto.createHash('sha256').update(bytes).digest('hex');
}

export interface Ds76UnsignedPayload {
  pdfBytes: Uint8Array;
  payloadHashHex: string;
  payloadRendererVersion: 1;
}

/** Rebuild the exact unsigned bytes covered by a DS-76 signature. */
export async function renderDs76UnsignedPayload(
  form: Ds76Form,
): Promise<Ds76UnsignedPayload> {
  const unsignedForm: Ds76Form = { ...form };
  delete unsignedForm.signature;
  delete unsignedForm.payloadHashHex;
  delete unsignedForm.payloadRendererVersion;
  const pdfBytes = generateDs76Pdf(unsignedForm);
  return {
    pdfBytes,
    payloadHashHex: await sha256Hex(pdfBytes),
    payloadRendererVersion: 1,
  };
}

export interface CreateDs76Input {
  tenantId: string;
  principalCompanyName: string;
  principalCompanyRut: string;
  contractorCompanyName: string;
  contractorCompanyRut: string;
  worksiteName: string;
  worksiteAddress: string;
  sstManagementPlan: string;
  managementSystemDescription: string;
  supervisionScheme: string;
  trainingItems: Array<{ topic: string; hours: number }>;
  susesoFiscalizationRecord: string;
}

export interface CreateDs76Result {
  form: Ds76Form;
  pdfBytes: Uint8Array;
  payloadHashHex: string;
}

export async function createDs76Form(
  input: CreateDs76Input,
  deps: {
    folioStore: MinimalFolioStore;
    formStore: MinimalDs76FormStore;
    now?: () => Date;
  },
): Promise<CreateDs76Result> {
  if (!input.tenantId) throw new Error('tenantId required');
  if (!input.principalCompanyName) throw new Error('principalCompanyName required');
  if (!input.contractorCompanyName) throw new Error('contractorCompanyName required');
  if (!input.worksiteName) throw new Error('worksiteName required');

  const now = (deps.now ?? (() => new Date()))();
  const year = now.getUTCFullYear();
  const folio = await nextDs76Folio(deps.folioStore, input.tenantId, year);

  const form: Ds76Form = {
    folio,
    tenantId: input.tenantId,
    principalCompanyName: input.principalCompanyName,
    principalCompanyRut: input.principalCompanyRut,
    contractorCompanyName: input.contractorCompanyName,
    contractorCompanyRut: input.contractorCompanyRut,
    worksiteName: input.worksiteName,
    worksiteAddress: input.worksiteAddress,
    sstManagementPlan: input.sstManagementPlan,
    managementSystemDescription: input.managementSystemDescription,
    supervisionScheme: input.supervisionScheme,
    trainingItems: input.trainingItems,
    susesoFiscalizationRecord: input.susesoFiscalizationRecord,
    createdAt: now.toISOString(),
  };

  const payload = await renderDs76UnsignedPayload(form);
  form.payloadHashHex = payload.payloadHashHex;
  form.payloadRendererVersion = payload.payloadRendererVersion;

  await deps.formStore.saveForm(input.tenantId, ds76FolioToDocId(folio), form);
  return { form, pdfBytes: payload.pdfBytes, payloadHashHex: payload.payloadHashHex };
}

export async function signForm(
  tenantId: string,
  formId: string,
  signature: Ds76Signature,
  deps: {
    formStore: MinimalDs76FormStore;
    resolveCountry?: ResolveCountryFn;
  },
): Promise<Ds76Form> {
  // Sprint 33 W6 — country gate. Default CL; throw for non-CL.
  const country = await resolveCountrySafelyDs76(
    deps.resolveCountry,
    tenantId,
    formId,
  );
  if (country !== 'CL') {
    throw new JurisdictionNotSupportedError('DS76', country);
  }

  const existing = await deps.formStore.loadForm(tenantId, formId);
  if (!existing) throw new Error(`Form not found: ${tenantId}/${formId}`);
  if (existing.signature) {
    throw new Error('Form already signed — re-signing requires a new folio.');
  }
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
      documentKind: 'ds76',
      payloadHashHex: existing.payloadHashHex,
      signerUid: signature.signerUid,
      signerRut: signature.signerRut,
    })
  ) {
    throw new Error('Signature must contain bound compliance evidence for this form.');
  }
  const result = await deps.formStore.attachSignature(tenantId, formId, signature);

  // Sprint 32 wire W4 — gamificación POSITIVA: emitir y firmar el DS-76
  // (subcontratación minera) formaliza el cumplimiento legal. XP al
  // firmante. Fire-and-forget; el path legal nunca se rompe por gamification.
  try {
    awardXp('compliance_doc_generated', undefined, {
      docType: 'DS76',
      folio: existing.folio,
      tenantId,
      signerUid: signature.signerUid,
    });
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[ds76Service] awardXp(compliance_doc_generated) threw — ignored', err);
    }
  }

  return result;
}

export async function listVersions(
  tenantId: string,
  deps: { formStore: MinimalDs76FormStore },
): Promise<Ds76Form[]> {
  return deps.formStore.listVersions(tenantId);
}
