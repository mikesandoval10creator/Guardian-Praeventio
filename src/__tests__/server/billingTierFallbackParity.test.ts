// Praeventio Guard — Tier fallback ↔ canonical pricing parity guard.
//
// PROBLEM (regression this pins forever): the checkout endpoints
// (webpay/mercadopago/khipu) resolve the submitted tier id against
// `BILLING_TIER_FALLBACK` in src/server/routes/billing/pricing.ts. The client
// (`src/pages/Pricing.tsx`) submits the CANONICAL tier id from
// src/services/pricing/tiers.ts. When a priced canonical tier is missing from
// the fallback (e.g. `global-titanio` was), `resolveBillingTier()` returns
// null and the endpoint replies 400 "Unknown tierId" — a real, billable tier
// becomes impossible to purchase.
//
// This test exercises the REAL data: it imports the canonical `TIERS` table
// and the real `BILLING_TIER_FALLBACK` / `resolveBillingTier`, then asserts
// every paid canonical tier is resolvable. A new priced tier added to
// tiers.ts that nobody mirrors into the fallback fails here immediately,
// before it can ship a broken checkout.

import { describe, it, expect } from 'vitest';
import {
  BILLING_TIER_FALLBACK,
  resolveBillingTier,
} from '../../server/routes/billing/pricing.js';
import { TIERS } from '../../services/pricing/tiers.js';

// `gratis` (clpRegular 0) never reaches paid checkout — it is activated via
// `upgradePlan('free')`, not /api/billing/checkout. Every OTHER canonical tier
// is web-checkout priced and MUST be resolvable.
const PAID_CANONICAL_TIERS = TIERS.filter((t) => t.clpRegular > 0);

describe('BILLING_TIER_FALLBACK ↔ tiers.ts parity', () => {
  it('exposes a non-empty paid catalogue to test against', () => {
    expect(PAID_CANONICAL_TIERS.length).toBeGreaterThan(0);
  });

  it.each(PAID_CANONICAL_TIERS.map((t) => t.id))(
    'resolves canonical paid tier "%s" in the checkout fallback',
    (tierId) => {
      const resolved = resolveBillingTier(tierId);
      expect(resolved).not.toBeNull();
      // Sanity: a real billable tier never has zero monthly CLP/USD.
      expect(resolved!.clpRegular).toBeGreaterThan(0);
      expect(resolved!.usdRegular).toBeGreaterThan(0);
    },
  );

  it('includes global-titanio (the tier that previously 400ed at checkout)', () => {
    const resolved = resolveBillingTier('global-titanio');
    expect(resolved).toEqual({
      // Net (pre-IVA) CLP = round(canonical display / 1.19).
      clpRegular: 798311, // round(949990 / 1.19)
      clpAnual: 7663857, // round(9119990 / 1.19)
      usdRegular: 999, // canonical USD, unchanged
      usdAnual: 9990, // usdRegular * 10
    });
  });

  it('keeps every fallback row USD-annual = USD-monthly * 10 (no surprise-bill drift)', () => {
    for (const [tierId, tier] of Object.entries(BILLING_TIER_FALLBACK)) {
      expect(tier.usdAnual, `usdAnual mismatch for ${tierId}`).toBe(
        tier.usdRegular * 10,
      );
    }
  });
});
