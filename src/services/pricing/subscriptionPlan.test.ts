import { describe, expect, it } from 'vitest';

import {
  isSubscriptionPlan,
  normalizeSubscriptionPlanId,
  subscriptionPlanForPaidTier,
} from './subscriptionPlan';

describe('subscription plan normalization', () => {
  it('maps canonical pricing tier ids to legacy subscription plan ids', () => {
    expect(subscriptionPlanForPaidTier('gratis')).toBe('free');
    expect(subscriptionPlanForPaidTier('comite-paritario')).toBe('comite');
    expect(subscriptionPlanForPaidTier('departamento-prevencion')).toBe('departamento');
    expect(subscriptionPlanForPaidTier('diamante')).toBe('platino');
    expect(subscriptionPlanForPaidTier('global-titanio')).toBe('ilimitado');
  });

  it('keeps existing legacy subscription ids stable', () => {
    expect(normalizeSubscriptionPlanId('oro')).toBe('oro');
    expect(normalizeSubscriptionPlanId('premium')).toBe('departamento');
    expect(normalizeSubscriptionPlanId('basic')).toBe('comite');
  });

  it('rejects unknown ids instead of casting them into the entitlement system', () => {
    expect(normalizeSubscriptionPlanId('galactic-emperor')).toBeNull();
    expect(isSubscriptionPlan('galactic-emperor')).toBe(false);
  });
});
