import { describe, it, expect } from 'vitest';
import type adminNs from 'firebase-admin';
import {
  readCachedUfValueClp,
  resolveBillingTierUf,
} from '../../server/routes/billing/ufPricing.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

const asFs = (db: ReturnType<typeof createFakeFirestore>) =>
  db as unknown as adminNs.firestore.Firestore;

describe('readCachedUfValueClp', () => {
  it('returns the cached UF value', async () => {
    const db = createFakeFirestore();
    db._seed('ufRates/current', { valueClp: 39000, date: '2026-06-16' });
    expect(await readCachedUfValueClp(asFs(db))).toBe(39000);
  });

  it('returns null when the doc is missing, malformed, or implausibly low (fail-soft)', async () => {
    const db = createFakeFirestore();
    expect(await readCachedUfValueClp(asFs(db))).toBeNull(); // missing
    db._seed('ufRates/current', { valueClp: 'nope' });
    expect(await readCachedUfValueClp(asFs(db))).toBeNull(); // malformed
    db._seed('ufRates/current', { valueClp: 9999 }); // below the plausibility floor
    expect(await readCachedUfValueClp(asFs(db))).toBeNull();
  });
});

describe('resolveBillingTierUf', () => {
  it('Diamante: re-derives CLP from the cached UF rate', async () => {
    const db = createFakeFirestore();
    db._seed('ufRates/current', { valueClp: 40000, date: '2026-06-16' });
    const tier = await resolveBillingTierUf('diamante', asFs(db));
    expect(tier?.clpRegular).toBe(Math.round((100 * 40000) / 1.19)); // 3361345
    expect(tier?.clpAnual).toBe(Math.round((100 * 40000 * 9) / 1.19));
    expect(tier?.usdRegular).toBe(4200); // USD not UF-indexed
  });

  it('Diamante: FAIL-SOFT to the placeholder when no UF rate is cached', async () => {
    const db = createFakeFirestore();
    const tier = await resolveBillingTierUf('diamante', asFs(db));
    // The historical placeholder (= 100 UF @ 39.000).
    expect(tier?.clpRegular).toBe(3277311);
    expect(tier?.clpAnual).toBe(29495798);
  });

  it('non-Diamante tiers are returned untouched (no UF read needed)', async () => {
    const db = createFakeFirestore();
    db._seed('ufRates/current', { valueClp: 40000, date: '2026-06-16' });
    const plata = await resolveBillingTierUf('plata', asFs(db));
    expect(plata?.clpRegular).toBe(16798); // the fixed placeholder, unchanged
  });

  it('unknown tier → null', async () => {
    const db = createFakeFirestore();
    expect(await resolveBillingTierUf('nonexistent', asFs(db))).toBeNull();
  });
});
