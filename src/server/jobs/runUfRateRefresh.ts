// Daily UF (Unidad de Fomento) rate refresh.
//
// Fetches the current UF value (public Banco Central data via mindicador.cl)
// and caches it in the server-only `ufRates/current` doc, so the pricing layer
// can compute the Diamante tier's CLP amount (~100 UF) server-side without an
// external call on every checkout. Fail-soft: a fetch or parse failure keeps
// the last cached value (no overwrite with garbage) — the next daily run
// retries. The fetcher is injected (DI) so this is unit-testable without a
// network call.

import type admin from 'firebase-admin';
import { logger } from '../../utils/logger.js';
import { parseMindicadorUf, type UfRate } from '../../services/pricing/uf.js';

const UF_RATES_DOC = 'ufRates/current';

export interface UfRateRefreshDeps {
  db: admin.firestore.Firestore;
  /** Returns the raw mindicador.cl JSON (or throws on network/HTTP error). */
  fetchUf: () => Promise<unknown>;
  now?: () => Date;
}

export interface UfRateRefreshResult {
  updated: boolean;
  rate: UfRate | null;
  reason?: 'fetch_failed' | 'parse_failed';
}

export async function runUfRateRefresh(
  deps: UfRateRefreshDeps,
): Promise<UfRateRefreshResult> {
  const { db, fetchUf } = deps;
  const now = deps.now ?? (() => new Date());

  let raw: unknown;
  try {
    raw = await fetchUf();
  } catch (err) {
    logger.error('[uf-rate] fetch failed — keeping last cached value', err as Error);
    return { updated: false, rate: null, reason: 'fetch_failed' };
  }

  const rate = parseMindicadorUf(raw);
  if (!rate) {
    logger.warn('[uf-rate] parse failed — keeping last cached value');
    return { updated: false, rate: null, reason: 'parse_failed' };
  }

  await db.doc(UF_RATES_DOC).set({
    valueClp: rate.valueClp,
    date: rate.date,
    fetchedAt: now().toISOString(),
    source: 'mindicador.cl',
  });
  logger.info('[uf-rate] cached', { valueClp: rate.valueClp, date: rate.date });
  return { updated: true, rate };
}
