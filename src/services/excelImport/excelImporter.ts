// Praeventio Guard — Sprint K: Importador Excel + Validador + Desduplicador.
//
// Cierra: Documento usuario "§106-108"
//
// La mayoría de PYMEs llegan con planillas Excel (trabajadores, EPP,
// capacitaciones, incidentes). Este servicio:
//   - Valida la estructura del Excel
//   - Detecta filas duplicadas (mismo trabajador 2 veces, mismo EPP)
//   - Normaliza datos (rut con dígito verificador, fechas, mayúsculas)
//   - Reporta filas con problemas para fix manual
//
// Determinístico. NO lee Excel directamente (sin XLSX deps en módulo) —
// recibe array de objetos plain JS que el caller parsea con SheetJS/xlsx.

// ────────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────────

export type ImportEntityKind = 'workers' | 'epp' | 'trainings' | 'incidents' | 'projects';

export interface ImportRow {
  /** Número de fila en el archivo original (para reportar errores). */
  rowNumber: number;
  /** Datos crudos de la fila. */
  data: Record<string, unknown>;
}

export interface ImportSchema {
  kind: ImportEntityKind;
  /** Campos obligatorios. */
  required: string[];
  /** Campos opcionales (warning si missing pero no bloquea). */
  optional?: string[];
  /** Campo usado para detectar duplicados (ej: 'rut' para workers). */
  uniqueKey?: string;
}

export interface RowIssue {
  rowNumber: number;
  field?: string;
  issue: 'missing_required' | 'invalid_format' | 'duplicate' | 'unknown_column';
  message: string;
}

export interface ImportReport {
  totalRows: number;
  validRows: number;
  duplicates: number;
  issues: RowIssue[];
  /** Filas válidas listas para insertar. */
  cleanRows: ImportRow[];
}

// ────────────────────────────────────────────────────────────────────────
// Schemas canónicos
// ────────────────────────────────────────────────────────────────────────

export const SCHEMAS: Record<ImportEntityKind, ImportSchema> = {
  workers: {
    kind: 'workers',
    required: ['fullName', 'rut'],
    optional: ['role', 'phone', 'email', 'hireDate'],
    uniqueKey: 'rut',
  },
  epp: {
    kind: 'epp',
    required: ['category', 'workerRut', 'handedOverAt'],
    optional: ['lifespanDays', 'brand'],
    uniqueKey: undefined, // mismo worker puede tener varios del mismo tipo
  },
  trainings: {
    kind: 'trainings',
    required: ['code', 'workerRut', 'completedAt'],
    optional: ['expiresAt', 'institution'],
    uniqueKey: undefined,
  },
  incidents: {
    kind: 'incidents',
    required: ['occurredAt', 'description', 'severity'],
    optional: ['location', 'involvedWorkerRut'],
    uniqueKey: undefined,
  },
  projects: {
    kind: 'projects',
    required: ['name', 'industry'],
    optional: ['startDate', 'address'],
    uniqueKey: 'name',
  },
};

// ────────────────────────────────────────────────────────────────────────
// Validation helpers
// ────────────────────────────────────────────────────────────────────────

/** Chile RUT: dígito verificador módulo 11. */
export function isValidRut(rut: string): boolean {
  const cleaned = rut.replace(/[.\-\s]/g, '').toLowerCase();
  if (cleaned.length < 2) return false;
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  if (!/^\d+$/.test(body)) return false;
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const mod = 11 - (sum % 11);
  const expected = mod === 11 ? '0' : mod === 10 ? 'k' : String(mod);
  return dv === expected;
}

export function normalizeRut(rut: string): string {
  return rut.replace(/[.\-\s]/g, '').toLowerCase();
}

export function isValidIso(dateStr: string): boolean {
  if (typeof dateStr !== 'string') return false;
  return !Number.isNaN(Date.parse(dateStr));
}

// ────────────────────────────────────────────────────────────────────────
// Main importer
// ────────────────────────────────────────────────────────────────────────

export function processImport(
  schema: ImportSchema,
  rows: ImportRow[],
): ImportReport {
  const issues: RowIssue[] = [];
  const cleanRows: ImportRow[] = [];
  const seenKeys = new Set<string>();
  let duplicates = 0;

  for (const row of rows) {
    let rowHasError = false;

    // Required check
    for (const field of schema.required) {
      const val = row.data[field];
      if (val === undefined || val === null || val === '') {
        issues.push({
          rowNumber: row.rowNumber,
          field,
          issue: 'missing_required',
          message: `Campo obligatorio "${field}" faltante.`,
        });
        rowHasError = true;
      }
    }

    // RUT specific validation
    if (schema.required.includes('rut') || schema.required.includes('workerRut')) {
      const rutField = schema.required.includes('rut') ? 'rut' : 'workerRut';
      const rutVal = row.data[rutField];
      if (typeof rutVal === 'string' && !isValidRut(rutVal)) {
        issues.push({
          rowNumber: row.rowNumber,
          field: rutField,
          issue: 'invalid_format',
          message: `RUT "${rutVal}" no es válido (dígito verificador).`,
        });
        rowHasError = true;
      }
    }

    // Date fields validation
    for (const field of ['occurredAt', 'handedOverAt', 'completedAt', 'startDate', 'hireDate', 'expiresAt']) {
      if (field in row.data) {
        const val = row.data[field];
        if (val !== undefined && val !== null && val !== '') {
          if (typeof val !== 'string' || !isValidIso(val)) {
            issues.push({
              rowNumber: row.rowNumber,
              field,
              issue: 'invalid_format',
              message: `Fecha "${field}" no es ISO-8601 válida: "${val}".`,
            });
            rowHasError = true;
          }
        }
      }
    }

    // Duplicate check via uniqueKey
    if (schema.uniqueKey && !rowHasError) {
      const keyVal = row.data[schema.uniqueKey];
      if (typeof keyVal === 'string') {
        const normalized =
          schema.uniqueKey === 'rut' ? normalizeRut(keyVal) : keyVal.toLowerCase().trim();
        if (seenKeys.has(normalized)) {
          issues.push({
            rowNumber: row.rowNumber,
            field: schema.uniqueKey,
            issue: 'duplicate',
            message: `Valor duplicado en ${schema.uniqueKey}: "${keyVal}".`,
          });
          duplicates += 1;
          rowHasError = true;
        } else {
          seenKeys.add(normalized);
        }
      }
    }

    if (!rowHasError) {
      cleanRows.push(row);
    }
  }

  return {
    totalRows: rows.length,
    validRows: cleanRows.length,
    duplicates,
    issues,
    cleanRows,
  };
}
