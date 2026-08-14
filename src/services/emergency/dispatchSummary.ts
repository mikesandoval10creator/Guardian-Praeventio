// Praeventio Guard — [P1][VIDA] Paquete de datos para despacho de
// emergencia (patrón RapidSOS → servicios Chile).
//
// Inspired by RapidSOS Emergency Response API and Uber Safety Toolkit.
// The IDEA is that when a dispatcher escalates an emergency, the human
// on the other end of the call benefits from a tight, structured
// summary: who, where, what, when, plus any consensual medical data
// the worker agreed to share. We do NOT auto-dial (false-alarm risk + a
// human must always be in the loop per guardian's "autoridad = humano
// decide" principle). The summary is human-readable TEXT the operator
// can read aloud before dialing 131 / 132 / 133.
//
// Deterministic pure helper, no IO, no LLM. Component layer owns
// clipboard / SMS / open-in-maps rendering; this module owns the
// textual contract.
//
// PII discipline: every medical field is OPTIONAL and only included
// if the worker has explicitly consented. The summary body is rendered
// even when consent is empty (the SafeTripDispatch case) so the
// dispatcher ALWAYS has the location + project + event type.

import { z } from "zod";

/**
 * Coordinates as captured by the device at the moment of escalation.
 * Redacted to 4 decimal places (≈ 11 m) — the dispatcher's responder
 * needs a block, not a survey-grade fix.
 */
export interface DispatchCoords {
  lat: number;
  lng: number;
  /** Optional WGS-84 altitude in metres; rarely available. */
  altitude?: number | null;
}

/**
 * Medical data the worker has explicitly consented to share. Each field
 * is OPTIONAL (the consent grants a CATEGORY, not a literal field). The
 * dispatcher only sees what the worker chose to upload.
 */
export interface ConsentedMedicalProfile {
  /** ISO 5218 biological sex: 'female' | 'male' | 'intersex' | null. */
  sex?: "female" | "male" | "intersex" | null;
  /** Approximate age in years. Never store the full birthday. */
  ageYears?: number | null;
  /** Blood type + Rh factor, e.g. 'O+', 'A-', 'AB+'. */
  bloodType?: string | null;
  /** Free-form medication list. Capped at 200 chars by the schema. */
  medications?: string | null;
  /** Free-form allergy list. Capped at 200 chars by the schema. */
  allergies?: string | null;
  /** Pre-existing conditions the worker flagged. Optional. */
  conditions?: string | null;
  /** Emergency contact name. */
  emergencyContactName?: string | null;
  /** Emergency contact phone (E.164 international). */
  emergencyContactPhone?: string | null;
}

/**
 * The minimal payload required to render a dispatch summary. Everything
 * else is optional. This is the schema the supervisor panel AND the
 * audit log build from.
 */
export const DispatchSummaryInputSchema = z.object({
  projectId: z.string().min(1).max(200),
  projectName: z.string().min(1).max(200),
  workerUid: z.string().min(1).max(200),
  workerFullName: z.string().min(1).max(200),
  workerRut: z.string().min(1).max(20),
  /** ISO 4210-style timestamp. Optional — rendered as "hace 2 min" if so. */
  detectedAt: z.date(),
  /** Coarse event type for the dispatcher's GIST. */
  eventType: z.enum([
    "manDown",
    "sos",
    "fall",
    "gas_alert",
    "evacuation",
    "cardiac",
    "other",
  ]),
  /** Optional human-readable role / area of the worker. */
  workerRole: z.string().max(120).optional(),
  workerCoords: z.object({
    lat: z.number(),
    lng: z.number(),
    altitude: z.number().nullable().optional(),
  }),
  /** Free-form additional copy. e.g. "accidente vehicular en faena". */
  eventNotes: z.string().max(500).optional(),
  /** Region code (ISO 3166-1 alpha-2) — populates the country header. */
  regionCode: z.string().length(2),
  /** Consented medical data — never rendered if absent. Optional. */
  medical: z
    .object({
      sex: z.enum(["female", "male", "intersex"]).nullable().optional(),
      ageYears: z.number().int().min(0).max(130).nullable().optional(),
      bloodType: z.string().max(8).nullable().optional(),
      medications: z.string().max(200).nullable().optional(),
      allergies: z.string().max(200).nullable().optional(),
      conditions: z.string().max(200).nullable().optional(),
      emergencyContactName: z.string().max(120).nullable().optional(),
      emergencyContactPhone: z.string().max(30).nullable().optional(),
    })
    .partial()
    .optional(),
});

export type DispatchSummaryInput = z.infer<typeof DispatchSummaryInputSchema>;

/**
 * Localised label text — same keys the component i18n already ships
 * (en, es-CL, pt-BR). Centralised here so the dispatch summary stays
 * a pure function of (input, locale) and can be rendered server-side.
 */
export interface DispatchSummaryLabels {
  title: string;
  project: string;
  worker: string;
  workerRole: string;
  location: string;
  detectedAt: string;
  elapsedMinutes: string;
  eventType: string;
  notes: string;
  medicalHeader: string;
  bloodType: string;
  allergies: string;
  medications: string;
  conditions: string;
  emergencyContact: string;
  humanInTheLoop: string;
  eventTypeMap: Record<DispatchSummaryInput["eventType"], string>;
}

export const esCLLabels: DispatchSummaryLabels = {
  title: "EMERGENCIA — Paquete de despacho",
  project: "Proyecto",
  worker: "Trabajador",
  workerRole: "Rol",
  location: "Ubicación",
  detectedAt: "Detectado",
  elapsedMinutes: "Tiempo desde detección",
  eventType: "Tipo de evento",
  notes: "Notas",
  medicalHeader: "Datos médicos (consentidos)",
  bloodType: "Grupo sanguíneo",
  allergies: "Alérgenos",
  medications: "Medicamentos",
  conditions: "Condiciones preexistentes",
  emergencyContact: "Contacto de emergencia",
  humanInTheLoop:
    "El despacho NUNCA se ejecuta automáticamente. Una persona debe llamar al servicio de urgencia correspondiente.",
  eventTypeMap: {
    manDown: "Posible caída (ManDown automático)",
    sos: "SOS activado por el trabajador",
    fall: "Caída detectada",
    gas_alert: "Alerta de gas",
    evacuation: "Evacuación en curso",
    cardiac: "Emergencia cardíaca",
    other: "Otro evento",
  },
};

/**
 * Pure helper — no IO, no LLM. Returns the human-readable summary.
 *
 * The summary is intentionally SHORT (one screen of mobile text) so the
 * dispatcher can read it in the 5-10 seconds before dialing. Every
 * field that we don't have is omitted, not blanked.
 */
export function formatDispatchSummary(
  input: DispatchSummaryInput,
  labels: DispatchSummaryLabels = esCLLabels,
  now: Date = new Date(),
): string {
  const lines: string[] = [];
  lines.push(`🚨 ${labels.title}`);
  lines.push("");
  lines.push(
    `${labels.project}: ${input.projectName} (id: ${input.projectId})`,
  );
  lines.push(
    `${labels.worker}: ${input.workerFullName} (RUT ${input.workerRut})`,
  );
  if (input.workerRole) {
    lines.push(`${labels.workerRole}: ${input.workerRole}`);
  }
  lines.push(
    `${labels.location}: ${formatCoords(input.workerCoords)} (${input.regionCode})`,
  );
  lines.push(
    `${labels.detectedAt}: ${formatLocalTime(input.detectedAt)} (${formatElapsed(
      input.detectedAt,
      now,
    )})`,
  );
  lines.push(`${labels.eventType}: ${labels.eventTypeMap[input.eventType]}`);
  if (input.eventNotes) {
    lines.push(`${labels.notes}: ${input.eventNotes}`);
  }

  // Medical data — every line is conditional. No consent → no medical
  // block at all. This is the Ley 21.719 minimisation principle.
  const medical = input.medical ?? {};
  const medicalLines: string[] = [];
  if (medical.bloodType) {
    medicalLines.push(`  - ${labels.bloodType}: ${medical.bloodType}`);
  }
  if (medical.allergies) {
    medicalLines.push(`  - ${labels.allergies}: ${medical.allergies}`);
  }
  if (medical.medications) {
    medicalLines.push(`  - ${labels.medications}: ${medical.medications}`);
  }
  if (medical.conditions) {
    medicalLines.push(`  - ${labels.conditions}: ${medical.conditions}`);
  }
  if (medical.emergencyContactName || medical.emergencyContactPhone) {
    const parts = [medical.emergencyContactName, medical.emergencyContactPhone]
      .filter(Boolean)
      .join(" · ");
    medicalLines.push(`  - ${labels.emergencyContact}: ${parts}`);
  }
  if (medicalLines.length > 0) {
    lines.push("");
    lines.push(labels.medicalHeader + ":");
    lines.push(...medicalLines);
  }

  lines.push("");
  lines.push(`— ${labels.humanInTheLoop}`);

  return lines.join("\n");
}

function formatCoords(c: DispatchCoords): string {
  const lat = c.lat.toFixed(4);
  const lng = c.lng.toFixed(4);
  const altSuffix = c.altitude != null ? `, ${c.altitude.toFixed(0)} m` : "";
  return `${lat}, ${lng}${altSuffix}`;
}

function formatLocalTime(d: Date): string {
  // YYYY-MM-DD HH:mm:ss local. Locale-agnostic because the dispatcher
  // may be in a different country and we want numbers without ambiguity.
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/**
 * "hace 2 min 15 s" / "hace 12 s" / "hace 3 h 5 min". The dispatcher
 * needs a relative timestamp so they can say "hace 3 min" to the
 * operator who answers the call.
 */
export function formatElapsed(from: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - from.getTime());
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours} h ${minutes} min`;
  }
  if (minutes > 0) {
    return `${minutes} min ${seconds} s`;
  }
  return `${seconds} s`;
}

/**
 * Sentinel for the audit log writer. The endpoint that calls
 * `formatDispatchSummary` should ALSO write a `medical_emergency_dispatch`
 * row to `audit_logs` (RUT, worker_uid, project_id, regionCode, eventType,
 * includedMedicalFields[], summaryLength, generatedAt). The summary
 * itself is NOT written — it may contain PII the audit log should not
 * retain. The structured parameters are.
 */
export interface DispatchAuditFields {
  projectId: string;
  workerUid: string;
  regionCode: string;
  eventType: DispatchSummaryInput["eventType"];
  includedMedicalFields: string[];
  summaryLength: number;
  generatedAt: Date;
}

export function inferDispatchAuditFields(
  input: DispatchSummaryInput,
  summary: string,
  generatedAt: Date = new Date(),
): DispatchAuditFields {
  const medical = input.medical ?? {};
  const includedMedicalFields: string[] = [];
  if (medical.bloodType) includedMedicalFields.push("bloodType");
  if (medical.allergies) includedMedicalFields.push("allergies");
  if (medical.medications) includedMedicalFields.push("medications");
  if (medical.conditions) includedMedicalFields.push("conditions");
  if (medical.emergencyContactName || medical.emergencyContactPhone) {
    includedMedicalFields.push("emergencyContact");
  }
  return {
    projectId: input.projectId,
    workerUid: input.workerUid,
    regionCode: input.regionCode,
    eventType: input.eventType,
    includedMedicalFields,
    summaryLength: summary.length,
    generatedAt,
  };
}
