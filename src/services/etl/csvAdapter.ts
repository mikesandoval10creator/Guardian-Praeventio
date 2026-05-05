// SPDX-License-Identifier: MIT
// Sprint 24 — Bucket JJ — Universal CSV importer/exporter.
//
// Generic ETL pipeline for the 6 entity types we currently expose to the
// SAP/Excel-driven clients (workers, findings, processes, training, crews,
// inspections). The adapter stays decoupled from the React tree so it can
// be exercised from a CLI/headless context (Bucket LL) and from the
// Migration tooling (Bucket MM) without dragging firebase-admin or any
// Node-only deps.
//
// Reuse note: `MassImportModal` already implements a worker-only CSV path
// (no schema, no validation, no preview). This module replaces that ad-hoc
// loop with a typed generic that also covers export. We do NOT remove
// `MassImportModal` — Bucket KK (onboarding) will re-wire the workers page
// to use this universal modal in a separate change.

import { db } from '../firebase';
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { logger } from '../../utils/logger';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type EtlEntityType =
  | 'workers'
  | 'findings'
  | 'processes'
  | 'training'
  | 'crews'
  | 'inspections';

export type EtlColumnType = 'string' | 'number' | 'date' | 'boolean';

/**
 * Column descriptor. `mapTo` is the property in the typed entity that
 * receives the parsed value. `name` is the CSV header (case-insensitive).
 * `aliases` is an optional list of alternative headers the parser will
 * accept — handy when SAP exports use slightly different labels (e.g.
 * `nombre` vs `name` vs `worker_name`).
 */
export interface CsvColumn<T> {
  name: string;
  type: EtlColumnType;
  required: boolean;
  mapTo: keyof T;
  aliases?: string[];
}

export interface CsvSchema<T> {
  entityType: EtlEntityType;
  columns: CsvColumn<T>[];
  /** Returns a list of human-readable validation errors. Empty = valid. */
  validate?: (row: T) => string[];
  /** Optional last-mile transformer (e.g. attach createdAt, status default). */
  transform?: (row: any) => T;
}

export interface ImportRowError {
  row: number; // 1-based, matches what spreadsheet users see
  reason: string;
}

export interface ImportResult<T> {
  success: T[];
  errors: ImportRowError[];
  total: number;
}

export interface FirestoreImportOpts {
  /** Project the entities belong to. `null` writes to the root collection. */
  projectId: string | null;
  /** Collection name (e.g. `workers`, `findings`). */
  collection: string;
}

export interface FirestoreExportOpts {
  projectId: string | null;
  collection: string;
  /** Equality filters to scope the export. e.g. `{ status: 'active' }`. */
  filters?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// CSV parsing — RFC 4180-ish
// ---------------------------------------------------------------------------

/**
 * Parse a single CSV line honoring quoted fields and escaped quotes.
 * Not a full RFC 4180 implementation — we don't need multi-line quoted
 * fields for our use case (SAP/Excel exports are single-line per row in
 * practice). Returns trimmed values.
 */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        out.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur.trim());
  return out;
}

function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function coerceValue(raw: string, type: EtlColumnType): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  switch (type) {
    case 'string':
      return trimmed;
    case 'number': {
      // Accept comma decimal (Chile/SAP) — convert before parseFloat.
      const normalized = trimmed.replace(/\./g, '').replace(',', '.');
      const n = Number(normalized);
      return Number.isNaN(n) ? undefined : n;
    }
    case 'date': {
      // Accept ISO (YYYY-MM-DD) or es-CL (DD/MM/YYYY).
      const isoMatch = /^\d{4}-\d{2}-\d{2}/.test(trimmed);
      if (isoMatch) return trimmed;
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
      if (m) return `${m[3]}-${m[2]}-${m[1]}`;
      return trimmed; // pass through, validator may reject
    }
    case 'boolean': {
      const t = trimmed.toLowerCase();
      if (['true', '1', 'sí', 'si', 'yes', 'y'].includes(t)) return true;
      if (['false', '0', 'no', 'n'].includes(t)) return false;
      return undefined;
    }
    default:
      return trimmed;
  }
}

// ---------------------------------------------------------------------------
// CsvAdapter
// ---------------------------------------------------------------------------

export class CsvAdapter<T extends Record<string, any>> {
  constructor(private readonly schema: CsvSchema<T>) {}

  /**
   * Parse CSV text into typed rows. Errors are collected per-row; rows
   * with structural errors do NOT appear in `success`. The header row is
   * row 1 in `errors[].row` to match what users see in their spreadsheet.
   */
  parse(csvText: string): ImportResult<T> {
    const errors: ImportRowError[] = [];
    const success: T[] = [];

    const lines = csvText
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      return { success, errors: [{ row: 0, reason: 'CSV vacío' }], total: 0 };
    }

    const headerCells = parseCsvLine(lines[0]).map((h) => h.toLowerCase());

    // Build column → header-index map.
    const colIndex = new Map<keyof T, number>();
    for (const col of this.schema.columns) {
      const candidates = [col.name, ...(col.aliases ?? [])].map((c) =>
        c.toLowerCase(),
      );
      const idx = headerCells.findIndex((h) => candidates.includes(h));
      if (idx >= 0) colIndex.set(col.mapTo, idx);
    }

    // Confirm required columns are present.
    for (const col of this.schema.columns) {
      if (col.required && !colIndex.has(col.mapTo)) {
        errors.push({
          row: 1,
          reason: `Falta columna obligatoria: "${col.name}"`,
        });
      }
    }
    if (errors.length > 0) {
      return { success, errors, total: lines.length - 1 };
    }

    const total = lines.length - 1;
    for (let i = 1; i < lines.length; i++) {
      const rowNum = i + 1; // 1-based, header is row 1
      const cells = parseCsvLine(lines[i]);
      const raw: Record<string, unknown> = {};
      const rowErrors: string[] = [];

      for (const col of this.schema.columns) {
        const idx = colIndex.get(col.mapTo)!;
        const cellRaw = cells[idx] ?? '';
        const coerced = coerceValue(cellRaw, col.type);

        if (col.required && (coerced === undefined || coerced === '')) {
          rowErrors.push(`columna "${col.name}" requerida`);
          continue;
        }
        if (coerced !== undefined) {
          raw[col.mapTo as string] = coerced;
        }
      }

      if (rowErrors.length > 0) {
        errors.push({ row: rowNum, reason: rowErrors.join('; ') });
        continue;
      }

      let typed: T;
      try {
        typed = this.schema.transform
          ? this.schema.transform(raw)
          : (raw as T);
      } catch (err) {
        errors.push({
          row: rowNum,
          reason: `transform falló: ${(err as Error).message}`,
        });
        continue;
      }

      const validateErrors = this.schema.validate?.(typed) ?? [];
      if (validateErrors.length > 0) {
        errors.push({ row: rowNum, reason: validateErrors.join('; ') });
        continue;
      }

      success.push(typed);
    }

    return { success, errors, total };
  }

  /**
   * Bulk-write parsed rows to Firestore. The path is built from
   * `projectId` + `collection` to match the project-scoped pattern used
   * by `MassImportModal` (e.g. `projects/<id>/workers`). Each write is
   * independent — a single row failure does not abort the batch.
   */
  async importToFirestore(
    rows: T[],
    opts: FirestoreImportOpts,
  ): Promise<{ written: number; failed: number }> {
    let written = 0;
    let failed = 0;
    const path = opts.projectId
      ? `projects/${opts.projectId}/${opts.collection}`
      : opts.collection;

    for (const row of rows) {
      try {
        await addDoc(collection(db, path), {
          ...row,
          projectId: opts.projectId ?? null,
          importedAt: new Date().toISOString(),
        });
        written++;
      } catch (err) {
        logger.error('[CsvAdapter] importToFirestore row failed', {
          err,
          path,
        });
        failed++;
      }
    }

    return { written, failed };
  }

  /**
   * Read entities from Firestore matching `filters` and serialise to a
   * CSV string (header row + one row per doc). Columns are emitted in the
   * order declared in the schema, so re-importing the same export round-
   * trips cleanly.
   */
  async exportFromFirestore(opts: FirestoreExportOpts): Promise<string> {
    const path = opts.projectId
      ? `projects/${opts.projectId}/${opts.collection}`
      : opts.collection;

    const constraints: QueryConstraint[] = [];
    if (opts.filters) {
      for (const [k, v] of Object.entries(opts.filters)) {
        constraints.push(where(k, '==', v));
      }
    }

    const snap =
      constraints.length > 0
        ? await getDocs(query(collection(db, path), ...constraints))
        : await getDocs(collection(db, path));

    const docs = snap.docs.map((d) => d.data() as T);
    return this.serialize(docs);
  }

  /**
   * Pure CSV-string serializer — exposed publicly so it can be used in
   * tests (no firestore round-trip) and for client-side downloads of
   * already-loaded entity arrays.
   */
  serialize(rows: T[]): string {
    const header = this.schema.columns.map((c) => c.name).join(',');
    const body = rows
      .map((row) =>
        this.schema.columns
          .map((c) => escapeCsvField(row[c.mapTo]))
          .join(','),
      )
      .join('\n');
    return body.length > 0 ? `${header}\n${body}` : header;
  }
}
