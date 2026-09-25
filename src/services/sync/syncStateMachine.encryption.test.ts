// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory as FDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { __resetDeviceKekForTests } from '../security/deviceKek';
import { __resetEncryptedKvForTests } from '../security/encryptedKvStore';
import { OfflineSyncStateMachine } from './syncStateMachine';

describe('OfflineSyncStateMachine encrypted persistence', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
  });

  it('persists ciphertext without the operation payload in the raw record', async () => {
    const sm = new OfflineSyncStateMachine({
      identityResolver: async () => ({
        ownerUid: 'user-a',
        tenantId: 'tenant-a',
        installationId: 'install-a',
        schemaVersion: 2,
      }),
    });
    sm.setOnlineGetter(() => false);
    await sm.ready();
    await sm.enqueue({
      type: 'create',
      collection: 'documents',
      data: { body: 'SECRET_QUEUE_PAYLOAD_9f6a' },
    });

    const db = await openDB('praeventio-encrypted-kv', 1);
    const records = await db.getAll('kv');
    const raw = JSON.stringify(records);
    expect(raw).not.toContain('SECRET_QUEUE_PAYLOAD_9f6a');
    expect(raw).toContain('ciphertext');
    sm._dispose();
  });
});
