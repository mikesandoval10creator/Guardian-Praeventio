import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('firebase-admin/firestore', () => ({ FieldValue: { serverTimestamp: () => 'server-time' } }));
import { commitPlayEntitlement, drainPlayAcknowledgements, ReceiptOwnershipError } from './playEntitlement';
const sku = 'praeventio_cobre_monthly';
const verified = { ok: true as const, productId: sku, expiryMs: Date.parse('2035-01-01'), regionCode: 'CL', linkedPurchaseToken: null, subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', obfuscatedAccountId: 'owner-account', needsAcknowledgement: true };
function database() {
  const data = new Map<string, Record<string, unknown>>(); let failCommit = false;
  const ref = (path: string) => ({ path, id: path.split('/').at(-1), get: async () => ({ exists: data.has(path), data: () => data.get(path) }), set: async (v: Record<string, unknown>) => data.set(path, v), update: async (v: Record<string, unknown>) => data.set(path, { ...data.get(path), ...v }) });
  const db = { collection: (name: string) => ({ doc: (id = 'audit') => ref(`${name}/${id}`), where: () => ({ limit: () => ({ get: async () => ({ docs: [...data].filter(([k,v]) => k.startsWith(`${name}/`) && v.status === 'pending').map(([path,v]) => ({ ref: ref(path), data: () => v })) }) }) }) }), runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => { const writes: Array<() => void> = []; const tx = { get: (r: ReturnType<typeof ref>) => r.get(), set: (r: ReturnType<typeof ref>, v: Record<string, unknown>) => writes.push(() => { data.set(r.path, v); }), update: (r: ReturnType<typeof ref>, v: Record<string, unknown>) => writes.push(() => { data.set(r.path, { ...data.get(r.path), ...v }); }) }; const value = await fn(tx); if (failCommit) throw new Error('firestore unavailable'); writes.forEach(w => w()); return value; } };
  return { db, data, fail: () => { failCommit = true; } };
}
describe('transactional receipt ownership and post-grant ACK', () => {
  it('commits access, owner binding and pending ACK together before any external ACK', async () => {
    const f = database(); await commitPlayEntitlement(f.db as never, 'alice', 'token', verified, 'owner-account');
    expect(f.data.get('users/alice')).toMatchObject({ 'subscription.planId': 'cobre', 'subscription.status': 'active' });
    expect([...f.data.keys()].some(k => k.startsWith('play_ack_jobs/'))).toBe(true);
    expect([...f.data.keys()].some(k => k.startsWith('audit_logs/'))).toBe(true);
  });
  it('rejects claiming another account obfuscated identifier', async () => {
    const f = database(); await expect(commitPlayEntitlement(f.db as never, 'bob', 'token', verified, 'other-account')).rejects.toBeInstanceOf(ReceiptOwnershipError);
    expect(f.data.size).toBe(0);
  });
  it('rejects replay of an already-bound receipt by another user', async () => {
    const f = database(); await commitPlayEntitlement(f.db as never, 'alice', 'token', verified, 'owner-account');
    await expect(commitPlayEntitlement(f.db as never, 'bob', 'token', { ...verified, obfuscatedAccountId: null }, 'other-account')).rejects.toBeInstanceOf(ReceiptOwnershipError);
    expect(f.data.has('users/bob')).toBe(false);
  });
  it('leaves no ACK work after entitlement transaction fails', async () => {
    const f = database(); f.fail(); await expect(commitPlayEntitlement(f.db as never, 'alice', 'token', verified, 'owner-account')).rejects.toThrow('firestore unavailable');
    const ack = vi.fn(); await drainPlayAcknowledgements(f.db as never, ack);
    expect(ack).not.toHaveBeenCalled();
  });
  it('retries transient acknowledgement on a later sweep and records completion', async () => {
    const f = database(); await commitPlayEntitlement(f.db as never, 'alice', 'token', verified, 'owner-account');
    const ack = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(undefined);
    await drainPlayAcknowledgements(f.db as never, ack, 1000);
    expect([...f.data.values()].some(v => v.status === 'pending')).toBe(true);
    await drainPlayAcknowledgements(f.db as never, ack, 121000);
    expect([...f.data.values()].some(v => v.status === 'done')).toBe(true);
    expect(ack).toHaveBeenCalledTimes(2);
  });
  it('fails closed for legacy unbound tokens with no Play account identifier', async () => {
    const f = database(); await expect(commitPlayEntitlement(f.db as never, 'alice', 'token', { ...verified, obfuscatedAccountId: null }, 'owner-account')).rejects.toBeInstanceOf(ReceiptOwnershipError);
  });
});
