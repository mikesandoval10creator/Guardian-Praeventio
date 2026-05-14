// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import FDBFactory from 'fake-indexeddb/lib/FDBFactory';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearOutboxNamespace,
  createEncryptedOutboxAdapter,
  listOutboxNamespaces,
} from './encryptedOutboxAdapter';
import {
  GenericOutboxEngine,
  type OutboxEntry,
  type OutboxEvent,
} from './genericOutboxEngine';
import { __resetEncryptedKvForTests } from '../security/encryptedKvStore';
import { __resetDeviceKekForTests } from '../security/deviceKek';

interface FakePayload {
  title: string;
  workerUid?: string;
}

function entry(
  id: string,
  over: Partial<OutboxEntry<FakePayload>> = {},
): OutboxEntry<FakePayload> {
  const event: OutboxEvent<FakePayload> = {
    clientEventId: id,
    kind: 'fake',
    priority: 'normal',
    payload: { title: `event ${id}` },
    occurredAt: '2026-05-14T10:00:00Z',
    ...over.event,
  };
  return {
    event,
    queuedAt: '2026-05-14T10:00:01Z',
    retryCount: 0,
    nextRetryAt: 1000,
    ...over,
  };
}

describe('createEncryptedOutboxAdapter — basic CRUD', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
  });

  afterEach(() => {
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
  });

  it('lista vacía al inicio', async () => {
    const adapter = createEncryptedOutboxAdapter<FakePayload>('incidents');
    expect(await adapter.listEntries()).toEqual([]);
  });

  it('save + list devuelve la entry idéntica', async () => {
    const adapter = createEncryptedOutboxAdapter<FakePayload>('incidents');
    const e = entry('e1', {
      event: {
        clientEventId: 'e1',
        kind: 'incident',
        priority: 'critical',
        payload: { title: 'Caída', workerUid: 'w-uid-juan' },
        occurredAt: '2026-05-14T10:00:00Z',
      },
    });
    await adapter.saveEntry(e);
    const list = await adapter.listEntries();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(e);
  });

  it('save 3 entries + list devuelve 3 (orden por index)', async () => {
    const adapter = createEncryptedOutboxAdapter<FakePayload>('incidents');
    await adapter.saveEntry(entry('alpha'));
    await adapter.saveEntry(entry('beta'));
    await adapter.saveEntry(entry('charlie'));
    const list = await adapter.listEntries();
    expect(list).toHaveLength(3);
    const ids = list.map((e) => e.event.clientEventId).sort();
    expect(ids).toEqual(['alpha', 'beta', 'charlie']);
  });

  it('save mismo id 2x: sobrescribe, no duplica', async () => {
    const adapter = createEncryptedOutboxAdapter<FakePayload>('incidents');
    await adapter.saveEntry(entry('e1'));
    await adapter.saveEntry(entry('e1', { retryCount: 5 }));
    const list = await adapter.listEntries();
    expect(list).toHaveLength(1);
    expect(list[0]!.retryCount).toBe(5);
  });

  it('delete entry: removida de list', async () => {
    const adapter = createEncryptedOutboxAdapter<FakePayload>('incidents');
    await adapter.saveEntry(entry('e1'));
    await adapter.saveEntry(entry('e2'));
    await adapter.deleteEntry('e1');
    const list = await adapter.listEntries();
    expect(list).toHaveLength(1);
    expect(list[0]!.event.clientEventId).toBe('e2');
  });

  it('delete inexistente: idempotent (no error)', async () => {
    const adapter = createEncryptedOutboxAdapter<FakePayload>('incidents');
    await expect(adapter.deleteEntry('nunca-existió')).resolves.toBeUndefined();
  });

  it('namespaces aislados: incidents NO ve siteBook', async () => {
    const inc = createEncryptedOutboxAdapter<FakePayload>('incidents');
    const sb = createEncryptedOutboxAdapter<FakePayload>('siteBook');
    await inc.saveEntry(entry('shared-id', { event: { clientEventId: 'shared-id', kind: 'inc', priority: 'normal', payload: { title: 'I' }, occurredAt: '2026-05-14T10:00:00Z' } }));
    await sb.saveEntry(entry('shared-id', { event: { clientEventId: 'shared-id', kind: 'sb', priority: 'normal', payload: { title: 'S' }, occurredAt: '2026-05-14T10:00:00Z' } }));
    const incList = await inc.listEntries();
    const sbList = await sb.listEntries();
    expect(incList).toHaveLength(1);
    expect(sbList).toHaveLength(1);
    expect(incList[0]!.event.payload.title).toBe('I');
    expect(sbList[0]!.event.payload.title).toBe('S');
  });
});

describe('createEncryptedOutboxAdapter — validation', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
  });

  it('namespace vacío → throws', () => {
    expect(() => createEncryptedOutboxAdapter('')).toThrow(/empty/);
  });

  it('namespace con :: → throws (separador interno)', () => {
    expect(() => createEncryptedOutboxAdapter('foo::bar')).toThrow(
      /forbidden/,
    );
  });
});

describe('clearOutboxNamespace', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
  });

  it('borra TODAS las entries del namespace', async () => {
    const adapter = createEncryptedOutboxAdapter<FakePayload>('incidents');
    await adapter.saveEntry(entry('e1'));
    await adapter.saveEntry(entry('e2'));
    await adapter.saveEntry(entry('e3'));
    expect(await adapter.listEntries()).toHaveLength(3);
    await clearOutboxNamespace('incidents');
    expect(await adapter.listEntries()).toHaveLength(0);
  });

  it('clear de un namespace NO afecta otros', async () => {
    const inc = createEncryptedOutboxAdapter<FakePayload>('incidents');
    const sb = createEncryptedOutboxAdapter<FakePayload>('siteBook');
    await inc.saveEntry(entry('i1'));
    await sb.saveEntry(entry('s1'));
    await clearOutboxNamespace('incidents');
    expect(await inc.listEntries()).toHaveLength(0);
    expect(await sb.listEntries()).toHaveLength(1);
  });

  it('clear de namespace vacío: idempotent', async () => {
    await expect(clearOutboxNamespace('never-existed')).resolves.toBeUndefined();
  });
});

describe('listOutboxNamespaces', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
  });

  it('sin namespaces: array vacío', async () => {
    expect(await listOutboxNamespaces()).toEqual([]);
  });

  it('detecta los namespaces que tienen entries', async () => {
    const inc = createEncryptedOutboxAdapter<FakePayload>('incidents');
    const sb = createEncryptedOutboxAdapter<FakePayload>('siteBook');
    const audit = createEncryptedOutboxAdapter<FakePayload>('audit');
    await inc.saveEntry(entry('i1'));
    await sb.saveEntry(entry('s1'));
    await audit.saveEntry(entry('a1'));
    const ns = await listOutboxNamespaces();
    expect(ns).toEqual(['audit', 'incidents', 'siteBook']);
  });
});

describe('end-to-end: cablear con GenericOutboxEngine', () => {
  beforeEach(() => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB =
      new FDBFactory() as unknown as IDBFactory;
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
  });

  it('engine + encrypted adapter: enqueue + flush exitoso → cola vacía', async () => {
    const adapter = createEncryptedOutboxAdapter<FakePayload>('incidents');
    const sender = async (e: OutboxEvent<FakePayload>) => {
      // Verificar que el payload llega íntegro al sender.
      expect(e.payload.workerUid).toBe('w-uid-juan');
      return { kind: 'success' as const };
    };
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender,
    });
    await engine.enqueue({
      clientEventId: 'inc-1',
      kind: 'incident',
      priority: 'critical',
      payload: { title: 'Caída altura', workerUid: 'w-uid-juan' },
      occurredAt: '2026-05-14T10:00:00Z',
    });
    expect(await adapter.listEntries()).toHaveLength(1);
    const stats = await engine.flush();
    expect(stats.succeeded).toBe(1);
    expect(await adapter.listEntries()).toHaveLength(0);
  });

  it('engine + encrypted adapter: retry con backoff persiste cifrado', async () => {
    const adapter = createEncryptedOutboxAdapter<FakePayload>('incidents');
    let nowMs = 1000;
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'retry' as const, error: 'no net' }),
      nowMs: () => nowMs,
    });
    await engine.enqueue({
      clientEventId: 'inc-1',
      kind: 'incident',
      priority: 'normal',
      payload: { title: 'X', workerUid: 'phi-uid' },
      occurredAt: '2026-05-14T10:00:00Z',
    });
    await engine.flush();
    const list = await adapter.listEntries();
    expect(list).toHaveLength(1);
    expect(list[0]!.retryCount).toBe(1);
    expect(list[0]!.lastError).toBe('no net');
    // El payload sensible (workerUid PHI) sigue siendo recuperable
    // intacto después del round-trip por encrypted store.
    expect(list[0]!.event.payload.workerUid).toBe('phi-uid');
  });

  it('persistencia cross-reset: simula app reload + recupera entries', async () => {
    const adapter1 = createEncryptedOutboxAdapter<FakePayload>('incidents');
    await adapter1.saveEntry(entry('e1', { event: { clientEventId: 'e1', kind: 'incident', priority: 'critical', payload: { title: 'pre-reload' }, occurredAt: '2026-05-14T10:00:00Z' } }));
    // Reset el singleton del módulo (simula reload de la app).
    __resetEncryptedKvForTests();
    __resetDeviceKekForTests();
    // Nueva instancia del adapter — debería leer los blobs IDB
    // existentes (la KEK persiste, los blobs persisten).
    const adapter2 = createEncryptedOutboxAdapter<FakePayload>('incidents');
    const list = await adapter2.listEntries();
    expect(list).toHaveLength(1);
    expect(list[0]!.event.payload.title).toBe('pre-reload');
  });
});
