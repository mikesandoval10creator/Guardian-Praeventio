import { describe, expect, it } from 'vitest';
import { evaluateSubscriptionEntitlement } from './subscriptionEntitlement';

const NOW = new Date('2026-07-12T12:00:00.000Z');
const FUTURE = '2026-08-12T12:00:00.000Z';
const PAST = '2026-06-12T12:00:00.000Z';

describe('evaluateSubscriptionEntitlement', () => {
  it('keeps free access safe when there is no subscription record', () => {
    expect(evaluateSubscriptionEntitlement(undefined, NOW)).toMatchObject({
      entitled: false,
      effectivePlan: 'free',
      reason: 'missing_subscription',
    });
  });

  it('accepts an active invoice-backed paid subscription without an expiry date', () => {
    expect(
      evaluateSubscriptionEntitlement(
        { planId: 'oro', status: 'active', paymentMethod: 'webpay' },
        NOW,
      ),
    ).toEqual({
      entitled: true,
      effectivePlan: 'oro',
      reason: 'active',
      provider: 'webpay',
    });
  });

  it.each([
    ['app-store', { provider: 'app-store', appleOriginalTransactionId: 'apple-1' }],
    ['google-play', { purchaseToken: 'play-token' }],
  ])('accepts an active %s subscription with a future expiry', (provider, fields) => {
    expect(
      evaluateSubscriptionEntitlement(
        { planId: 'titanio', status: 'active', expiryDate: FUTURE, ...fields },
        NOW,
      ),
    ).toMatchObject({ entitled: true, effectivePlan: 'titanio', provider });
  });

  it.each(['expired', 'revoked', 'cancelled', 'canceled']) (
    'denies an explicitly %s paid subscription',
    (status) => {
      expect(
        evaluateSubscriptionEntitlement(
          { planId: 'diamante', status, paymentMethod: 'khipu' },
          NOW,
        ),
      ).toMatchObject({ entitled: false, effectivePlan: 'free', reason: 'inactive_status' });
    },
  );

  it('denies a paid plan whose lifecycle status is missing', () => {
    expect(
      evaluateSubscriptionEntitlement({ planId: 'oro', paymentMethod: 'webpay' }, NOW),
    ).toMatchObject({ entitled: false, effectivePlan: 'free', reason: 'missing_status' });
  });

  it('denies active status when expiryDate is already past', () => {
    expect(
      evaluateSubscriptionEntitlement(
        { planId: 'oro', status: 'active', paymentMethod: 'mercadopago', expiryDate: PAST },
        NOW,
      ),
    ).toMatchObject({ entitled: false, effectivePlan: 'free', reason: 'expired' });
  });

  it('denies a malformed expiryDate instead of treating it as perpetual', () => {
    expect(
      evaluateSubscriptionEntitlement(
        { planId: 'oro', status: 'active', paymentMethod: 'webpay', expiryDate: 'not-a-date' },
        NOW,
      ),
    ).toMatchObject({ entitled: false, effectivePlan: 'free', reason: 'invalid_expiry' });
  });

  it('allows grace_period only while gracePeriodEnd remains in the future', () => {
    expect(
      evaluateSubscriptionEntitlement(
        {
          planId: 'oro',
          status: 'grace_period',
          provider: 'app-store',
          expiryDate: PAST,
          gracePeriodEnd: FUTURE,
        },
        NOW,
      ),
    ).toMatchObject({ entitled: true, effectivePlan: 'oro', reason: 'grace_period' });

    expect(
      evaluateSubscriptionEntitlement(
        {
          planId: 'oro',
          status: 'grace_period',
          provider: 'app-store',
          expiryDate: PAST,
          gracePeriodEnd: PAST,
        },
        NOW,
      ),
    ).toMatchObject({ entitled: false, effectivePlan: 'free', reason: 'grace_period_expired' });
  });

  it('denies a mobile entitlement without a provider expiry', () => {
    expect(
      evaluateSubscriptionEntitlement(
        { planId: 'oro', status: 'active', provider: 'google-play' },
        NOW,
      ),
    ).toMatchObject({ entitled: false, effectivePlan: 'free', reason: 'missing_mobile_expiry' });
  });

  it('denies explicit unknown providers', () => {
    expect(
      evaluateSubscriptionEntitlement(
        { planId: 'oro', status: 'active', provider: 'untrusted-gateway' },
        NOW,
      ),
    ).toMatchObject({ entitled: false, effectivePlan: 'free', reason: 'unknown_provider' });
  });

  it('denies contradictory canonical provider metadata', () => {
    expect(
      evaluateSubscriptionEntitlement(
        {
          planId: 'oro',
          status: 'active',
          provider: 'app-store',
          paymentMethod: 'webpay',
          expiryDate: FUTURE,
        },
        NOW,
      ),
    ).toMatchObject({ entitled: false, effectivePlan: 'free', reason: 'provider_conflict' });
  });

  it('denies paid records with no verifiable provider metadata', () => {
    expect(
      evaluateSubscriptionEntitlement({ planId: 'oro', status: 'active' }, NOW),
    ).toMatchObject({ entitled: false, effectivePlan: 'free', reason: 'missing_provider' });
  });
});
