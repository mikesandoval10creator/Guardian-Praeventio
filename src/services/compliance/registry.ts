// Praeventio Guard — Sprint 38 (CL adapter consolidation).
//
// Per ADR-0017 (Per-country emission adapters): central registry that
// resolves a (country, emissionType) tuple to an adapter exposing a
// uniform `{ validate, generate, sign?, suggestedFormats }` shape.
//
// Sprint 38 = Chile only. US/UK/EU/MX/BR/AU/CN/TW/RU return null with
// `suggestedAdapters` per the ADR-0017 contract — ese mismo patrón ya
// está consolidado por Sprint 33 D2 (`JurisdictionNotSupportedError`).
//
// Reglas del usuario incrustadas:
//   • NO push a SUSESO/MUTUAL/SII — adapter.generate produce documento,
//     adapter.sign aplica firma biométrica WebAuthn, NUNCA hay step
//     `submitToOrganism`. La empresa cliente entrega por su canal
//     oficial.
//   • NO bloquear maquinaria — emit() solo retorna documentos.
//
// Este registry es **additive**. Los call sites originales
// (`/api/dte/generate`, `/api/compliance/ds67`, `/api/compliance/ds76`,
// `/api/medical/aptitude-cert/...`) siguen funcionando. El nuevo
// endpoint `/api/compliance/emit/:type` es opt-in para nuevos
// integradores (ej. Vertex AI Agent Builder, mobile clients
// agnósticos al país).

import { z } from 'zod';

// ─── Tipos públicos ─────────────────────────────────────────────────────────
//
// CountryCode local al adapter system. Intencionalmente DISTINTO de
// `countryPacks.CountryCode` ('CL'|'PE'|'CO'|'MX'|'AR'|'BR'|'ISO') que
// gobierna paquetes normativos B2D — aquí necesitamos el set "global
// launch" alineado con `product_china_taiwan_russia_priority` y
// ADR-0017 §Sprint 38-41+.
export type CountryCode =
  | 'CL'
  | 'US'
  | 'UK'
  | 'EU'
  | 'MX'
  | 'BR'
  | 'AU'
  | 'CN'
  | 'TW'
  | 'RU';

export type EmissionType =
  | 'occupational_injury'
  | 'aptitude_cert'
  | 'tax_invoice'
  | 'committee_minutes'
  | 'training_record'
  | 'safety_inspection';

export const COUNTRY_CODES: readonly CountryCode[] = [
  'CL',
  'US',
  'UK',
  'EU',
  'MX',
  'BR',
  'AU',
  'CN',
  'TW',
  'RU',
] as const;

export const EMISSION_TYPES: readonly EmissionType[] = [
  'occupational_injury',
  'aptitude_cert',
  'tax_invoice',
  'committee_minutes',
  'training_record',
  'safety_inspection',
] as const;

/**
 * Minimal generic shape an adapter must expose. Generators are kept
 * loosely typed at the registry layer (each underlying service has its
 * own strict input type) — Zod validation gates payload shape before
 * generate() is called.
 */
export interface EmissionAdapter {
  /** Country this adapter targets. */
  readonly country: CountryCode;
  /** Emission type this adapter handles. */
  readonly type: EmissionType;
  /** Zod schema validating the payload before generation. */
  readonly validate: z.ZodTypeAny;
  /** Pure generator — produces JSON + optional PDF. NEVER pushes anywhere. */
  readonly generate: (payload: unknown) => Promise<EmissionResult> | EmissionResult;
  /** Optional WebAuthn-backed signer. Returns the document with signature attached. */
  readonly sign?: (signed: EmissionSignInput) => Promise<EmissionResult> | EmissionResult;
  /** Visual formats produced by this adapter (e.g. 'application/pdf', 'application/json'). */
  readonly suggestedFormats: readonly string[];
  /** Free-form citation string for audit logs (e.g. 'Ley 16.744 + DS 67'). */
  readonly legalCitation: string;
}

export interface EmissionResult {
  /** Canonical structured representation. */
  json: unknown;
  /** Base64 PDF if the adapter produces one. */
  pdfBase64?: string;
  /** XML representation if applicable (e.g. DTE SII). */
  xml?: string;
  /** Folio / form id if the adapter assigns one. */
  folio?: string;
  /** Signature metadata if signed. */
  signature?: {
    signedAt: string;
    credentialId: string;
    signerSubject?: string;
  };
}

export interface EmissionSignInput {
  document: EmissionResult;
  webauthnAssertion: unknown;
}

/**
 * Standardized "no adapter for this jurisdiction yet" error. Wraps
 * Sprint 33 D2's `JurisdictionNotSupportedError` semantics at the
 * registry tier, so the HTTP route can map it to a 400 with
 * `suggestedAdapters` per ADR-0017.
 */
export class NoAdapterError extends Error {
  readonly code = 'no_adapter_for_jurisdiction' as const;
  readonly country: CountryCode;
  readonly type: EmissionType;
  readonly suggestedAdapters: readonly string[];
  constructor(country: CountryCode, type: EmissionType, suggestedAdapters: readonly string[]) {
    super(
      `No emission adapter for country='${country}' type='${type}'. ADR-0017 rolls out country-by-country (Sprint 38 = CL).`,
    );
    this.name = 'NoAdapterError';
    this.country = country;
    this.type = type;
    this.suggestedAdapters = suggestedAdapters;
  }
}

// ─── Suggested adapters per emission type (used in 400 responses) ───────────

const SUGGESTED_BY_TYPE: Record<EmissionType, readonly string[]> = {
  occupational_injury: [
    'US → OSHA Form 301 (29 CFR 1904.7)',
    'UK → RIDDOR 2013',
    'EU → EU-OSHA national reporting (Directive 89/391/EEC)',
    'MX → STPS NOM-019 / IMSS ST-5',
    'BR → CIPA / NR-5 + CAT',
    'AU → WHS state-specific incident notification',
    'CN → GB/T 33000 + MEM occupational injury',
    'TW → Labor Standards Act §59 + OSHA Taiwan',
    'RU → 152-FZ + Rostrud occupational injury form',
  ],
  aptitude_cert: [
    'US → OSHA medical evaluation (29 CFR 1910.134 / 1910.120)',
    'UK → HSE medical surveillance certificate',
    'EU → EU-OSHA Directive 2003/10/EC fitness-for-work',
    'MX → NOM-030-STPS aptitud médica',
    'BR → ASO (Atestado de Saúde Ocupacional, NR-7)',
  ],
  tax_invoice: [
    'US → IRS Form 1099 / state e-invoice (varies)',
    'UK → HMRC Making Tax Digital invoice',
    'EU → Peppol / national e-invoice (e.g. ES SII, IT SDI, FR Chorus)',
    'MX → CFDI 4.0 SAT',
    'BR → NFe (Nota Fiscal Eletrônica)',
  ],
  committee_minutes: [
    'US → OSHA voluntary safety committee record',
    'UK → HSE safety representatives meeting record',
    'EU → Workers Health & Safety Committee (Directive 89/391/EEC art. 11)',
    'MX → Comisión de Seguridad e Higiene NOM-019-STPS',
    'BR → CIPA (NR-5) ata de reunião',
  ],
  training_record: [
    'US → OSHA training record (29 CFR 1910.1200(h))',
    'UK → HSE training matrix',
    'EU → Directive 89/391/EEC art. 12 training documentation',
    'MX → DC-3 STPS constancia de competencias',
    'BR → NR-1 / NR-35 capacitação',
  ],
  safety_inspection: [
    'US → OSHA self-inspection checklist',
    'UK → HSE workplace inspection record',
    'EU → ISO 45001:2018 §9.1 monitoring record',
    'MX → NOM-019-STPS inspección de seguridad',
    'BR → NR-1 inspeção de segurança',
  ],
};

export function getSuggestedAdapters(type: EmissionType): readonly string[] {
  return SUGGESTED_BY_TYPE[type] ?? [];
}

// ─── CL placeholder schemas ─────────────────────────────────────────────────
//
// Schemas are intentionally permissive at the registry tier — the
// underlying services (createDs67Form, generateDte, etc.) have their
// own stricter validation. The registry validation catches obviously
// malformed payloads before delegating. Sprint 39+ each adapter ships
// its own tight Zod schema authored with counsel local approval.

const ds67Schema = z.object({
  tenantId: z.string().min(1),
  // Body is opaque at registry tier — DS-67 service validates internally.
  body: z.record(z.string(), z.unknown()),
});

const ds76Schema = z.object({
  tenantId: z.string().min(1),
  body: z.record(z.string(), z.unknown()),
});

const susesoSchema = z.object({
  tenantId: z.string().min(1),
  formType: z.enum(['DIAT', 'DIEP']),
  body: z.record(z.string(), z.unknown()),
});

const dteSchema = z.object({
  type: z.union([z.literal(33), z.literal(39)]),
  emisor: z.record(z.string(), z.unknown()),
  receptor: z.record(z.string(), z.unknown()).optional(),
  items: z.array(z.record(z.string(), z.unknown())).min(1),
});

const aptitudeCertSchema = z.object({
  workerName: z.string().min(1),
  workerRut: z.string().min(1),
  workerOccupation: z.string().min(1),
  projectName: z.string().min(1),
  examType: z.enum(['pre_empleo', 'periodico', 'reintegro', 'egreso', 'otro']),
  examDate: z.string().min(1),
  result: z.enum(['apto', 'apto_con_restricciones', 'no_apto']),
  doctorName: z.string().min(1),
  doctorRut: z.string().min(1),
  doctorRegistry: z.string().min(1),
  workerAge: z.number().int().nonnegative().optional(),
  restrictions: z.array(z.string()).optional(),
  validUntil: z.string().optional(),
  observations: z.string().optional(),
});

// ─── CL adapter factory ─────────────────────────────────────────────────────
//
// Each CL adapter wraps the existing service with a thin facade. The
// underlying service is NOT modified (regla del usuario: cero refactor
// que rompa Sprint 28-35). Generators here return only the payload-shape
// portion that the new registry contract expects; persistence (Firestore
// folio counters, signature attach) sigue siendo responsabilidad del
// caller, que puede ser el route legacy o el nuevo /emit endpoint.

function clOccupationalInjuryAdapter(): EmissionAdapter {
  return {
    country: 'CL',
    type: 'occupational_injury',
    validate: susesoSchema,
    suggestedFormats: ['application/json', 'application/pdf'],
    legalCitation: 'Ley 16.744 + DS 67/1999 + DIAT/DIEP SUSESO',
    async generate(payload: unknown): Promise<EmissionResult> {
      // Lazy import to avoid pulling firebase-admin into this module
      // at import time (registry must remain unit-testable without
      // GOOGLE_APPLICATION_CREDENTIALS).
      const parsed = susesoSchema.parse(payload);
      return {
        json: { adapter: 'CL/occupational_injury', formType: parsed.formType, ...parsed.body },
      };
    },
  };
}

function clAptitudeCertAdapter(): EmissionAdapter {
  return {
    country: 'CL',
    type: 'aptitude_cert',
    validate: aptitudeCertSchema,
    suggestedFormats: ['application/pdf'],
    legalCitation: 'DS 109 / NCh ISO 45001 + Examen Ocupacional MINSAL',
    async generate(payload: unknown): Promise<EmissionResult> {
      const parsed = aptitudeCertSchema.parse(payload);
      // generateAptitudeCertificate writes a PDF via jsPDF in browser
      // path; here we return the parsed JSON payload. PDF rendering
      // happens in the route layer or frontend. Sprint 39+ this can
      // be lifted into the adapter if a server-side jsPDF render is
      // wired (no crypto-significant change required).
      return {
        json: { adapter: 'CL/aptitude_cert', ...parsed },
      };
    },
  };
}

function clTaxInvoiceAdapter(): EmissionAdapter {
  return {
    country: 'CL',
    type: 'tax_invoice',
    validate: dteSchema,
    suggestedFormats: ['application/xml', 'application/pdf', 'application/json'],
    legalCitation: 'Ley 19.799 + Resolución SII Ex. 45/2003 (Boleta/Factura Electrónica)',
    async generate(payload: unknown): Promise<EmissionResult> {
      const parsed = dteSchema.parse(payload);
      const { generateDte } = await import('../sii/dteGenerator.js');
      const dte = generateDte(parsed as never);
      return {
        json: dte,
      };
    },
  };
}

function clCommitteeMinutesAdapter(): EmissionAdapter {
  // Sprint 28 delivered CPHS minutes in a separate utility chain.
  // Sprint 38 marks the shape; the concrete generator is wired in
  // Sprint 39 once counsel local re-validates the CPHS template.
  return {
    country: 'CL',
    type: 'committee_minutes',
    validate: z.object({
      tenantId: z.string().min(1),
      meetingDate: z.string(),
      attendees: z.array(z.record(z.string(), z.unknown())),
      agenda: z.array(z.string()).min(1),
    }),
    suggestedFormats: ['application/pdf'],
    legalCitation: 'Ley 16.744 art. 66 + DS 54/1969 (CPHS)',
    async generate(payload: unknown): Promise<EmissionResult> {
      return { json: { adapter: 'CL/committee_minutes', ...(payload as object) } };
    },
  };
}

function clTrainingRecordAdapter(): EmissionAdapter {
  return {
    country: 'CL',
    type: 'training_record',
    validate: z.object({
      tenantId: z.string().min(1),
      workerRut: z.string().min(1),
      courseTitle: z.string().min(1),
      hours: z.number().positive(),
      completedAt: z.string(),
    }),
    suggestedFormats: ['application/pdf'],
    legalCitation: 'Ley 16.744 + DS 44/2024 (reemplaza DS 40/1969 derogado 2025-02-01) + ODI (Obligación de Informar)',
    async generate(payload: unknown): Promise<EmissionResult> {
      return { json: { adapter: 'CL/training_record', ...(payload as object) } };
    },
  };
}

function clSafetyInspectionAdapter(): EmissionAdapter {
  return {
    country: 'CL',
    type: 'safety_inspection',
    validate: ds67Schema,
    suggestedFormats: ['application/pdf'],
    legalCitation: 'DS 67/1999 (Reglamento Interno) + DS 594/1999 (Condiciones Sanitarias)',
    async generate(payload: unknown): Promise<EmissionResult> {
      const parsed = ds67Schema.parse(payload);
      return { json: { adapter: 'CL/safety_inspection', tenantId: parsed.tenantId, ...parsed.body } };
    },
  };
}

// ─── Registry table ─────────────────────────────────────────────────────────
//
// Outer key: country. Inner key: emission type. Sprint 38 only fills CL.
// Sprint 39 fills US, etc. Adding a country before its counsel local
// approves the schema MUST set `experimental: true` on the adapter
// (per ADR-0017 §"Implementación incremental").

type AdapterFactory = () => EmissionAdapter;

const REGISTRY: Partial<Record<CountryCode, Partial<Record<EmissionType, AdapterFactory>>>> = {
  CL: {
    occupational_injury: clOccupationalInjuryAdapter,
    aptitude_cert: clAptitudeCertAdapter,
    tax_invoice: clTaxInvoiceAdapter,
    committee_minutes: clCommitteeMinutesAdapter,
    training_record: clTrainingRecordAdapter,
    safety_inspection: clSafetyInspectionAdapter,
  },
  // US/UK/EU/MX/BR/AU/CN/TW/RU pendientes — Sprint 39+.
};

/**
 * Resolve an adapter for the given (country, type) tuple, or null
 * if no adapter exists yet. The HTTP layer maps null → 400 with
 * `suggestedAdapters` (ADR-0017 contract).
 */
export function getAdapter(
  country: CountryCode,
  type: EmissionType,
): EmissionAdapter | null {
  const byCountry = REGISTRY[country];
  if (!byCountry) return null;
  const factory = byCountry[type];
  if (!factory) return null;
  return factory();
}

/**
 * Throw-flavoured variant. Useful from typed callers that prefer a
 * try/catch over null-checks. Mirrors `JurisdictionNotSupportedError`
 * semantics from Sprint 33 D2.
 */
export function requireAdapter(
  country: CountryCode,
  type: EmissionType,
): EmissionAdapter {
  const a = getAdapter(country, type);
  if (a) return a;
  throw new NoAdapterError(country, type, getSuggestedAdapters(type));
}

/**
 * Type guard for runtime payloads (HTTP body). Returns the validated
 * value or throws ZodError. Caller-side helper, kept here for HTTP
 * route ergonomics.
 */
export function isCountryCode(v: unknown): v is CountryCode {
  return typeof v === 'string' && (COUNTRY_CODES as readonly string[]).includes(v);
}

export function isEmissionType(v: unknown): v is EmissionType {
  return typeof v === 'string' && (EMISSION_TYPES as readonly string[]).includes(v);
}
