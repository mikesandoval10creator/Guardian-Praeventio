// Unidad de Fomento (UF) — Chile's inflation-indexed unit of account.
//
// The Diamante tier is anchored to ~100 UF (business decision 2026-06-14) so it
// tracks inflation without manual repricing, while the retail tiers stay in
// round CLP. The UF value is PUBLIC financial data (Banco Central, exposed by
// mindicador.cl); a daily cron (runUfRateRefresh) fetches it and caches it in
// the server-only `ufRates` collection, and the pricing layer reads the cached
// value SERVER-SIDE to compute the Diamante CLP amount. This module is pure:
// parsing + conversion only, no IO.

/** Diamante tier anchor in UF (business decision 2026-06-14: ~100 UF). */
export const DIAMANTE_UF = 100;

/**
 * Plausibility floor for a UF value in CLP. The UF has been ~30k–40k CLP for
 * years and only ever rises (it is inflation-indexed), so any value below this
 * is implausible — reject it so a compromised/spoofed upstream (or a shape
 * change that coincidentally parses) can't poison the cache with a tiny value
 * and mis-price the Diamante tier. No ceiling: that would risk rejecting a
 * legitimately higher future value.
 */
export const UF_MIN_PLAUSIBLE_CLP = 10_000;

export interface UfRate {
  /** UF value in CLP (e.g. 38000). */
  valueClp: number;
  /** Publication date (YYYY-MM-DD) the value corresponds to. */
  date: string;
}

/**
 * Parse the mindicador.cl `/api/uf` response into a UfRate, defensively.
 * Returns null on any malformed/empty payload so the caller keeps the last
 * cached value instead of caching garbage. Pure + total (never throws).
 *
 * Shape: `{ serie: [{ fecha: ISO-8601 string, valor: number }] }`.
 */
export function parseMindicadorUf(json: unknown): UfRate | null {
  if (!json || typeof json !== 'object') return null;
  const serie = (json as { serie?: unknown }).serie;
  if (!Array.isArray(serie) || serie.length === 0) return null;
  const first = serie[0] as { fecha?: unknown; valor?: unknown } | null;
  const valor = first?.valor;
  const fecha = first?.fecha;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) return null;
  // Reject an implausibly low value from a compromised/spoofed upstream.
  if (valor < UF_MIN_PLAUSIBLE_CLP) return null;
  const date =
    typeof fecha === 'string' && fecha.length >= 10 ? fecha.slice(0, 10) : null;
  if (!date) return null;
  return { valueClp: valor, date };
}

/**
 * Convert a UF amount to whole CLP (CLP has no decimals). Pure.
 * `units` is the number of UF (e.g. DIAMANTE_UF), `ufValueClp` the cached rate.
 */
export function clpFromUf(units: number, ufValueClp: number): number {
  return Math.round(units * ufValueClp);
}
