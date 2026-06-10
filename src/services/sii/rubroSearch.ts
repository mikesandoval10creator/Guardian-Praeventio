/**
 * Pure search service over the verified SII economic-activity catalogue
 * (`src/data/sii/actividadesEconomicas.ts`).
 *
 * Designed for the onboarding-wizard autocomplete (épica Rubros SII, slice 2):
 * exact code lookup, code-prefix lookup (on the canonical zero-padded form)
 * and accent-insensitive free-text search. No side effects, no I/O.
 */
import {
  SII_ACTIVIDADES_ECONOMICAS,
  type SiiActividadEconomica,
} from '../../data/sii/actividadesEconomicas';

/** Renders a code in the SII canonical 6-digit zero-padded form ("040000"). */
export function formatCodigoSii(codigo: number): string {
  return String(codigo).padStart(6, '0');
}

/** Lowercases and strips diacritics so "construcción" === "CONSTRUCCION". */
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/** Exact lookup by code; accepts the numeric or zero-padded string form. */
export function findByCodigo(codigo: number | string): SiiActividadEconomica | undefined {
  const numeric = typeof codigo === 'string' ? Number.parseInt(codigo, 10) : codigo;
  if (!Number.isInteger(numeric)) return undefined;
  return SII_ACTIVIDADES_ECONOMICAS.find((e) => e.codigo === numeric);
}

/** All entries whose canonical 6-digit code starts with `prefix`. */
export function searchByCodigoPrefix(prefix: string): SiiActividadEconomica[] {
  const clean = prefix.trim();
  if (!/^\d+$/.test(clean)) return [];
  return SII_ACTIVIDADES_ECONOMICAS.filter((e) => formatCodigoSii(e.codigo).startsWith(clean));
}

/**
 * Accent/case-insensitive text search with AND semantics: every whitespace
 * separated token of the query must appear in the normalised description.
 */
export function searchByTexto(query: string, limit = Infinity): SiiActividadEconomica[] {
  const tokens = normalizeText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  const results: SiiActividadEconomica[] = [];
  for (const entry of SII_ACTIVIDADES_ECONOMICAS) {
    const haystack = normalizeText(entry.descripcion);
    if (tokens.every((t) => haystack.includes(t))) {
      results.push(entry);
      if (results.length >= limit) break;
    }
  }
  return results;
}

/**
 * Wizard-facing entry point: all-digit queries search by code prefix,
 * anything else searches by text. Returns at most `limit` entries.
 */
export function searchRubros(query: string, limit = 20): SiiActividadEconomica[] {
  const clean = query.trim();
  if (clean.length === 0) return [];
  if (/^\d+$/.test(clean)) {
    return searchByCodigoPrefix(clean).slice(0, limit);
  }
  return searchByTexto(clean, limit);
}
