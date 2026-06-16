// UF indexation for the Diamante tier at checkout.
//
// resolveBillingTier (pricing.ts) is pure and returns a fixed CLP placeholder
// for every tier including Diamante. Diamante is anchored to ~100 UF, so its
// real price tracks inflation. This module reads the cached UF value (written
// daily by runUfRateRefresh into the server-only ufRates/current doc) and,
// FOR DIAMANTE ONLY, re-derives the CLP amounts from it. Every other tier is
// returned untouched and incurs NO extra Firestore read.
//
// FAIL-SOFT throughout: a missing/invalid cached rate (or any read error) falls
// back to the pure placeholder — the checkout never blocks and never prices at
// NaN. The cached rate is public Banco Central data; it is read SERVER-SIDE
// (Admin SDK) and never trusted from the client.

import type admin from 'firebase-admin';
import { logger } from '../../../utils/logger.js';
import { diamanteTierFromUf, UF_MIN_PLAUSIBLE_CLP } from '../../../services/pricing/uf.js';
import { resolveBillingTier, type BillingTier } from './pricing.js';
import { sentryCapture } from './shared.js';

const UF_RATES_DOC = 'ufRates/current';
/** Warn (not block) when the cached rate is older than this at checkout time. */
const UF_STALE_AFTER_MS = 72 * 60 * 60 * 1000;

/**
 * Read the cached UF value (CLP) from ufRates/current. Returns null on a
 * missing doc, a malformed/implausible value, or any read error (fail-soft, so
 * the checkout falls back to the placeholder). A genuine Firestore error is
 * surfaced to Sentry — a silent caching outage would otherwise bill Diamante at
 * the placeholder forever with no signal. A stale cached rate is warned (not
 * blocked) so a stopped cron is observable.
 */
export async function readCachedUfValueClp(
  db: admin.firestore.Firestore,
): Promise<number | null> {
  try {
    const snap = await db.doc(UF_RATES_DOC).get();
    if (!snap.exists) return null; // benign: not yet written (first deploy)
    const data = snap.data();
    const v = data?.valueClp;
    // Self-contained plausibility floor (also enforced in diamanteTierFromUf).
    if (typeof v !== 'number' || !Number.isFinite(v) || v < UF_MIN_PLAUSIBLE_CLP) {
      return null;
    }
    const fetchedAt = data?.fetchedAt;
    if (typeof fetchedAt === 'string') {
      const ageMs = Date.now() - new Date(fetchedAt).getTime();
      if (Number.isFinite(ageMs) && ageMs > UF_STALE_AFTER_MS) {
        logger.warn('[uf-rate] cached UF value is stale at checkout', {
          fetchedAt,
          ageHours: Math.round(ageMs / 3_600_000),
        });
      }
    }
    return v;
  } catch (err) {
    logger.error('[uf-rate] readCachedUfValueClp failed — using placeholder', err as Error);
    sentryCapture(err, { endpoint: 'pricing.readCachedUfValueClp', tags: { doc: UF_RATES_DOC } });
    return null;
  }
}

/**
 * resolveBillingTier + UF indexation for Diamante. Non-Diamante tiers are
 * returned exactly as resolveBillingTier gives them (no Firestore read). For
 * Diamante, the CLP amounts are re-derived from the cached UF rate, falling
 * back to the placeholder when the rate is unavailable.
 */
export async function resolveBillingTierUf(
  tierId: string,
  db: admin.firestore.Firestore,
): Promise<BillingTier | null> {
  const tier = resolveBillingTier(tierId);
  if (!tier || tierId !== 'diamante') return tier;
  return diamanteTierFromUf(await readCachedUfValueClp(db), tier);
}
