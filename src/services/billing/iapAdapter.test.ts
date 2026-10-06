import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: vi.fn(() => 'android') } }));
import { Capacitor } from '@capacitor/core';
import { IapAdapter, __setCapacitorIapPluginForTests } from './iapAdapter';
import { ALL_IAP_SKUS } from '../pricing/iapSkus';
const sku = 'praeventio_cobre_monthly';
const product = { identifier: 'monthly', planIdentifier: sku, offerToken: 'base-token', offerId: null, title: 'Cobre', price: 3.99, priceString: '$3.99', currencyCode: 'USD' };
function plugin() { return { getProducts: vi.fn(async () => ({ products: [product] })), purchaseProduct: vi.fn(async () => ({ productIdentifier: sku, purchaseToken: 'receipt', transactionId: 'not-the-receipt' })), getPurchases: vi.fn(async () => ({ purchases: [{ productIdentifier: sku, purchaseToken: 'receipt', transactionId: 'order', appAccountToken: 'account' }] })), restorePurchases: vi.fn() }; }
afterEach(() => { __setCapacitorIapPluginForTests(null); vi.mocked(Capacitor.getPlatform).mockReturnValue('android'); });
describe('Play subscription adapter', () => {
  it('queries the complete twelve SKU subscription catalog and normalizes SKU/base plan', async () => {
    const p = plugin(); __setCapacitorIapPluginForTests(p);
    const products = await new IapAdapter().listProducts();
    expect(p.getProducts).toHaveBeenCalledWith({ productIdentifiers: Object.keys(ALL_IAP_SKUS), productType: 'subs' });
    expect(products[0]).toMatchObject({ id: sku, basePlanId: 'monthly', offerToken: 'base-token', currency: 'USD', priceFormatted: '$3.99' });
  });
  it('purchases only the selected exact base plan and offer without acknowledging', async () => {
    const p = plugin(); __setCapacitorIapPluginForTests(p); const adapter = new IapAdapter();
    const [selected] = await adapter.listProducts();
    const result = await adapter.purchase(sku, 'google-play', { ...selected, accountId: 'account' });
    expect(p.purchaseProduct).toHaveBeenCalledWith(expect.objectContaining({ productIdentifier: sku, planIdentifier: 'monthly', offerToken: 'base-token', appAccountToken: 'account', autoAcknowledgePurchases: false, productType: 'subs' }));
    expect(result).toMatchObject({ success: true, productId: sku, receiptId: 'receipt' });
  });
  it('rejects an unavailable offer instead of selecting the first one', async () => {
    const p = plugin(); __setCapacitorIapPluginForTests(p); const a = new IapAdapter(); await a.listProducts();
    expect((await a.purchase(sku, 'google-play', { basePlanId: 'monthly', offerToken: 'wrong', accountId: 'account' })).success).toBe(false);
    expect(p.purchaseProduct).not.toHaveBeenCalled();
  });
  it('never substitutes a guessed CLP price for an unavailable store product', async () => {
    const p = plugin(); p.getProducts.mockResolvedValue({ products: [] }); __setCapacitorIapPluginForTests(p);
    expect(await new IapAdapter().listProducts()).toEqual([]);
  });
  it('restores via SUBS query and purchaseToken, without native auto-ACK restore', async () => {
    const p = plugin(); __setCapacitorIapPluginForTests(p);
    const results = await new IapAdapter().restorePurchases('account');
    expect(p.getPurchases).toHaveBeenCalledWith({ productType: 'subs', appAccountToken: 'account', onlyCurrentEntitlements: true });
    expect(results).toEqual([{ success: true, provider: 'google-play', productId: sku, receiptId: 'receipt' }]);
    expect(p.restorePurchases).not.toHaveBeenCalled();
  });
  it('does not expose another signed-in account receipt on restore', async () => {
    const p = plugin(); __setCapacitorIapPluginForTests(p);
    expect(await new IapAdapter().restorePurchases('other')).toEqual([]);
  });
  it('keeps web rails separate', async () => {
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    expect(IapAdapter.getAvailableProviders()).toEqual(['webpay', 'mercadopago', 'khipu']);
    expect((await new IapAdapter().purchase(sku)).success).toBe(false);
  });
});
