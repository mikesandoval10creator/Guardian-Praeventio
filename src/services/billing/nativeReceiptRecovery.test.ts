// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeReceiptRecovery } from './nativeReceiptRecovery';
const receipt = { success: true, provider: 'google-play' as const, receiptId: 'secret-token', productId: 'praeventio_cobre_monthly' };
let saved: Record<string, string>;
function fixture() {
  const store = { getItem: (k: string) => saved[k] ?? null, setItem: (k: string, v: string) => { saved[k] = v; }, removeItem: (k: string) => { delete saved[k]; } };
  const adapter = { restorePurchases: vi.fn(async () => [receipt]), purchase: vi.fn(async () => receipt) };
  const validate = vi.fn(async () => false);
  return { adapter, validate, service: new NativeReceiptRecovery(adapter, store, validate) };
}
beforeEach(() => { saved = {}; });
describe('durable native receipt recovery', () => {
  it('keeps interrupted validation pending, survives restart and retries without repurchase', async () => {
    const f = fixture();
    expect(await f.service.buy('user', 'account', receipt.productId, 'google-play', { basePlanId: 'monthly', offerToken: 'offer' })).toBe(false);
    expect(Object.values(saved).join()).not.toContain('secret-token');
    const second = fixture(); second.validate.mockResolvedValue(true);
    expect(await second.service.recover('user', 'account')).toBe(1);
    expect(second.adapter.purchase).not.toHaveBeenCalled();
    expect(saved).toEqual({});
  });
  it('does not purchase again while the same product already exists in Play', async () => {
    const f = fixture(); f.validate.mockResolvedValue(true);
    expect(await f.service.buy('user', 'account', receipt.productId, 'google-play', { basePlanId: 'monthly', offerToken: 'offer' })).toBe(true);
    expect(f.adapter.purchase).not.toHaveBeenCalled();
  });
  it('does not report HTTP validation failure as subscription success', async () => {
    const f = fixture(); expect(await f.service.recover('user', 'account')).toBe(0);
    expect(Object.values(saved).join()).toContain('praeventio_cobre_monthly');
  });
  it('retains pending metadata when authentication changes during validation', async () => {
    const f = fixture(); f.validate.mockRejectedValue(new Error('offline'));
    expect(await f.service.recover('user', 'account')).toBe(0);
    expect(Object.keys(saved)).toEqual(['iap.pending.user']);
    expect(await f.service.recover('other', 'other-account')).toBe(0);
    expect(Object.keys(saved)).toContain('iap.pending.user');
  });
});
