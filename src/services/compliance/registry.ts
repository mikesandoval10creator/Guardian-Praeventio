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

// _ds76Schema was previously used by clSafetyInspectionAdapter (Sprint 38 passthrough).
// Kept for reference; may be used when a DS-76 specific adapter ships (Sprint 40).
const _ds76Schema = z.object({
  tenantId: z.string().min(1),
  body: z.record(z.string(), z.unknown()),
});

// _susesoSchema (opaque body) was the previous Sprint 38 stub for occupational_injury.
// Replaced by susesoFullSchema below which validates the complete SUSESO form.
// Kept for reference; remove when Sprint 40 confirms no callers remain.
const _susesoSchema = z.object({
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
// Each CL adapter wraps an existing service. The underlying services are
// NOT modified (regla del usuario: cero refactor que rompa Sprint 28-35).
// All adapters follow CLAUDE.md directives:
//   • NO push to SUSESO/MUTUAL/SII — adapters return documents locally.
//   • NO bloquear maquinaria — adapters only emit documents.
//   • Anti-stub (rule 13): adapters that lack a real server-side generator
//     are gated behind HTTP 503 by the route (NOT by returning fake data).
//
// Wiring map (this sprint):
//   occupational_injury → createSusesoForm (suseso/susesoService.ts) — real folio + PDF + hash
//   aptitude_cert       → generateAptitudeCertificateBytes (utils/aptitudeCertificate.ts) — real PDF bytes
//   tax_invoice         → generateDte (sii/dteGenerator.ts) — already wired (unchanged)
//   committee_minutes   → renderLegalDoc CPHS_ACTA (documents/legalDocTemplates.ts) — real markdown doc
//   training_record     → renderLegalDoc ODI (documents/legalDocTemplates.ts) — real markdown doc
//   safety_inspection   → 503-gated: no server-side checklist-PDF generator yet
//                         (checklistBuilder.ts produces JSON schema; server-side PDF
//                          render requires pdfkit integration, Sprint 40+).
//                         Registered in docs/stubs-inventory.md per CLAUDE.md #13.

// ─── Zod schema for occupational_injury (real SUSESO shape) ─────────────────
//
// The susesoSchema above is opaque (body: Record<string, unknown>). For the
// real generator we need the full SUSESO form fields. This schema validates
// the wider shape before delegating to createSusesoForm.
const susesoFullSchema = z.object({
  tenantId: z.string().min(1),
  formType: z.enum(['DIAT', 'DIEP']),
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
  publicBaseUrl: z.string().optional(),
});

function clOccupationalInjuryAdapter(): EmissionAdapter {
  return {
    country: 'CL',
    type: 'occupational_injury',
    validate: susesoFullSchema,
    suggestedFormats: ['application/json', 'application/pdf'],
    legalCitation: 'Ley 16.744 art. 76 + DS 101/1968 (DIAT) + DS 110/1968 (DIEP) + SUSESO DIAT/DIEP',
    async generate(payload: unknown): Promise<EmissionResult> {
      // Lazy imports: firebase-admin must NOT be imported at module load time
      // (registry must remain unit-testable without GOOGLE_APPLICATION_CREDENTIALS).
      const parsed = susesoFullSchema.parse(payload);
      const { createSusesoForm, folioToDocId } = await import('../suseso/susesoService.js');
      // folioGenerator is imported transitively by susesoService — imported
      // here only to keep the dependency explicit (linter: no-unused-vars).
      await import('../suseso/folioGenerator.js');

      // Build the minimal Firestore adapters. In unit tests these deps
      // are provided by the test via payload injection or the route mocks
      // firebase-admin before calling this module.
      const adminModule = await import('firebase-admin');
      const adminFirestore = adminModule.default.firestore();

      // MinimalFolioStore adapter wrapping admin.firestore()
      const folioStore: import('./../../services/suseso/folioGenerator.js').MinimalFolioStore = {
        async runTransaction(fn) {
          return adminFirestore.runTransaction(async (tx) => {
            return fn({
              async get(path: string) {
                const ref = adminFirestore.doc(path);
                const snap = await tx.get(ref);
                return snap.exists
                  ? { exists: true as const, data: snap.data() as { lastSeq?: number } }
                  : { exists: false as const };
              },
              set(path: string, value: { lastSeq: number }) {
                tx.set(adminFirestore.doc(path), value);
              },
            });
          }) as ReturnType<typeof fn>;
        },
      };

      // MinimalFormStore adapter
      const formsPath = (tid: string) =>
        adminFirestore.collection('tenants').doc(tid).collection('suseso_forms');
      const formStore = {
        async saveForm(tenantId: string, formId: string, form: unknown) {
          await formsPath(tenantId).doc(formId).set(form as object);
        },
        async loadForm(tenantId: string, formId: string) {
          const snap = await formsPath(tenantId).doc(formId).get();
          return snap.exists ? snap.data() : null;
        },
        async findFormByFolio(folio: string) {
          const snap = await adminFirestore
            .collectionGroup('suseso_forms')
            .where('folio', '==', folio)
            .limit(1)
            .get();
          if (snap.empty) return null;
          const doc = snap.docs[0];
          const tenantId = doc.ref.parent.parent?.id ?? '';
          return { tenantId, formId: doc.id, form: doc.data() };
        },
        async attachSignature(tenantId: string, formId: string, signature: unknown) {
          const ref = formsPath(tenantId).doc(formId);
          await ref.update({ signature });
          const snap = await ref.get();
          return snap.data();
        },
      };

      const result = await createSusesoForm(
        {
          tenantId: parsed.tenantId,
          kind: parsed.formType,
          workerRut: parsed.workerRut,
          workerFullName: parsed.workerFullName,
          companyRut: parsed.companyRut,
          companyName: parsed.companyName,
          mutualidad: parsed.mutualidad,
          incidentDate: parsed.incidentDate,
          incidentDescription: parsed.incidentDescription,
          incidentLocation: parsed.incidentLocation,
          bodyPartsAffected: parsed.bodyPartsAffected,
          incidentClassification: parsed.incidentClassification,
          ds101Causal: parsed.ds101Causal,
          ds110Causal: parsed.ds110Causal,
          witnesses: parsed.witnesses,
          reportedBy: parsed.reportedBy,
        },
        {
          folioStore: folioStore as Parameters<typeof createSusesoForm>[1]['folioStore'],
          formStore: formStore as Parameters<typeof createSusesoForm>[1]['formStore'],
          publicBaseUrl: parsed.publicBaseUrl,
        },
      );

      // Convert Uint8Array → base64 for JSON transport.
      const pdfBase64 = Buffer.from(result.pdfBytes).toString('base64');

      return {
        json: {
          form: result.form,
          payloadHashHex: result.payloadHashHex,
          qrCodeUrl: result.qrCodeUrl,
          formId: folioToDocId(result.form.folio),
        },
        pdfBase64,
        folio: result.form.folio,
      };
    },
  };
}

function clAptitudeCertAdapter(): EmissionAdapter {
  return {
    country: 'CL',
    type: 'aptitude_cert',
    validate: aptitudeCertSchema,
    suggestedFormats: ['application/pdf', 'application/json'],
    legalCitation: 'DS 109 / NCh ISO 45001 + Examen Ocupacional MINSAL',
    async generate(payload: unknown): Promise<EmissionResult> {
      const parsed = aptitudeCertSchema.parse(payload);
      // generateAptitudeCertificateBytes produces real PDF bytes via jsPDF
      // (server-safe: uses output('arraybuffer'), does NOT call doc.save()).
      const { generateAptitudeCertificateBytes } = await import('../../utils/aptitudeCertificate.js');
      const { bytes } = generateAptitudeCertificateBytes({
        workerName: parsed.workerName,
        workerRut: parsed.workerRut,
        workerAge: parsed.workerAge,
        workerOccupation: parsed.workerOccupation,
        projectName: parsed.projectName,
        examType: parsed.examType,
        examDate: parsed.examDate,
        result: parsed.result,
        restrictions: parsed.restrictions,
        validUntil: parsed.validUntil,
        doctorName: parsed.doctorName,
        doctorRut: parsed.doctorRut,
        doctorRegistry: parsed.doctorRegistry,
        observations: parsed.observations,
      });
      const pdfBase64 = Buffer.from(bytes).toString('base64');
      return {
        json: parsed,
        pdfBase64,
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

const committeeMinutesSchema = z.object({
  tenantId: z.string().min(1),
  meetingDate: z.string().min(1),
  companyName: z.string().min(1),
  projectName: z.string().min(1),
  attendees: z.array(z.string()).min(1),
  agenda: z.array(z.string()).min(1),
  agreements: z.string().min(1),
  nextMeetingDate: z.string().optional(),
});

function clCommitteeMinutesAdapter(): EmissionAdapter {
  return {
    country: 'CL',
    type: 'committee_minutes',
    validate: committeeMinutesSchema,
    suggestedFormats: ['application/json'],
    legalCitation: 'Ley 16.744 art. 66 + DS 44/2024 (ex DS 54, derogado 01-02-2025) — CPHS',
    async generate(payload: unknown): Promise<EmissionResult> {
      const parsed = committeeMinutesSchema.parse(payload);
      const { renderLegalDoc } = await import('../documents/legalDocTemplates.js');
      const rendered = renderLegalDoc({
        kind: 'CPHS_ACTA',
        data: {
          meetingDate: parsed.meetingDate,
          companyName: parsed.companyName,
          projectName: parsed.projectName,
          attendees: parsed.attendees.join('\n'),
          agenda: parsed.agenda.map((item, i) => `${i + 1}. ${item}`).join('\n'),
          agreements: parsed.agreements,
          nextMeetingDate: parsed.nextMeetingDate ?? '—',
        },
      });
      if (!rendered.ok) {
        throw new Error(
          `CPHS_ACTA template failed — missing tokens: ${rendered.missingTokens?.join(', ')}`,
        );
      }
      return {
        json: {
          tenantId: parsed.tenantId,
          meetingDate: parsed.meetingDate,
          markdown: rendered.markdown,
          legalReferences: rendered.references,
          generatedAt: new Date().toISOString(),
        },
      };
    },
  };
}

const trainingRecordSchema = z.object({
  tenantId: z.string().min(1),
  workerName: z.string().min(1),
  workerRut: z.string().min(1),
  courseTitle: z.string().min(1),
  hours: z.number().positive(),
  completedAt: z.string().min(1),
  companyName: z.string().min(1),
  supervisorName: z.string().optional(),
});

function clTrainingRecordAdapter(): EmissionAdapter {
  return {
    country: 'CL',
    type: 'training_record',
    validate: trainingRecordSchema,
    suggestedFormats: ['application/json'],
    legalCitation: 'Ley 16.744 art. 21 + DS 44/2024 (reemplaza DS 40/1969 derogado 2025-02-01) + ODI (Obligación de Informar)',
    async generate(payload: unknown): Promise<EmissionResult> {
      const parsed = trainingRecordSchema.parse(payload);
      const { renderLegalDoc } = await import('../documents/legalDocTemplates.js');
      const rendered = renderLegalDoc({
        kind: 'ODI',
        data: {
          workerName: parsed.workerName,
          workerRut: parsed.workerRut,
          position: parsed.courseTitle,
          companyName: parsed.companyName,
          date: parsed.completedAt,
          specificRisks: `Capacitación completada: ${parsed.courseTitle} (${parsed.hours} horas). Registro generado conforme DS 44/2024 art. 19.`,
          supervisor: parsed.supervisorName ?? '',
        },
      });
      if (!rendered.ok) {
        throw new Error(
          `ODI template failed — missing tokens: ${rendered.missingTokens?.join(', ')}`,
        );
      }
      return {
        json: {
          tenantId: parsed.tenantId,
          workerRut: parsed.workerRut,
          workerName: parsed.workerName,
          courseTitle: parsed.courseTitle,
          hours: parsed.hours,
          completedAt: parsed.completedAt,
          markdown: rendered.markdown,
          legalReferences: rendered.references,
          generatedAt: new Date().toISOString(),
        },
      };
    },
  };
}

function clSafetyInspectionAdapter(): EmissionAdapter {
  // TODO(sprint-40): wire to server-side checklist-PDF generator once
  // checklistBuilder.ts + pdfkit integration is complete. The
  // checklistBuilder produces JSON schemas (not PDF bytes); a pdfkit
  // render layer is needed server-side.
  // Registered in docs/stubs-inventory.md per CLAUDE.md #13.
  //
  // This adapter is 503-gated at the route layer — it deliberately does
  // NOT return fake/passthrough data (CLAUDE.md #13 anti-stub rule).
  return {
    country: 'CL',
    type: 'safety_inspection',
    validate: ds67Schema,
    suggestedFormats: ['application/pdf'],
    legalCitation: 'DS 594/1999 (Condiciones Sanitarias) + DS 44/2024 (reemplaza DS 40/1969 derogado 2025-02-01) + NCh ISO 45001 §9.1',
    async generate(_payload: unknown): Promise<EmissionResult> {
      // 503 gate: the real checklist-PDF builder requires pdfkit on the
      // server which is not yet integrated. Do NOT return passthrough JSON
      // (anti-stub per CLAUDE.md #13). The route maps this error to 503.
      const err = new Error(
        'safety_inspection PDF generator not yet available server-side (Sprint 40). ' +
        'Use the mobile checklist builder UI which renders the PDF client-side.',
      );
      (err as Error & { code: string }).code = 'not_implemented_503';
      throw err;
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
