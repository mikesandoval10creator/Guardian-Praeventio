// Praeventio Guard — Sprint 42 Fase F.18: Historial Profesional Portátil.
//
// Cierra Plan F.18 "Historial Profesional Portátil (export subgrafo trabajador)".
//
// Construye un export portátil del subgrafo profesional del trabajador
// (identidad, spans laborales, capacitaciones, certificaciones, EPP,
// exposición agregada, contexto médico opcional) bajo el principio de
// soberanía de datos (ADR 0012): el trabajador es DUEÑO ABSOLUTO de
// su información y decide qué nivel de detalle compartir.
//
// Cumplimiento Ley 19.628 (Chile) — datos personales:
//   - Consentimiento explícito vía nivel de redacción.
//   - Minimización: 'public' < 'employer' < 'medical' (orden creciente).
//   - Trazabilidad: checksum SHA-256 sobre JSON canónico para no-repudio.
//
// ANTI-pattern ADR 0012:
//   - `medicalContext` NUNCA se exporta a menos que `includeMedical: true`
//     explícitamente Y `redactionLevel === 'medical'`. El default es REDACTED.
//   - La app NO diagnostica — solo organiza y entrega para que el trabajador
//     lo lleve a su médico tratante.
//
// 100% determinístico. Sin LLM. Sin I/O.

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type RedactionLevel = 'public' | 'employer' | 'medical';

export interface WorkerIdentity {
  /** Nombre completo del trabajador. */
  fullName: string;
  /** RUT chileno SIN formatear (e.g. '12345678-9'). */
  rut: string;
  /** Año de nacimiento (no fecha exacta para minimización). */
  birthYear?: number;
  /** Email de contacto (opcional). */
  email?: string;
}

export interface EmploymentSpan {
  employerName: string;
  /** ISO date 'YYYY-MM-DD'. */
  startDate: string;
  /** ISO date o null si sigue activo. */
  endDate: string | null;
  /** Cargo / rol. */
  position: string;
  /** Industria / rubro (e.g. 'minería', 'construcción'). */
  industry: string;
}

export interface TrainingRecord {
  trainingCode: string;
  trainingName: string;
  /** ISO date de obtención. */
  obtainedAt: string;
  /** ISO date de expiración o null si no expira. */
  expiresAt: string | null;
  /** Institución certificadora. */
  issuer: string;
  /** Horas cronológicas. */
  hours: number;
}

export interface CertificationRecord {
  certificationCode: string;
  certificationName: string;
  obtainedAt: string;
  expiresAt: string | null;
  issuer: string;
  /** Número de folio / serie del certificado. */
  folio?: string;
}

export interface EppRecord {
  eppCategory: string;
  eppModel: string;
  deliveredAt: string;
  /** ISO date de reposición sugerida. */
  nextReplacementAt: string | null;
}

export interface ExposureLogEntry {
  /** Agente de riesgo (e.g. 'ruido', 'polvo_sílice', 'altura'). */
  agent: string;
  /** Horas acumuladas de exposición. */
  totalHours: number;
  /** Año de la agregación. */
  year: number;
  /** Promedio del agente medido (e.g. dB(A) para ruido). */
  averageMeasurement?: number;
  /** Unidad del measurement. */
  measurementUnit?: string;
}

export interface MedicalContextEntry {
  /** Categoría general (e.g. 'aptitud_ocupacional', 'audiometria'). */
  category: string;
  /** Resumen textual cargado por el trabajador o subido vía QR. */
  summary: string;
  /** ISO date. */
  recordedAt: string;
  /** Médico tratante / institución (opcional). */
  source?: string;
}

export interface WorkerData {
  identity: WorkerIdentity;
  employmentSpans: EmploymentSpan[];
  completedTrainings: TrainingRecord[];
  certifications: CertificationRecord[];
  eppHistory: EppRecord[];
  exposureLog: ExposureLogEntry[];
  /** Datos médicos — SOLO se exportan con consentimiento explícito. */
  medicalContext?: MedicalContextEntry[];
}

export interface BuildOptions {
  /**
   * Si false (default), `medicalContext` se omite por completo del export.
   * Sólo se incluye cuando es true Y `redactionLevel === 'medical'`.
   */
  includeMedical?: boolean;
  redactionLevel: RedactionLevel;
  /** ISO date del momento del export (inyectado para determinismo). */
  exportedAt: string;
  /** Quién solicita el export (uid + tipo). */
  requestedBy: {
    uid: string;
    role: 'self' | 'employer' | 'physician' | 'inspector';
  };
}

export interface PortableWorkerHistory {
  schemaVersion: '1.0.0';
  exportedAt: string;
  redactionLevel: RedactionLevel;
  includesMedical: boolean;
  requestedBy: BuildOptions['requestedBy'];
  identity: {
    fullName: string;
    /** SHA-256 hex del RUT — siempre hasheado, nunca el RUT en claro. */
    rutHash: string;
    /** RUT en claro SÓLO cuando level !== 'public'. */
    rut?: string;
    birthYear?: number;
    email?: string;
  };
  employmentSpans: EmploymentSpan[];
  completedTrainings: TrainingRecord[];
  certifications: CertificationRecord[];
  eppHistory: EppRecord[];
  exposureLog: ExposureLogEntry[];
  /** REDACTED cuando includeMedical=false o level !== 'medical'. */
  medicalContext: MedicalContextEntry[] | 'REDACTED';
  /** Disclaimer ADR 0012 — siempre presente. */
  disclaimer: string;
}

export interface SerializedExport {
  /** Contenido serializado (JSON canónico o Markdown). */
  body: string;
  /** SHA-256 hex sobre `body`. */
  checksum: string;
  /** MIME type. */
  contentType: 'application/json' | 'text/markdown';
}

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────

const ADR_0012_DISCLAIMER =
  'Praeventio nunca diagnostica. Este export es la cartera profesional ' +
  'portable del trabajador. La información médica (si está presente) se ' +
  'organiza para compartirse con el médico tratante, quien hará el ' +
  'diagnóstico, tratamiento y calificación legal correspondiente. ' +
  'Ley 19.628: este documento contiene datos personales — usar sólo para ' +
  'el fin autorizado por el trabajador.';

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function hashUtf8(input: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}

/** Redacta una fecha ISO 'YYYY-MM-DD' a sólo año-mes para nivel 'public'. */
function redactDateToYearMonth(iso: string | null): string | null {
  if (iso === null) return null;
  // Mantiene 'YYYY-MM' si tiene shape esperado, sino devuelve el original.
  const match = /^(\d{4}-\d{2})-\d{2}/.exec(iso);
  return match ? `${match[1]}-XX` : iso;
}

// ────────────────────────────────────────────────────────────────────────
// Build
// ────────────────────────────────────────────────────────────────────────

export function buildPortableHistory(
  worker: WorkerData,
  options: BuildOptions,
): PortableWorkerHistory {
  const level = options.redactionLevel;
  const includeMedical = options.includeMedical === true;
  const medicalAllowed = includeMedical && level === 'medical';

  const rutHash = hashUtf8(worker.identity.rut);

  const identity: PortableWorkerHistory['identity'] = {
    fullName: worker.identity.fullName,
    rutHash,
  };
  if (level !== 'public') {
    identity.rut = worker.identity.rut;
    if (worker.identity.birthYear !== undefined) identity.birthYear = worker.identity.birthYear;
    if (worker.identity.email !== undefined) identity.email = worker.identity.email;
  }

  // Para 'public': redactamos fechas exactas a YYYY-MM-XX.
  const redactSpans = (spans: EmploymentSpan[]): EmploymentSpan[] => {
    if (level !== 'public') return spans;
    return spans.map((s) => ({
      ...s,
      startDate: redactDateToYearMonth(s.startDate) ?? s.startDate,
      endDate: redactDateToYearMonth(s.endDate),
    }));
  };

  const redactTrainings = (trainings: TrainingRecord[]): TrainingRecord[] => {
    if (level !== 'public') return trainings;
    return trainings.map((t) => ({
      ...t,
      obtainedAt: redactDateToYearMonth(t.obtainedAt) ?? t.obtainedAt,
      expiresAt: redactDateToYearMonth(t.expiresAt),
    }));
  };

  const redactCerts = (certs: CertificationRecord[]): CertificationRecord[] => {
    if (level !== 'public') return certs;
    return certs.map((c) => {
      const { folio: _folio, ...rest } = c;
      return {
        ...rest,
        obtainedAt: redactDateToYearMonth(c.obtainedAt) ?? c.obtainedAt,
        expiresAt: redactDateToYearMonth(c.expiresAt),
      };
    });
  };

  const redactEpp = (epp: EppRecord[]): EppRecord[] => {
    if (level !== 'public') return epp;
    return epp.map((e) => ({
      ...e,
      deliveredAt: redactDateToYearMonth(e.deliveredAt) ?? e.deliveredAt,
      nextReplacementAt: redactDateToYearMonth(e.nextReplacementAt),
    }));
  };

  const history: PortableWorkerHistory = {
    schemaVersion: '1.0.0',
    exportedAt: options.exportedAt,
    redactionLevel: level,
    includesMedical: medicalAllowed,
    requestedBy: options.requestedBy,
    identity,
    employmentSpans: redactSpans(worker.employmentSpans),
    completedTrainings: redactTrainings(worker.completedTrainings),
    certifications: redactCerts(worker.certifications),
    eppHistory: redactEpp(worker.eppHistory),
    exposureLog: [...worker.exposureLog],
    medicalContext: medicalAllowed ? [...(worker.medicalContext ?? [])] : 'REDACTED',
    disclaimer: ADR_0012_DISCLAIMER,
  };

  return history;
}

// ────────────────────────────────────────────────────────────────────────
// Redaction (post-build, idempotente)
// ────────────────────────────────────────────────────────────────────────

/**
 * Aplica un nivel de redacción a un history ya construido. Idempotente:
 * bajar de 'medical' → 'public' tacha datos sensibles. Subir no recupera
 * datos que ya fueron tachados — eso requiere reconstruir desde WorkerData.
 */
export function redactPII(
  history: PortableWorkerHistory,
  level: RedactionLevel,
): PortableWorkerHistory {
  const next: PortableWorkerHistory = JSON.parse(JSON.stringify(history));
  next.redactionLevel = level;

  if (level === 'public') {
    next.identity = {
      fullName: next.identity.fullName,
      rutHash: next.identity.rutHash,
    };
    next.employmentSpans = next.employmentSpans.map((s) => ({
      ...s,
      startDate: redactDateToYearMonth(s.startDate) ?? s.startDate,
      endDate: redactDateToYearMonth(s.endDate),
    }));
    next.completedTrainings = next.completedTrainings.map((t) => ({
      ...t,
      obtainedAt: redactDateToYearMonth(t.obtainedAt) ?? t.obtainedAt,
      expiresAt: redactDateToYearMonth(t.expiresAt),
    }));
    next.certifications = next.certifications.map((c) => {
      const { folio: _f, ...rest } = c;
      return {
        ...rest,
        obtainedAt: redactDateToYearMonth(c.obtainedAt) ?? c.obtainedAt,
        expiresAt: redactDateToYearMonth(c.expiresAt),
      };
    });
    next.eppHistory = next.eppHistory.map((e) => ({
      ...e,
      deliveredAt: redactDateToYearMonth(e.deliveredAt) ?? e.deliveredAt,
      nextReplacementAt: redactDateToYearMonth(e.nextReplacementAt),
    }));
  }

  if (level !== 'medical') {
    next.medicalContext = 'REDACTED';
    next.includesMedical = false;
  }

  return next;
}

// ────────────────────────────────────────────────────────────────────────
// Serialization — JSON canónico
// ────────────────────────────────────────────────────────────────────────

/**
 * Stringify estable: ordena las keys alfabéticamente en todos los niveles
 * para que el checksum sea reproducible. NO se usa indentación.
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`)
    .join(',')}}`;
}

export function serializeAsJson(history: PortableWorkerHistory): SerializedExport {
  const body = canonicalStringify(history);
  const checksum = hashUtf8(body);
  return { body, checksum, contentType: 'application/json' };
}

// ────────────────────────────────────────────────────────────────────────
// Serialization — Markdown human-readable
// ────────────────────────────────────────────────────────────────────────

function mdSection(title: string, body: string): string {
  return `## ${title}\n\n${body}\n`;
}

function mdTrainings(trainings: TrainingRecord[]): string {
  if (trainings.length === 0) return '_Sin capacitaciones registradas._';
  return trainings
    .map(
      (t) =>
        `- **${t.trainingName}** (${t.trainingCode}) — ${t.issuer}, ${t.hours}h. ` +
        `Obtenido: ${t.obtainedAt}${t.expiresAt ? `, expira: ${t.expiresAt}` : ''}.`,
    )
    .join('\n');
}

function mdCerts(certs: CertificationRecord[]): string {
  if (certs.length === 0) return '_Sin certificaciones registradas._';
  return certs
    .map(
      (c) =>
        `- **${c.certificationName}** (${c.certificationCode}) — ${c.issuer}. ` +
        `Obtenida: ${c.obtainedAt}${c.expiresAt ? `, expira: ${c.expiresAt}` : ''}` +
        `${c.folio ? `, folio ${c.folio}` : ''}.`,
    )
    .join('\n');
}

function mdSpans(spans: EmploymentSpan[]): string {
  if (spans.length === 0) return '_Sin historial laboral registrado._';
  return spans
    .map(
      (s) =>
        `- **${s.position}** en ${s.employerName} (${s.industry}). ` +
        `Desde ${s.startDate}${s.endDate ? ` hasta ${s.endDate}` : ' — activo'}.`,
    )
    .join('\n');
}

function mdEpp(epp: EppRecord[]): string {
  if (epp.length === 0) return '_Sin EPP registrado._';
  return epp
    .map(
      (e) =>
        `- ${e.eppCategory} (${e.eppModel}) — entregado ${e.deliveredAt}` +
        `${e.nextReplacementAt ? `, reposición ${e.nextReplacementAt}` : ''}.`,
    )
    .join('\n');
}

function mdExposure(log: ExposureLogEntry[]): string {
  if (log.length === 0) return '_Sin registro de exposición._';
  return log
    .map(
      (e) =>
        `- ${e.agent} (${e.year}): ${e.totalHours}h acumuladas` +
        `${e.averageMeasurement !== undefined ? `, promedio ${e.averageMeasurement} ${e.measurementUnit ?? ''}`.trimEnd() : ''}.`,
    )
    .join('\n');
}

function mdMedical(ctx: MedicalContextEntry[] | 'REDACTED'): string {
  if (ctx === 'REDACTED') {
    return '_Contexto médico REDACTED — no autorizado para este nivel de export._';
  }
  if (ctx.length === 0) return '_Sin contexto médico cargado._';
  return ctx
    .map(
      (m) =>
        `- **${m.category}** (${m.recordedAt}${m.source ? `, ${m.source}` : ''}): ${m.summary}`,
    )
    .join('\n');
}

export function serializeAsMarkdown(history: PortableWorkerHistory): SerializedExport {
  const parts: string[] = [];
  parts.push(`# Historial Profesional Portátil`);
  parts.push('');
  parts.push(`> ${history.disclaimer}`);
  parts.push('');
  parts.push(
    `**Exportado:** ${history.exportedAt} · **Nivel:** ${history.redactionLevel} · ` +
      `**Solicitante:** ${history.requestedBy.role} (${history.requestedBy.uid}) · ` +
      `**Schema:** ${history.schemaVersion}`,
  );
  parts.push('');

  const identityBody =
    `- **Nombre:** ${history.identity.fullName}\n` +
    (history.identity.rut ? `- **RUT:** ${history.identity.rut}\n` : '') +
    `- **RUT hash (SHA-256):** \`${history.identity.rutHash}\`\n` +
    (history.identity.birthYear !== undefined
      ? `- **Año de nacimiento:** ${history.identity.birthYear}\n`
      : '') +
    (history.identity.email ? `- **Email:** ${history.identity.email}\n` : '');
  parts.push(mdSection('Identidad', identityBody.trimEnd()));

  parts.push(mdSection('Historial Laboral', mdSpans(history.employmentSpans)));
  parts.push(mdSection('Capacitaciones', mdTrainings(history.completedTrainings)));
  parts.push(mdSection('Certificaciones', mdCerts(history.certifications)));
  parts.push(mdSection('EPP', mdEpp(history.eppHistory)));
  parts.push(mdSection('Exposición Agregada', mdExposure(history.exposureLog)));
  parts.push(mdSection('Contexto Médico', mdMedical(history.medicalContext)));

  const body = parts.join('\n');
  const checksum = hashUtf8(body);
  return { body, checksum, contentType: 'text/markdown' };
}
