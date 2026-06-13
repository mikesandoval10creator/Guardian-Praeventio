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
  // Net amounts (pre-IVA) for CLP; display amounts (incl IVA) live in tiers.ts.
  // 10075 * 1.19 = 11989.25 → ceil 11990 (matches tiers.test.ts)
  'comite-paritario': { clpRegular: 10075, clpAnual: 81504, usdRegular: 13, usdAnual: 130 },
  'departamento-prevencion': { clpRegular: 26042, clpAnual: 250416, usdRegular: 33, usdAnual: 330 },
  'plata': { clpRegular: 42849, clpAnual: 411513, usdRegular: 54, usdAnual: 540 },
  'oro': { clpRegular: 76462, clpAnual: 734040, usdRegular: 96, usdAnual: 960 },
  'titanio': { clpRegular: 210076, clpAnual: 2016720, usdRegular: 263, usdAnual: 2630 },
  'diamante': { clpRegular: 420160, clpAnual: 4033536, usdRegular: 526, usdAnual: 5260 },
  'empresarial': { clpRegular: 1260496, clpAnual: 12099960, usdRegular: 1578, usdAnual: 15780 },
  'corporativo': { clpRegular: 2521000, clpAnual: 24201600, usdRegular: 3158, usdAnual: 31580 },
  'ilimitado': { clpRegular: 5042008, clpAnual: 48403252, usdRegular: 6315, usdAnual: 63150 },
  // Sprint 31 OO — Tier Global Titanio (multi-jurisdicción). Canonical display
  // figures in tiers.ts: clpRegular 949990, clpAnual 9119990, usdRegular 999.
  // Net (pre-IVA) CLP = round(display / 1.19) — same rule as the monthly rows
  // above (949990/1.19 = 798311; 9119990/1.19 = 7663857). usdAnual = usdRegular
  // * 10, matching every other row. Without this entry the webpay/MP/khipu
  // checkout endpoints returned 400 "Unknown tierId" for the canonical
  // 'global-titanio' id (the parity test below pins this against tiers.ts).
  'global-titanio': { clpRegular: 798311, clpAnual: 7663857, usdRegular: 999, usdAnual: 9990 },
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
