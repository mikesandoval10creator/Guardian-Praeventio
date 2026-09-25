import { describe, expect, it } from 'vitest';
import {
  QUEUE_SCHEMA_VERSION,
  createQueueIdentityResolver,
  type QueueIdentityStorage,
} from './queueIdentity';

class MemoryStorage implements QueueIdentityStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('queue identity', () => {
  it('derives owner and tenant from Firebase auth claims and reuses the installation id', async () => {
    const storage = new MemoryStorage();
    const resolver = createQueueIdentityResolver({
      getCurrentUser: () => ({
        uid: 'auth-owner',
        getIdTokenResult: async () => ({
          claims: { tenantId: 'claim-tenant' },
        }),
      }),
      storage,
      createInstallationId: () => 'installation-1',
    });

    const first = await resolver();
    const second = await resolver();

    expect(first).toEqual({
      ownerUid: 'auth-owner',
      tenantId: 'claim-tenant',
      installationId: 'installation-1',
      schemaVersion: QUEUE_SCHEMA_VERSION,
    });
    expect(second).toEqual(first);
  });

  it('fails closed when auth or the tenant claim is unavailable', async () => {
    const noUser = createQueueIdentityResolver({
      getCurrentUser: () => null,
      storage: new MemoryStorage(),
    });
    const noTenant = createQueueIdentityResolver({
      getCurrentUser: () => ({
        uid: 'auth-owner',
        getIdTokenResult: async () => ({ claims: {} }),
      }),
      storage: new MemoryStorage(),
    });

    await expect(noUser()).resolves.toBeNull();
    await expect(noTenant()).resolves.toBeNull();
  });
});
