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
import { diamanteTierFromUf } from '../../../services/pricing/uf.js';
import { resolveBillingTier, type BillingTier } from './pricing.js';

const UF_RATES_DOC = 'ufRates/current';

/**
 * Read the cached UF value (CLP) from ufRates/current. Returns null on a
 * missing doc, a malformed value, or any read error (fail-soft). Pure read.
 */
export async function readCachedUfValueClp(
  db: admin.firestore.Firestore,
): Promise<number | null> {
  try {
    const snap = await db.doc(UF_RATES_DOC).get();
    if (!snap.exists) return null;
    const v = snap.data()?.valueClp;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
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
