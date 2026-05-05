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

  const pdfBytes = generateDs76Pdf(form);
  const payloadHashHex = await sha256Hex(pdfBytes);

  await deps.formStore.saveForm(input.tenantId, ds76FolioToDocId(folio), form);
  return { form, pdfBytes, payloadHashHex };
}

export async function signForm(
  tenantId: string,
  formId: string,
  signature: Ds76Signature,
  deps: { formStore: MinimalDs76FormStore },
): Promise<Ds76Form> {
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
  return deps.formStore.attachSignature(tenantId, formId, signature);
}

export async function listVersions(
  tenantId: string,
  deps: { formStore: MinimalDs76FormStore },
): Promise<Ds76Form[]> {
  return deps.formStore.listVersions(tenantId);
}
