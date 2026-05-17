// Praeventio Guard — Sprint K §108 — Deduplicador.
//
// Recibe filas YA validadas (registros tipados con rowNumber) y separa
// las que llegan duplicadas dentro del mismo lote vs. las que colisionan
// con un set de claves existentes (entregado por el caller).
//
// Diseño:
//   • Pure: no toca Firestore. El caller pasa `existingKeys` cuando
//     quiere chequear contra la base.
//   • Determinístico: el primer rowNumber gana, los siguientes
//     "duplican" — facilita reportar al usuario qué fila fue la
//     "original" para guiar el fix manual.
//   • Soporta clave compuesta vía el callback `keyFor`.

import {
  normalizeRut,
  type ImportEntityKind,
  UNIQUE_KEY_BY_KIND,
} from './recordValidator.js';

export interface DedupeInput<T> {
  rowNumber: number;
  record: T;
}

export interface DuplicateReport {
  rowNumber: number;
  /** Fila donde apareció por primera vez la misma clave dentro del lote. */
  conflictsWithRowNumber: number | null;
  /** Valor de la clave (ya normalizado). */
  key: string;
  /** `true` si el conflicto fue con un registro existente en Firestore. */
  conflictWithExisting: boolean;
}

export interface DedupeResult<T> {
  /** Filas únicas listas para escribir. */
  unique: DedupeInput<T>[];
  duplicates: DuplicateReport[];
}

export interface DedupeOptions<T> {
  kind: ImportEntityKind;
  /**
   * Override de la función que extrae la clave del registro. Útil para
   * compositas. Si no se pasa, usamos `UNIQUE_KEY_BY_KIND[kind]`.
   */
  keyFor?: (record: T) => string | null;
  /** Claves YA conocidas en la base (Firestore). Se comparan normalizadas. */
  existingKeys?: Iterable<string>;
}

function defaultKeyFor<T>(kind: ImportEntityKind, record: T): string | null {
  const field = UNIQUE_KEY_BY_KIND[kind];
  if (!field) return null;
  const rec = record as Record<string, unknown>;
  const value = rec[field];
  if (value === undefined || value === null || value === '') return null;
  const str = String(value);
  // Normalización extra para RUT.
  if (field === 'rut' || field === 'workerRut') {
    return normalizeRut(str);
  }
  return str.toLowerCase().trim();
}

/**
 * Deduplica un lote ya validado.
 *
 * Reglas:
 *   • Si el `kind` no tiene `uniqueKey` definido (`trainings`),
 *     consideramos todas las filas únicas y `duplicates` queda vacío.
 *   • Si una fila trae la clave vacía/null, también pasa como única
 *     (el validator ya marcó "missing" si era obligatoria).
 */
export function dedupe<T>(
  rows: DedupeInput<T>[],
  options: DedupeOptions<T>,
): DedupeResult<T> {
  const keyFor = options.keyFor ?? ((r: T) => defaultKeyFor(options.kind, r));
  const existing = new Set<string>();
  if (options.existingKeys) {
    for (const k of options.existingKeys) {
      if (typeof k === 'string' && k.length > 0) {
        existing.add(k.toLowerCase().trim());
      }
    }
  }
  const seenWithin = new Map<string, number>();
  const unique: DedupeInput<T>[] = [];
  const duplicates: DuplicateReport[] = [];

  for (const row of rows) {
    const rawKey = keyFor(row.record);
    if (rawKey === null) {
      unique.push(row);
      continue;
    }
    const key = rawKey.toLowerCase().trim();
    if (existing.has(key)) {
      duplicates.push({
        rowNumber: row.rowNumber,
        conflictsWithRowNumber: null,
        key,
        conflictWithExisting: true,
      });
      continue;
    }
    const firstSeen = seenWithin.get(key);
    if (firstSeen !== undefined) {
      duplicates.push({
        rowNumber: row.rowNumber,
        conflictsWithRowNumber: firstSeen,
        key,
        conflictWithExisting: false,
      });
      continue;
    }
    seenWithin.set(key, row.rowNumber);
    unique.push(row);
  }

  return { unique, duplicates };
}
