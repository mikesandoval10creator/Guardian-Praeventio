import {
  normalizeSubscriptionPlanId,
  type SubscriptionPlan,
} from './subscriptionPlan';

export const SUBSCRIPTION_PROVIDERS = [
  'app-store',
  'google-play',
  'webpay',
  'mercadopago',
  'khipu',
  'manual',
] as const;

export type SubscriptionProvider = (typeof SUBSCRIPTION_PROVIDERS)[number];

export type SubscriptionEntitlementReason =
  | 'active'
  | 'grace_period'
  | 'free_plan'
  | 'missing_subscription'
  | 'invalid_plan'
  | 'missing_status'
  | 'inactive_status'
  | 'missing_provider'
  | 'unknown_provider'
  | 'provider_conflict'
  | 'invalid_expiry'
  | 'expired'
  | 'missing_mobile_expiry'
  | 'invalid_grace_period'
  | 'grace_period_expired';

export interface SubscriptionEntitlement {
  entitled: boolean;
  effectivePlan: SubscriptionPlan;
  reason: SubscriptionEntitlementReason;
  provider?: SubscriptionProvider;
}

/** True when a recognized paid plan was declared but failed lifecycle validation. */
export function isInvalidPaidEntitlement(result: SubscriptionEntitlement): boolean {
  return (
    !result.entitled &&
    result.reason !== 'free_plan' &&
    result.reason !== 'missing_subscription' &&
    result.reason !== 'invalid_plan'
  );
}

type UnknownRecord = Record<string, unknown>;

const PROVIDER_SET: ReadonlySet<string> = new Set(SUBSCRIPTION_PROVIDERS);
const MOBILE_PROVIDERS: ReadonlySet<SubscriptionProvider> = new Set([
  'app-store',
  'google-play',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeSubscriptionProvider(value: unknown): SubscriptionProvider | null {
  if (value === 'manual-transfer') return 'manual';
  return typeof value === 'string' && PROVIDER_SET.has(value)
    ? (value as SubscriptionProvider)
    : null;
}

type ProviderResolution =
  | { ok: true; provider: SubscriptionProvider }
  | { ok: false; reason: 'missing_provider' | 'unknown_provider' | 'provider_conflict' };

function resolveProvider(subscription: UnknownRecord): ProviderResolution {
  const hasExplicitProvider = subscription.provider !== undefined;
  const hasPaymentMethod = subscription.paymentMethod !== undefined;
  const explicitProvider = normalizeSubscriptionProvider(subscription.provider);
  const paymentProvider = normalizeSubscriptionProvider(subscription.paymentMethod);

  if (hasExplicitProvider && explicitProvider === null) {
    return { ok: false, reason: 'unknown_provider' };
  }
  if (hasPaymentMethod && paymentProvider === null) {
    return { ok: false, reason: 'unknown_provider' };
  }
  if (explicitProvider && paymentProvider && explicitProvider !== paymentProvider) {
    return { ok: false, reason: 'provider_conflict' };
  }
  if (explicitProvider || paymentProvider) {
    const provider = explicitProvider ?? paymentProvider;
    if (provider) return { ok: true, provider };
  }

  const hasAppleIdentity =
    typeof subscription.appleOriginalTransactionId === 'string' ||
    typeof subscription.appleAppAccountToken === 'string';
  const hasGoogleIdentity = typeof subscription.purchaseToken === 'string';

  if (hasAppleIdentity && hasGoogleIdentity) {
    return { ok: false, reason: 'provider_conflict' };
  }
  if (hasAppleIdentity) return { ok: true, provider: 'app-store' };
  if (hasGoogleIdentity) return { ok: true, provider: 'google-play' };
  return { ok: false, reason: 'missing_provider' };
}

function timestampMs(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = typeof value === 'number' ? value : Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (isRecord(value)) {
    const toDate = value.toDate;
    if (typeof toDate === 'function') {
      try {
        const date = toDate.call(value);
        return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : null;
      } catch {
        return null;
      }
    }
    const seconds = value.seconds ?? value._seconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds)) return seconds * 1000;
  }
  return null;
}

function denied(
  reason: Exclude<SubscriptionEntitlementReason, 'active' | 'grace_period'>,
  provider?: SubscriptionProvider,
): SubscriptionEntitlement {
  return {
    entitled: false,
    effectivePlan: 'free',
    reason,
    ...(provider ? { provider } : {}),
  };
}

/**
 * Resolve the paid plan that may actually authorize features at `now`.
 *
 * This function is intentionally client-safe and pure: billing rails produce
 * lifecycle fields, while both the server gate and client UX consume this one
 * policy. Every malformed or incomplete paid record fails closed to `free`.
 */
export function evaluateSubscriptionEntitlement(
  value: unknown,
  now: Date = new Date(),
): SubscriptionEntitlement {
  if (!isRecord(value)) return denied('missing_subscription');

  const plan = normalizeSubscriptionPlanId(value.planId);
  if (!plan) return denied('invalid_plan');
  if (plan === 'free') return denied('free_plan');

  const status = typeof value.status === 'string' ? value.status.toLowerCase() : null;
  if (!status) return denied('missing_status');

  const providerResult = resolveProvider(value);
  if (!providerResult.ok) return denied(providerResult.reason);
  const { provider } = providerResult;

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return denied('invalid_expiry', provider);

  if (status === 'grace_period') {
    const graceEndMs = timestampMs(value.gracePeriodEnd);
    if (graceEndMs === null) return denied('invalid_grace_period', provider);
    if (graceEndMs <= nowMs) return denied('grace_period_expired', provider);
    return { entitled: true, effectivePlan: plan, reason: 'grace_period', provider };
  }

  if (status !== 'active') return denied('inactive_status', provider);

  const hasExpiry = value.expiryDate !== undefined && value.expiryDate !== null;
  if (!hasExpiry && MOBILE_PROVIDERS.has(provider)) {
    return denied('missing_mobile_expiry', provider);
  }
  if (hasExpiry) {
    const expiryMs = timestampMs(value.expiryDate);
    if (expiryMs === null) return denied('invalid_expiry', provider);
    if (expiryMs <= nowMs) return denied('expired', provider);
  }

  return { entitled: true, effectivePlan: plan, reason: 'active', provider };
}
