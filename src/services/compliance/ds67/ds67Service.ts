// Praeventio Guard — Sprint 31 Bucket PP.
//
// DS 67 Reglamento Interno orchestration service.
//
// Mirrors the SUSESO Sprint 28 B6 pattern: atomic folio counter +
// jsPDF body + SHA-256 digest + WebAuthn signature attached after the
// fact. Forms are IMMUTABLE post-creation (Firestore rules enforce
// `allow update: if false`); attaching a signature is the ONE allowed
// mutation, performed only via Admin-SDK write.
//
// Persistence model: forms live at
// `tenants/{tenantId}/ds67_forms/{formId}`. Folios use the
// `DS67-${year}-${slug}-${seq:06d}` shape so they are visually distinct
// from SUSESO folios in audit logs.

import type { Ds67Form, Ds67Signature } from './types.js';
import {
  type MinimalFolioStore,
  tenantSlug,
} from '../../suseso/folioGenerator.js';
import { generateDs67Pdf } from '../../../utils/ds67Certificate.js';
import { awardXp } from '../../gamification/positiveXp.js';
import type { CountryCode } from '../../normativa/countryPacks.js';

// ─── Sprint 33 wire W6 — country gate ───────────────────────────────────────
//
// DS 67/1999 (Reglamento Interno) is rooted in Ley 16.744 (Chile) and the
// SEREMI registry. Its content (Comité Paritario, MUTUAL system, RUT,
// SUSESO fiscalisation) does NOT translate to other jurisdictions. Per
// ADR-0014 (Regulatory Framework Abstraction), each non-CL jurisdiction
// must use its own emission adapter (e.g. US → OSHA Form 301; UK → RIDDOR;
// EU → EU-OSHA national reporting; MX → STPS DC-3 / NOM-019; BR → CIPA /
// NR-5). Until those adapters exist (tracked under wire W6 follow-up),
// emit a typed `JurisdictionNotSupportedError` and 400 at the API layer.
//
// Defense-in-depth: a B2D international tenant should NEVER end up with a
// DS-67 PDF that does not legally apply to its workforce.

export class JurisdictionNotSupportedError extends Error {
  readonly code = 'jurisdiction_not_supported_yet' as const;
  readonly country: CountryCode;
  readonly docType: 'DS67' | 'DS76';
  readonly suggestedAdapters: readonly string[];
  constructor(
    docType: 'DS67' | 'DS76',
    country: CountryCode,
    suggestedAdapters: readonly string[] = SUGGESTED_ADAPTERS,
  ) {
    super(
      `${docType} is Chile-specific (Ley 16.744). Country '${country}' has no emission adapter yet. ` +
        `See ADR-0014. Suggested per-country forms: ${suggestedAdapters.join(', ')}.`,
    );
    this.name = 'JurisdictionNotSupportedError';
    this.country = country;
    this.docType = docType;
    this.suggestedAdapters = suggestedAdapters;
  }
}

const SUGGESTED_ADAPTERS: readonly string[] = [
  'US → OSHA Form 301 (29 CFR 1904.7)',
  'EU → EU-OSHA national reporting (Directive 89/391/EEC)',
  'UK → RIDDOR 2013',
  'MX → STPS NOM-019-STPS-2011 / DC-3',
  'BR → CIPA / NR-5',
];

// ─── Folio formatting (DS-67 specific kind prefix) ──────────────────────────

export function formatDs67Folio(
  year: number,
  tenantId: string,
  seq: number,
): string {
  const slug = tenantSlug(tenantId);
  return `DS67-${year}-${slug}-${String(seq).padStart(6, '0')}`;
}

export function parseDs67Folio(folio: string): {
  year: number;
  tenantSlug: string;
  seq: number;
} | null {
  const m = /^DS67-(\d{4})-([a-z0-9]{8})-(\d{6})$/.exec(folio);
  if (!m) return null;
  return { year: Number(m[1]), tenantSlug: m[2], seq: Number(m[3]) };
}

/**
 * Allocate the next DS-67 folio for a tenant/year. Same OCC semantics
 * as SUSESO `nextFolio` but with a separate counter document so DS-67
 * sequences do NOT interleave with DIAT/DIEP sequences.
 */
export async function nextDs67Folio(
  store: MinimalFolioStore,
  tenantId: string,
  year: number = new Date().getUTCFullYear(),
): Promise<string> {
  const counterPath = `tenants/${tenantId}/ds67_counters/${year}`;
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
  return formatDs67Folio(year, tenantId, seq);
}

// ─── Form-store contract ────────────────────────────────────────────────────

export interface MinimalDs67FormStore {
  saveForm(tenantId: string, formId: string, form: Ds67Form): Promise<void>;
  loadForm(tenantId: string, formId: string): Promise<Ds67Form | null>;
  listVersions(tenantId: string): Promise<Ds67Form[]>;
  attachSignature(
    tenantId: string,
    formId: string,
    signature: Ds67Signature,
  ): Promise<Ds67Form>;
}

export function ds67FolioToDocId(folio: string): string {
  return folio.toLowerCase();
}

// ─── Hashing ────────────────────────────────────────────────────────────────

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

// ─── createDs67Form ─────────────────────────────────────────────────────────

export interface CreateDs67Input {
  tenantId: string;
  companyName: string;
  companyRut: string;
  companyAddress: string;
  scopeOfApplication: string;
  workerObligations: string[];
  workerProhibitions: string[];
  sanctions: string;
  complaintProcedure: string;
  effectiveFrom: string;
  effectiveUntil?: string;
}

export interface CreateDs67Result {
  form: Ds67Form;
  pdfBytes: Uint8Array;
  payloadHashHex: string;
}

/**
 * Allocate a DS-67 folio + render the PDF + persist the form record.
 * The returned `pdfBytes` and `payloadHashHex` feed into the WebAuthn
 * signing flow (step 2: `signForm`).
 */
export async function createDs67Form(
  input: CreateDs67Input,
  deps: {
    folioStore: MinimalFolioStore;
    formStore: MinimalDs67FormStore;
    now?: () => Date;
  },
): Promise<CreateDs67Result> {
  if (!input.tenantId) throw new Error('tenantId required');
  if (!input.companyName) throw new Error('companyName required');
  if (!input.companyRut) throw new Error('companyRut required');
  if (!input.scopeOfApplication) throw new Error('scopeOfApplication required');

  const now = (deps.now ?? (() => new Date()))();
  const year = now.getUTCFullYear();
  const folio = await nextDs67Folio(deps.folioStore, input.tenantId, year);

  const form: Ds67Form = {
    folio,
    tenantId: input.tenantId,
    companyName: input.companyName,
    companyRut: input.companyRut,
    companyAddress: input.companyAddress,
    scopeOfApplication: input.scopeOfApplication,
    workerObligations: input.workerObligations,
    workerProhibitions: input.workerProhibitions,
    sanctions: input.sanctions,
    complaintProcedure: input.complaintProcedure,
    effectiveFrom: input.effectiveFrom,
    effectiveUntil: input.effectiveUntil,
    createdAt: now.toISOString(),
  };

  const pdfBytes = generateDs67Pdf(form);
  const payloadHashHex = await sha256Hex(pdfBytes);

  const formId = ds67FolioToDocId(folio);
  await deps.formStore.saveForm(input.tenantId, formId, form);

  return { form, pdfBytes, payloadHashHex };
}

/**
 * Resolve the project country before emitting / signing a DS-67. Defaults
 * to `'CL'` when the resolver is missing, throws, or returns falsy — the
 * audit trail records the warn so the operator can investigate.
 *
 * The resolver is intentionally async + injectable so callers can wire
 * it to `locationNormativa.countryFromCoordsAsync` (project coords),
 * tenant config, or a manual override stored on the project document.
 */
export type ResolveCountryFn = () => Promise<CountryCode | null | undefined>;

async function resolveCountrySafely(
  resolveCountry: ResolveCountryFn | undefined,
  ctx: { docType: 'DS67' | 'DS76'; tenantId: string; formId: string },
): Promise<CountryCode> {
  if (!resolveCountry) return 'CL';
  try {
    const c = await resolveCountry();
    return c ?? 'CL';
  } catch (err) {
    // Defense-in-depth: a flaky locationNormativa call MUST NOT block
    // Chilean compliance emission. Default to CL and warn for audit.
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(
        `[${ctx.docType.toLowerCase()}Service] resolveCountry threw — defaulting to CL`,
        { tenantId: ctx.tenantId, formId: ctx.formId, err },
      );
    }
    return 'CL';
  }
}

/** Attach a signature to an existing form. Re-signing is rejected.
 *
 * Sprint 33 W6: gates on project country before mutating. Non-CL
 * tenants get a `JurisdictionNotSupportedError` (HTTP 400 at the
 * route layer). See ADR-0014 + Ley 16.744.
 */
export async function signForm(
  tenantId: string,
  formId: string,
  signature: Ds67Signature,
  deps: {
    formStore: MinimalDs67FormStore;
    /**
     * Optional country resolver (e.g. wraps `locationNormativa` +
     * project coords). Missing → defaults to 'CL'. Throwing →
     * defaults to 'CL' with audit warn.
     */
    resolveCountry?: ResolveCountryFn;
  },
): Promise<Ds67Form> {
  const country = await resolveCountrySafely(deps.resolveCountry, {
    docType: 'DS67',
    tenantId,
    formId,
  });
  if (country !== 'CL') {
    throw new JurisdictionNotSupportedError('DS67', country);
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
  const result = await deps.formStore.attachSignature(tenantId, formId, signature);

  // Sprint 32 wire W4 — gamificación POSITIVA: emitir y firmar el DS-67
  // formaliza el cumplimiento legal. XP al firmante. Fire-and-forget; el
  // path legal del attachSignature nunca se rompe por gamificación.
  try {
    awardXp('compliance_doc_generated', undefined, {
      docType: 'DS67',
      folio: existing.folio,
      tenantId,
      signerUid: signature.signerUid,
    });
  } catch (err) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[ds67Service] awardXp(compliance_doc_generated) threw — ignored', err);
    }
  }

  return result;
}

/**
 * List all versions of the Reglamento for a tenant — the audit trail
 * required by SEREMI inspections (every modification is a new folio).
 */
export async function listVersions(
  tenantId: string,
  deps: { formStore: MinimalDs67FormStore },
): Promise<Ds67Form[]> {
  return deps.formStore.listVersions(tenantId);
}
