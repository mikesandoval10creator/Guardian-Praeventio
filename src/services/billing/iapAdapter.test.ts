// Praeventio Guard — IapAdapter unit tests.
//
// Capacitor's `getPlatform()` is mocked per-test so we can rotate web /
// android / ios without spinning up a Capacitor runtime. The
// `@capacitor-community/in-app-purchases` plugin is injected via
// `__setCapacitorIapPluginForTests` because it is not installed in the
// vitest environment (and must not be — these tests run in node).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'web'),
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => true),
  },
}));

import { Capacitor } from '@capacitor/core';
import {
  IapAdapter,
  iapAdapter,
  __setCapacitorIapPluginForTests,
} from './iapAdapter.js';

const mockedGetPlatform = Capacitor.getPlatform as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  mockedGetPlatform.mockReturnValue('web');
  __setCapacitorIapPluginForTests(null);
});

afterEach(() => {
  __setCapacitorIapPluginForTests(null);
  vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
// Test 1 — web platform exposes the three local CL/LATAM rails.
// ───────────────────────────────────────────────────────────────────────────
describe('IapAdapter.getAvailableProviders', () => {
  it('web → [webpay, mercadopago, khipu]', () => {
    mockedGetPlatform.mockReturnValue('web');
    expect(IapAdapter.getAvailableProviders()).toEqual([
      'webpay',
      'mercadopago',
      'khipu',
    ]);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 2 — android platform exposes only google-play (store policy).
  // ─────────────────────────────────────────────────────────────────────
  it('android → [google-play]', () => {
    mockedGetPlatform.mockReturnValue('android');
    expect(IapAdapter.getAvailableProviders()).toEqual(['google-play']);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 3 — ios platform exposes only app-store (store policy).
  // ─────────────────────────────────────────────────────────────────────
  it('ios → [app-store]', () => {
    mockedGetPlatform.mockReturnValue('ios');
    expect(IapAdapter.getAvailableProviders()).toEqual(['app-store']);
  });
});

describe('IapAdapter.getPlatform', () => {
  it('falls back to web when Capacitor throws', () => {
    mockedGetPlatform.mockImplementationOnce(() => {
      throw new Error('not initialised');
    });
    expect(IapAdapter.getPlatform()).toBe('web');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Test 4 — listProducts on web returns the static catalogue.
// ───────────────────────────────────────────────────────────────────────────
describe('IapAdapter.listProducts', () => {
  it('web returns the static CLP catalogue', async () => {
    mockedGetPlatform.mockReturnValue('web');
    const products = await iapAdapter.listProducts();
    expect(products.length).toBeGreaterThanOrEqual(1);
    expect(products[0]).toMatchObject({
      id: 'praeventio_premium_monthly',
      type: 'subscription',
      priceClp: 9990,
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 5 — listProducts on android queries the Capacitor plugin and
  //         passes through the store's localized priceString.
  // ─────────────────────────────────────────────────────────────────────
  it('android queries the Capacitor plugin and uses store priceString', async () => {
    mockedGetPlatform.mockReturnValue('android');
    const getProducts = vi.fn(async () => ({
      products: [
        {
          productId: 'praeventio_premium_monthly',
          title: 'Praeventio Premium Mensual',
          priceString: 'CLP $9,990.00',
          priceMicros: 9_990_000_000,
          type: 'subs' as const,
        },
      ],
    }));
    __setCapacitorIapPluginForTests({
      getProducts,
      purchase: vi.fn(),
      restorePurchases: vi.fn(),
    });

    const products = await iapAdapter.listProducts();
    expect(getProducts).toHaveBeenCalledWith({
      productIds: expect.arrayContaining(['praeventio_premium_monthly']),
    });
    expect(products[0].priceFormatted).toBe('CLP $9,990.00');
    expect(products[0].priceClp).toBe(9990);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Test 6 — purchase on android calls the plugin and surfaces the receipt.
// ───────────────────────────────────────────────────────────────────────────
describe('IapAdapter.purchase', () => {
  it('android calls plugin.purchase and returns purchaseToken as receiptId', async () => {
    mockedGetPlatform.mockReturnValue('android');
    const purchase = vi.fn(async () => ({
      productId: 'praeventio_premium_monthly',
      purchaseToken: 'play-token-abc-123',
    }));
    __setCapacitorIapPluginForTests({
      getProducts: vi.fn(),
      purchase,
      restorePurchases: vi.fn(),
    });

    const result = await iapAdapter.purchase('praeventio_premium_monthly');
    expect(purchase).toHaveBeenCalledWith({
      productId: 'praeventio_premium_monthly',
      type: 'subs',
    });
    expect(result).toEqual({
      success: true,
      provider: 'google-play',
      receiptId: 'play-token-abc-123',
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 7 — purchase on ios falls through to the same plugin contract.
  // ─────────────────────────────────────────────────────────────────────
  it('ios calls plugin.purchase with app-store provider', async () => {
    mockedGetPlatform.mockReturnValue('ios');
    const purchase = vi.fn(async () => ({
      productId: 'praeventio_premium_monthly',
      transactionId: 'apple-tx-1',
      receipt: 'apple-receipt-blob',
    }));
    __setCapacitorIapPluginForTests({
      getProducts: vi.fn(),
      purchase,
      restorePurchases: vi.fn(),
    });

    const result = await iapAdapter.purchase('praeventio_premium_monthly');
    expect(result.success).toBe(true);
    expect(result.provider).toBe('app-store');
    expect(result.receiptId).toBe('apple-tx-1');
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 8 — purchase on web does NOT call any store rail. It returns a
  //         clear error directing callers to the existing /api/billing
  //         checkout flow (so future bugs that wire `iapAdapter.purchase`
  //         on web fail loudly instead of silently dropping the user).
  // ─────────────────────────────────────────────────────────────────────
  it('web refuses the unified call and points at the checkout endpoints', async () => {
    mockedGetPlatform.mockReturnValue('web');
    const result = await iapAdapter.purchase(
      'praeventio_premium_monthly',
      'webpay',
    );
    expect(result.success).toBe(false);
    expect(result.provider).toBe('webpay');
    expect(result.errorMessage).toMatch(/Pricing checkout/i);
  });

  // ─────────────────────────────────────────────────────────────────────
  // Test 9 — refusing a provider that is unavailable on the platform.
  // ─────────────────────────────────────────────────────────────────────
  it('android refuses webpay (not available on this platform)', async () => {
    mockedGetPlatform.mockReturnValue('android');
    __setCapacitorIapPluginForTests({
      getProducts: vi.fn(),
      purchase: vi.fn(),
      restorePurchases: vi.fn(),
    });
    const result = await iapAdapter.purchase(
      'praeventio_premium_monthly',
      'webpay',
    );
    expect(result.success).toBe(false);
    expect(result.errorMessage).toMatch(/not available/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Test 10 — restorePurchases on web is a no-op; native delegates to plugin.
// ───────────────────────────────────────────────────────────────────────────
describe('IapAdapter.restorePurchases', () => {
  it('web returns an empty list', async () => {
    mockedGetPlatform.mockReturnValue('web');
    const result = await iapAdapter.restorePurchases();
    expect(result).toEqual([]);
  });

  it('ios calls plugin.restorePurchases and maps receipts', async () => {
    mockedGetPlatform.mockReturnValue('ios');
    const restorePurchases = vi.fn(async () => ({
      purchases: [
        {
          productId: 'praeventio_premium_monthly',
          transactionId: 'apple-restore-1',
        },
      ],
    }));
    __setCapacitorIapPluginForTests({
      getProducts: vi.fn(),
      purchase: vi.fn(),
      restorePurchases,
    });
    const result = await iapAdapter.restorePurchases();
    expect(result).toEqual([
      {
        success: true,
        provider: 'app-store',
        receiptId: 'apple-restore-1',
      },
    ]);
  });
});
