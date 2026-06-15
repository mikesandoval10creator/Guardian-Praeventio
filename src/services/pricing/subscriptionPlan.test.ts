import { describe, expect, it } from 'vitest';

import {
  isSubscriptionPlan,
  normalizeSubscriptionPlanId,
  subscriptionPlanForPaidTier,
} from './subscriptionPlan';

describe('subscription plan normalization (7-metal scheme)', () => {
  it('maps canonical tier ids to plan ids (1:1 in the 7-metal scheme)', () => {
    expect(subscriptionPlanForPaidTier('gratis')).toBe('free');
    expect(subscriptionPlanForPaidTier('cobre')).toBe('cobre');
    expect(subscriptionPlanForPaidTier('plata')).toBe('plata');
    expect(subscriptionPlanForPaidTier('diamante')).toBe('diamante');
  });

  it('normalizes pre-collapse legacy ids onto the 7-metal scheme (closest-up)', () => {
    expect(normalizeSubscriptionPlanId('comite-paritario')).toBe('plata');
    expect(normalizeSubscriptionPlanId('comite')).toBe('plata');
    expect(normalizeSubscriptionPlanId('departamento-prevencion')).toBe('oro');
    expect(normalizeSubscriptionPlanId('departamento')).toBe('oro');
    expect(normalizeSubscriptionPlanId('empresarial')).toBe('platino');
    expect(normalizeSubscriptionPlanId('corporativo')).toBe('platino');
    expect(normalizeSubscriptionPlanId('ilimitado')).toBe('diamante');
    expect(normalizeSubscriptionPlanId('global-titanio')).toBe('diamante');
  });

  it('maps the older premium/basic aliases', () => {
    expect(normalizeSubscriptionPlanId('premium')).toBe('oro');
    expect(normalizeSubscriptionPlanId('basic')).toBe('cobre');
  });

  it('keeps current plan ids stable', () => {
    expect(normalizeSubscriptionPlanId('oro')).toBe('oro');
    expect(normalizeSubscriptionPlanId('cobre')).toBe('cobre');
  });

  it('rejects unknown ids instead of casting them into the entitlement system', () => {
    expect(normalizeSubscriptionPlanId('galactic-emperor')).toBeNull();
    expect(isSubscriptionPlan('galactic-emperor')).toBe(false);
  });
});
