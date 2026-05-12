import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  __setGooglePlayClientForTests,
  validateGooglePlaySubscription,
} from './googlePlayValidator.js';

// ───────────────────────────────────────────────────────────────────────────
// Mock client factory — returns just the surface our validator touches.
// ───────────────────────────────────────────────────────────────────────────
function buildMockClient(opts: {
  getImpl?: (args: any) => Promise<any> | any;
  acknowledgeImpl?: (args: any) => Promise<any> | any;
}) {
  return {
    purchases: {
      subscriptionsv2: {
        get: vi.fn(opts.getImpl ?? (() => Promise.resolve({ data: {} }))),
      },
      subscriptions: {
        acknowledge: vi.fn(opts.acknowledgeImpl ?? (() => Promise.resolve({}))),
      },
    },
  } as any;
}

const FAR_FUTURE_ISO = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
const PAST_ISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

describe('validateGooglePlaySubscription', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.ANDROID_PACKAGE_NAME = 'com.praeventio.guard';
    delete process.env.GOOGLE_PLAY_ALLOW_TEST_PURCHASES;
  });

  afterEach(() => {
    __setGooglePlayClientForTests(null);
    process.env = { ...originalEnv };
  });

  it('returns config_missing when ANDROID_PACKAGE_NAME is unset', async () => {
    delete process.env.ANDROID_PACKAGE_NAME;
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('config_missing'); }
  });

  it('grants entitlement when subscription is ACTIVE and product matches', async () => {
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => ({
          data: {
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
            regionCode: 'CL',
            lineItems: [
              { productId: 'praeventio_premium_monthly', expiryTime: FAR_FUTURE_ISO },
            ],
          },
        }),
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.regionCode).toBe('CL');
      expect(result.expiryMs).toBeGreaterThan(Date.now());
      expect(result.productId).toBe('praeventio_premium_monthly');
      expect(result.subscriptionState).toBe('SUBSCRIPTION_STATE_ACTIVE');
    }
  });

  it('rejects with product_mismatch when claimed product is not in lineItems', async () => {
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => ({
          data: {
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            lineItems: [
              { productId: 'some_other_product', expiryTime: FAR_FUTURE_ISO },
            ],
          },
        }),
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('product_mismatch'); }
  });

  it('rejects with subscription_inactive when state is EXPIRED', async () => {
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => ({
          data: {
            subscriptionState: 'SUBSCRIPTION_STATE_EXPIRED',
            lineItems: [
              { productId: 'praeventio_premium_monthly', expiryTime: FAR_FUTURE_ISO },
            ],
          },
        }),
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('subscription_inactive'); }
  });

  it('rejects with expired when expiryTime is in the past', async () => {
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => ({
          data: {
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            lineItems: [
              { productId: 'praeventio_premium_monthly', expiryTime: PAST_ISO },
            ],
          },
        }),
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('expired'); }
  });

  it('rejects test purchases by default in prod', async () => {
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => ({
          data: {
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            testPurchase: true,
            lineItems: [
              { productId: 'praeventio_premium_monthly', expiryTime: FAR_FUTURE_ISO },
            ],
          },
        }),
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('test_purchase'); }
  });

  it('allows test purchases when GOOGLE_PLAY_ALLOW_TEST_PURCHASES=true', async () => {
    process.env.GOOGLE_PLAY_ALLOW_TEST_PURCHASES = 'true';
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => ({
          data: {
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            testPurchase: true,
            lineItems: [
              { productId: 'praeventio_premium_monthly', expiryTime: FAR_FUTURE_ISO },
            ],
          },
        }),
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(true);
  });

  it('grants for SUBSCRIPTION_STATE_CANCELED while still in paid period', async () => {
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => ({
          data: {
            subscriptionState: 'SUBSCRIPTION_STATE_CANCELED',
            lineItems: [
              { productId: 'praeventio_premium_monthly', expiryTime: FAR_FUTURE_ISO },
            ],
          },
        }),
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(true);
  });

  it('maps 404 from Google to token_not_found', async () => {
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => {
          const err: any = new Error('Purchase token not found');
          err.code = 404;
          err.errors = [{ reason: 'purchaseTokenNotFound' }];
          throw err;
        },
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('token_not_found'); }
  });

  it('maps 410 from Google to token_replaced', async () => {
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => {
          const err: any = new Error('Token replaced');
          err.code = 410;
          throw err;
        },
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('token_replaced'); }
  });

  it('maps 401/403 to permission_denied (operator error, not user fraud)', async () => {
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => {
          const err: any = new Error('Permission denied');
          err.code = 403;
          throw err;
        },
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('permission_denied'); }
  });

  it('maps 503/429 to transient_error (client should retry)', async () => {
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => {
          const err: any = new Error('Service unavailable');
          err.code = 503;
          throw err;
        },
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(false);
    if (result.ok === false) { expect(result.reason).toBe('transient_error'); }
  });

  it('auto-acknowledges when acknowledgementState is PENDING', async () => {
    const acknowledge = vi.fn(() => Promise.resolve({}));
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => ({
          data: {
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
            lineItems: [
              { productId: 'praeventio_premium_monthly', expiryTime: FAR_FUTURE_ISO },
            ],
          },
        }),
        acknowledgeImpl: acknowledge,
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(true);
    expect(acknowledge).toHaveBeenCalledOnce();
  });

  it('still grants when acknowledge fails (user paid, retry handled by RTDN)', async () => {
    __setGooglePlayClientForTests(
      buildMockClient({
        getImpl: () => ({
          data: {
            subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
            acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
            lineItems: [
              { productId: 'praeventio_premium_monthly', expiryTime: FAR_FUTURE_ISO },
            ],
          },
        }),
        acknowledgeImpl: () => {
          throw new Error('Acknowledge transient failure');
        },
      }),
    );
    const result = await validateGooglePlaySubscription('tok', 'praeventio_premium_monthly');
    expect(result.ok).toBe(true);
  });
});
