import { describe, expect, it } from 'vitest';
import { reconcileGooglePlayState } from './googlePlayState';
const sku = 'praeventio_cobre_monthly';
describe('RTDN canonical subscription state', () => {
  it('retains RFC3339 renewal expiry including fractional seconds', () => {
    expect(reconcileGooglePlayState({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems: [{ productId: sku, expiryTime: '2035-03-17T12:30:00.123Z' }] }, sku, 0)).toMatchObject({ active: true, expiryDate: '2035-03-17T12:30:00.123Z' });
  });
  it('keeps canceled subscription active until paid period expires', () => {
    const data = { subscriptionState: 'SUBSCRIPTION_STATE_CANCELED', lineItems: [{ productId: sku, expiryTime: '2035-01-01T00:00:00Z' }] };
    expect(reconcileGooglePlayState(data, sku, Date.parse('2034-12-31'))?.active).toBe(true);
    expect(reconcileGooglePlayState(data, sku, Date.parse('2035-01-02'))?.active).toBe(false);
  });
  it('rejects an unrelated SKU instead of granting the first line item', () => {
    expect(reconcileGooglePlayState({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems: [{ productId: 'different', expiryTime: '2035-01-01T00:00:00Z' }] }, sku, 0)).toBeNull();
  });
  it('does not manufacture a date or access from an invalid expiry', () => {
    expect(reconcileGooglePlayState({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems: [{ productId: sku, expiryTime: 'invalid' }] }, sku, 0)).toBeNull();
  });
});
