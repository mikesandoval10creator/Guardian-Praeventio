// Praeventio Guard — billing tier pricing constants + validation.
//
// Extracted from `src/server/routes/billing.ts` (2026-05-29) as step 1 of
// modularizing the ~2k-LOC billing route monolith (the file was itself a
// Round 17 extraction from server.ts). Pure data + a lookup — no side effects,
// no router wiring, no stateful clients. Consumed by billing.ts handlers and
// future per-provider route modules. Behavior is byte-for-byte identical to
// the previous inline block (covered by src/__tests__/server/billing.test.ts).

import type { CurrencyCode, PaymentMethod } from '../../../services/billing/types.js';

// Tier pricing fallback: real source of truth is
// `src/services/pricing/tiers.ts` (IMP1's territory). Until that lands, we
// read from a small inline table mirroring `tiers.test.ts` so the checkout
// endpoints type-check and serve a 5xx with a helpful message for unknown
// tiers rather than crashing on import.
export type BillingTier = {
  clpRegular: number;
  clpAnual: number;
  usdRegular: number;
  usdAnual: number;
};

export const BILLING_TIER_FALLBACK: Record<string, BillingTier> = {
  // Net amounts (pre-IVA) for CLP = round(canonical display / 1.19); display
  // amounts (incl IVA) live in tiers.ts. 7-metal scheme (2026-06-15). usdAnual
  // = usdRegular * 10 (parity test pins this + resolvability against tiers.ts).
  'cobre': { clpRegular: 8395, clpAnual: 75555, usdRegular: 11, usdAnual: 110 },
  'plata': { clpRegular: 16798, clpAnual: 151185, usdRegular: 22, usdAnual: 220 },
  'oro': { clpRegular: 67218, clpAnual: 604966, usdRegular: 88, usdAnual: 880 },
  'titanio': { clpRegular: 210076, clpAnual: 1890681, usdRegular: 270, usdAnual: 2700 },
  'platino': { clpRegular: 756294, clpAnual: 6806647, usdRegular: 970, usdAnual: 9700 },
  // La joya: ilimitado + multi-jurisdicción + residencia. UF deferred → CLP.
  'diamante': { clpRegular: 3277311, clpAnual: 29495798, usdRegular: 4200, usdAnual: 42000 },
};

export function resolveBillingTier(tierId: string): BillingTier | null {
  return BILLING_TIER_FALLBACK[tierId] ?? null;
}

// Per-unit overage (CLP, net of IVA). Mirrors tiers.test.ts which uses
// $990/worker incl IVA → 990/1.19 ≈ 832.
export const OVERAGE_CLP_PER_WORKER_NET = 832;
export const OVERAGE_CLP_PER_PROJECT_NET = 5034; // 5990 / 1.19

// §2.12 (Fase C.2): 'stripe' removido del set válido. Stripe descartado
// oficialmente. Internacional: MercadoPago (LATAM) + IAP (mobile) +
// manual-transfer (B2B enterprise).
export const VALID_PAYMENT_METHODS: ReadonlyArray<PaymentMethod> = [
  'webpay', 'manual-transfer',
];
export const VALID_CURRENCIES: ReadonlyArray<CurrencyCode> = ['CLP', 'USD'];
