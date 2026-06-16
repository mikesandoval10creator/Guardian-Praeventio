import type { TierId } from './tiers';
import { tierForIapSku, type BillingCycle } from './iapSkus';

// Re-export so callers have a single import site for plan + cycle helpers.
export type { BillingCycle };

export const SUBSCRIPTION_PLANS = [
  'free',
  'cobre',
  'plata',
  'oro',
  'titanio',
  'platino',
  'diamante',
] as const;

export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const TIER_TO_SUBSCRIPTION_PLAN: Record<TierId, SubscriptionPlan> = {
  gratis: 'free',
  cobre: 'cobre',
  plata: 'plata',
  oro: 'oro',
  titanio: 'titanio',
  platino: 'platino',
  diamante: 'diamante',
};

const SUBSCRIPTION_PLAN_SET: ReadonlySet<string> = new Set(SUBSCRIPTION_PLANS);

// Legacy aliases — map the PRE-collapse (2026-06-15) tier ids + plan names onto
// the 7-metal scheme so any stale string (old Firestore value, old test, old
// link) normalizes cleanly. closest-capacity-UP, never downgrade:
//   comité/comite-paritario → Plata (CPHS band)
//   departamento(-prevencion) → Oro (DPRP band)
//   empresarial/corporativo → Platino (enterprise band)
//   ilimitado/global-titanio → Diamante (unlimited + global)
const LEGACY_ALIASES: Record<string, SubscriptionPlan> = {
  premium: 'oro',
  basic: 'cobre',
  comite: 'plata',
  'comite-paritario': 'plata',
  departamento: 'oro',
  'departamento-prevencion': 'oro',
  empresarial: 'platino',
  corporativo: 'platino',
  ilimitado: 'diamante',
  'global-titanio': 'diamante',
};

export function isSubscriptionPlan(value: unknown): value is SubscriptionPlan {
  return typeof value === 'string' && SUBSCRIPTION_PLAN_SET.has(value);
}

export function subscriptionPlanForPaidTier(tierId: unknown): SubscriptionPlan | null {
  return typeof tierId === 'string'
    ? TIER_TO_SUBSCRIPTION_PLAN[tierId as TierId] ?? null
    : null;
}

export function normalizeSubscriptionPlanId(value: unknown): SubscriptionPlan | null {
  if (typeof value !== 'string') return null;
  if (isSubscriptionPlan(value)) return value;
  return LEGACY_ALIASES[value] ?? subscriptionPlanForPaidTier(value);
}

export function subscriptionPlanMatchesPaidTier(
  requestedPlan: SubscriptionPlan,
  paidTierId: unknown,
): boolean {
  return normalizeSubscriptionPlanId(paidTierId) === requestedPlan;
}

/**
 * Canonical plan ranking, lowest (free) → highest (diamante). SINGLE SOURCE OF
 * TRUTH for tier comparisons, used by BOTH the client feature matrix
 * (`SubscriptionContext`) and the SERVER enforcement middleware
 * (`requireTier`). Tier-gating is UX-only on the client (directive #11) — the
 * authoritative check reads `users/{uid}.subscription.planId` server-side and
 * compares ranks here.
 */
export const PLAN_RANK: Record<SubscriptionPlan, number> = {
  free: 0,
  cobre: 1,
  plata: 2,
  oro: 3,
  titanio: 4,
  platino: 5,
  diamante: 6,
};

/**
 * Rank for an arbitrary (possibly legacy/unknown) plan value. Unknown or
 * missing values resolve to the free-tier rank (0) — fail-closed: an
 * unrecognized plan never satisfies a paid gate.
 */
export function planRank(plan: unknown): number {
  const normalized = normalizeSubscriptionPlanId(plan);
  return normalized ? PLAN_RANK[normalized] : 0;
}

/** True iff `plan` ranks at or above `minPlan`. */
export function planMeetsMinimum(plan: unknown, minPlan: SubscriptionPlan): boolean {
  return planRank(plan) >= PLAN_RANK[minPlan];
}

// ───────────────────────────────────────────────────────────────────────────
// Billing cycle resolution (monthly | annual) for subscription activation.
//
// Today every payment rail activates users/{uid}.subscription without the
// billing cycle — it only lives in the invoice line-item description string. To
// persist it on the subscription doc consistently, each rail resolves the cycle
// from SERVER-SIDE state (the persisted invoice doc, or a store-verified IAP
// productId) — NEVER from the IPN/return request body — via these pure helpers.
// They are TOTAL (never throw) so the rails' best-effort activation try/catch
// (CLAUDE.md #14) is preserved.
// ───────────────────────────────────────────────────────────────────────────

/** Safe default when a paid subscription's billing cycle can't be derived. */
export const DEFAULT_SUBSCRIPTION_CYCLE: BillingCycle = 'monthly';

/**
 * Resolve the billing cycle from a persisted invoice document. Reads the
 * structured top-level `cycle` first; falls back to parsing the first line
 * item's description (`Suscripción <tier> (<cycle>)`) for legacy invoices that
 * predate the structured field; else the safe monthly default. Pure + total.
 */
export function cycleFromInvoiceDoc(
  invoiceData: Record<string, unknown> | null | undefined,
): BillingCycle {
  if (!invoiceData) return DEFAULT_SUBSCRIPTION_CYCLE;
  const top = invoiceData.cycle;
  if (top === 'monthly' || top === 'annual') return top;
  const lineItems = invoiceData.lineItems;
  if (Array.isArray(lineItems) && lineItems.length > 0) {
    const desc = (lineItems[0] as { description?: unknown } | null)?.description;
    if (typeof desc === 'string') {
      if (/\(annual\)/i.test(desc)) return 'annual';
      if (/\(monthly\)/i.test(desc)) return 'monthly';
    }
  }
  return DEFAULT_SUBSCRIPTION_CYCLE;
}

/**
 * Resolve the billing cycle from a store-verified IAP productId/SKU. Uses
 * `tierForIapSku` (returns null on unknown — never throws, unlike
 * `iapSkuForTier`). Unknown/missing SKU → safe monthly default. Pure + total.
 */
export function cycleFromProductId(
  productId: string | null | undefined,
): BillingCycle {
  if (!productId) return DEFAULT_SUBSCRIPTION_CYCLE;
  return tierForIapSku(productId)?.cycle ?? DEFAULT_SUBSCRIPTION_CYCLE;
}

/**
 * Resolve the subscription PLAN from an IAP productId/SKU. The store sends a SKU
 * (e.g. 'praeventio_oro_annual'), NOT a plan/tier id, so it must be mapped
 * SKU → tierId (tierForIapSku) → plan. Falls back to treating the input as a
 * tier/plan id directly (for callers that already hold one). Returns null when
 * unresolvable. Pure + total.
 *
 * Bug context: feeding a raw SKU straight to normalizeSubscriptionPlanId always
 * returned null, so IAP purchases were mis-granted the legacy 'comite' fallback
 * regardless of what was actually bought. This is the single correct resolver.
 */
export function planFromIapProductId(
  productId: string | null | undefined,
): SubscriptionPlan | null {
  if (!productId) return null;
  return normalizeSubscriptionPlanId(tierForIapSku(productId)?.tierId ?? productId);
}
