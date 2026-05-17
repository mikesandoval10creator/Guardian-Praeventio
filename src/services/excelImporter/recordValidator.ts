// Praeventio Guard — Sprint K §107 — Validador estructural (Zod) por kind.
//
// Inputs ⇒ filas crudas devueltas por `xlsxReader.parseXlsx`.
// Outputs ⇒ filas con record tipado o con array de issues (por columna).
//
// La diferencia con `excelImport/excelImporter.ts` (legacy Sprint K v1) es:
//   • Aquí los schemas son Zod, no listas de strings — habilita
//     `safeParse` con error paths que el front muestra como
//     "fila X · columna Y · mensaje".
//   • La deduplicación vive en `deduplicator.ts` (single-responsibility).
//   • La normalización de valores (RUT, ISO date) ocurre en `coerceX`
//     helpers determinísticos.

import { z } from 'zod';

export type ImportEntityKind =
  | 'workers'
  | 'epp'
  | 'trainings'
  | 'incidents'
  | 'projects'
  | 'risks';

export interface ValidationIssue {
  rowNumber: number;
  column: string;
  code: 'missing' | 'invalid_format' | 'out_of_range' | 'unknown_column';
  message: string;
}

export interface ValidatedRow<T> {
  rowNumber: number;
  record: T;
}

export interface ValidationResult<T> {
  valid: ValidatedRow<T>[];
  invalid: Array<{ rowNumber: number; issues: ValidationIssue[] }>;
  totalIssues: number;
}

// ───────────────────────── Helpers ─────────────────────────

/** Chile RUT — DV módulo 11. */
export function isValidRut(rut: string): boolean {
  const cleaned = rut.replace(/[.\-\s]/g, '').toLowerCase();
  if (cleaned.length < 2) return false;
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  if (!/^\d+$/.test(body)) return false;
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i] as string, 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const mod = 11 - (sum % 11);
  const expected = mod === 11 ? '0' : mod === 10 ? 'k' : String(mod);
  return dv === expected;
}

export function normalizeRut(rut: string): string {
  return rut.replace(/[.\-\s]/g, '').toLowerCase();
}

/** ISO-8601 puro o fecha YYYY-MM-DD; rechaza strings sin formato. */
export function isValidIso(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.trim().length === 0) return false;
  // Acepta "2026-05-17" o ISO completo
  if (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

// Coerciones suaves: SheetJS devuelve strings o numbers; normalizamos a string.
const stringish = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()));

const optionalString = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return undefined;
    const s = typeof v === 'number' ? String(v) : v.trim();
    return s.length === 0 ? undefined : s;
  });

const rutSchema = stringish
  .refine((v) => v.length > 0, { message: 'missing' })
  .refine((v) => isValidRut(v), { message: 'invalid_rut' })
  .transform((v) => normalizeRut(v));

const isoDateSchema = stringish
  .refine((v) => v.length > 0, { message: 'missing' })
  .refine((v) => isValidIso(v), { message: 'invalid_iso_date' });

const emailSchema = optionalString.refine(
  (v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  { message: 'invalid_email' },
);

const severitySchema = stringish
  .refine((v) => v.length > 0, { message: 'missing' })
  .refine(
    (v) => ['low', 'medium', 'high', 'critical', 'baja', 'media', 'alta', 'crítica'].includes(v.toLowerCase()),
    { message: 'invalid_severity' },
  );

// ───────────────────────── Schemas Zod ─────────────────────────

export const WorkerSchema = z.object({
  fullName: stringish.refine((v) => v.length >= 2, { message: 'missing' }),
  rut: rutSchema,
  role: optionalString,
  phone: optionalString,
  email: emailSchema,
  hireDate: optionalString.refine(
    (v) => v === undefined || isValidIso(v),
    { message: 'invalid_iso_date' },
  ),
});
export type WorkerRecord = z.infer<typeof WorkerSchema>;

export const EppSchema = z.object({
  category: stringish.refine((v) => v.length > 0, { message: 'missing' }),
  workerRut: rutSchema,
  handedOverAt: isoDateSchema,
  brand: optionalString,
  serial: optionalString,
  lifespanDays: z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .optional()
    .transform((v) => {
      if (v === null || v === undefined || v === '') return undefined;
      const n = typeof v === 'number' ? v : parseInt(String(v), 10);
      return Number.isFinite(n) ? n : NaN;
    })
    .refine((v) => v === undefined || Number.isFinite(v as number), {
      message: 'invalid_lifespan',
    }),
});
export type EppRecord = z.infer<typeof EppSchema>;

export const TrainingSchema = z.object({
  code: stringish.refine((v) => v.length > 0, { message: 'missing' }),
  workerRut: rutSchema,
  completedAt: isoDateSchema,
  expiresAt: optionalString.refine(
    (v) => v === undefined || isValidIso(v),
    { message: 'invalid_iso_date' },
  ),
  institution: optionalString,
});
export type TrainingRecord = z.infer<typeof TrainingSchema>;

export const IncidentSchema = z.object({
  id: optionalString,
  occurredAt: isoDateSchema,
  description: stringish.refine((v) => v.length >= 3, { message: 'missing' }),
  severity: severitySchema,
  location: optionalString,
  involvedWorkerRut: optionalString.refine(
    (v) => v === undefined || isValidRut(v),
    { message: 'invalid_rut' },
  ),
});
export type IncidentRecord = z.infer<typeof IncidentSchema>;

export const ProjectSchema = z.object({
  name: stringish.refine((v) => v.length >= 2, { message: 'missing' }),
  industry: stringish.refine((v) => v.length > 0, { message: 'missing' }),
  startDate: optionalString.refine(
    (v) => v === undefined || isValidIso(v),
    { message: 'invalid_iso_date' },
  ),
  address: optionalString,
});
export type ProjectRecord = z.infer<typeof ProjectSchema>;

export const RiskSchema = z.object({
  id: optionalString,
  task: stringish.refine((v) => v.length >= 2, { message: 'missing' }),
  hazard: stringish.refine((v) => v.length >= 2, { message: 'missing' }),
  likelihood: severitySchema,
  severity: severitySchema,
  control: optionalString,
});
export type RiskRecord = z.infer<typeof RiskSchema>;

export const SCHEMAS_BY_KIND = {
  workers: WorkerSchema,
  epp: EppSchema,
  trainings: TrainingSchema,
  incidents: IncidentSchema,
  projects: ProjectSchema,
  risks: RiskSchema,
} as const;

export const UNIQUE_KEY_BY_KIND: Record<ImportEntityKind, string | null> = {
  workers: 'rut',
  epp: 'serial',
  trainings: null,
  incidents: 'id',
  projects: 'name',
  risks: 'id',
};

// ───────────────────────── Mensajes humanos ─────────────────────────

const MESSAGE_MAP: Record<string, string> = {
  missing: 'Campo obligatorio vacío.',
  invalid_rut: 'RUT inválido (dígito verificador).',
  invalid_iso_date: 'Fecha no es ISO-8601 (YYYY-MM-DD).',
  invalid_email: 'Email no tiene formato válido.',
  invalid_severity: 'Severidad debe ser baja/media/alta/crítica.',
  invalid_lifespan: 'Vida útil debe ser un número entero de días.',
};

function explain(issueCode: string): string {
  return MESSAGE_MAP[issueCode] ?? `Valor inválido (${issueCode}).`;
}

// ───────────────────────── Validador ─────────────────────────

export interface RawRow {
  rowNumber: number;
  data: Record<string, unknown>;
}

/**
 * Valida un array de filas crudas contra el schema del `kind`. No
 * deduplica — eso es problema del `deduplicator`. Devuelve filas
 * válidas (con record tipado) e inválidas (con issues por columna).
 */
export function validateRows<K extends ImportEntityKind>(
  kind: K,
  rows: RawRow[],
): ValidationResult<z.infer<(typeof SCHEMAS_BY_KIND)[K]>> {
  const schema = SCHEMAS_BY_KIND[kind] as z.ZodSchema<unknown>;
  const valid: Array<ValidatedRow<z.infer<(typeof SCHEMAS_BY_KIND)[K]>>> = [];
  const invalid: Array<{ rowNumber: number; issues: ValidationIssue[] }> = [];
  let totalIssues = 0;

  for (const row of rows) {
    const parsed = schema.safeParse(row.data);
    if (parsed.success) {
      valid.push({
        rowNumber: row.rowNumber,
        record: parsed.data as z.infer<(typeof SCHEMAS_BY_KIND)[K]>,
      });
      continue;
    }
    const issues: ValidationIssue[] = parsed.error.issues.map((zIssue) => {
      const column = zIssue.path.length > 0 ? String(zIssue.path[0]) : '<row>';
      // El message del refine es el code: "missing" | "invalid_rut" | …
      const rawMsg = zIssue.message;
      const knownCode = rawMsg in MESSAGE_MAP ? rawMsg : null;
      const code =
        knownCode === 'missing'
          ? ('missing' as const)
          : knownCode
            ? ('invalid_format' as const)
            : ('invalid_format' as const);
      return {
        rowNumber: row.rowNumber,
        column,
        code,
        message: explain(rawMsg),
      };
    });
    totalIssues += issues.length;
    invalid.push({ rowNumber: row.rowNumber, issues });
  }

  return { valid, invalid, totalIssues };
}
