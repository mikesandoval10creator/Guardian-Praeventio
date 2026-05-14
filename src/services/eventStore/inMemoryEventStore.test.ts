import { describe, it, expect } from 'vitest';
import { InMemoryEventStore } from './inMemoryEventStore.js';
import { EventStoreError, type DomainEvent } from './types.js';

function evt(
  aggregateId: string,
  eventType: string,
  seq: number,
  extras: Partial<DomainEvent> = {},
): DomainEvent {
  return {
    eventId: extras.eventId ?? `${aggregateId}-${seq}`,
    aggregateId,
    aggregateType: 'incident',
    eventType,
    sequenceNumber: seq,
    payload: {},
    metadata: {
      occurredAt: extras.metadata?.occurredAt ?? new Date().toISOString(),
      causedByUid: 'u-1',
      tenantId: 'tenant-1',
      ...extras.metadata,
    },
    ...extras,
  } as DomainEvent;
}

describe('InMemoryEventStore — append', () => {
  it('empty store: append + currentVersion=1', async () => {
    const s = new InMemoryEventStore();
    await s.append([evt('a-1', 'created', 1)]);
    expect(await s.currentVersion('a-1')).toBe(1);
  });

  it('append batch del mismo aggregate: ambos persisten', async () => {
    const s = new InMemoryEventStore();
    await s.append([
      evt('a-1', 'created', 1),
      evt('a-1', 'updated', 2),
    ]);
    const events = await s.read('a-1');
    expect(events).toHaveLength(2);
    expect(events[0]!.sequenceNumber).toBe(1);
    expect(events[1]!.sequenceNumber).toBe(2);
  });

  it('mixed aggregateIds en un batch: throws INVALID_SEQUENCE', async () => {
    const s = new InMemoryEventStore();
    await expect(
      s.append([evt('a-1', 'x', 1), evt('a-2', 'x', 1)]),
    ).rejects.toThrow(EventStoreError);
  });

  it('mixed tenants en un batch: throws TENANT_MISMATCH', async () => {
    const s = new InMemoryEventStore();
    const e1 = evt('a-1', 'x', 1);
    const e2 = evt('a-1', 'y', 2, {
      metadata: { tenantId: 'tenant-2', causedByUid: 'u', occurredAt: 'x' },
    });
    await expect(s.append([e1, e2])).rejects.toThrow(EventStoreError);
  });

  it('seq no consecutivos en el batch: throws', async () => {
    const s = new InMemoryEventStore();
    await expect(
      s.append([evt('a-1', 'x', 1), evt('a-1', 'y', 3)]),
    ).rejects.toThrow(EventStoreError);
  });

  it('seq que no empieza en currentVersion+1: throws', async () => {
    const s = new InMemoryEventStore();
    await s.append([evt('a-1', 'x', 1)]);
    // El próximo append DEBE empezar en seq=2
    await expect(s.append([evt('a-1', 'x', 3)])).rejects.toThrow(EventStoreError);
  });

  it('expectedSeq concurrency check: rechaza si seq del store difiere', async () => {
    const s = new InMemoryEventStore();
    await s.append([evt('a-1', 'x', 1)]);
    await expect(
      s.append([evt('a-1', 'x', 2)], { expectedSeq: 5 }),
    ).rejects.toThrow(EventStoreError);
  });

  it('expectedSeq concurrency check: acepta si coincide', async () => {
    const s = new InMemoryEventStore();
    await s.append([evt('a-1', 'x', 1)]);
    await s.append([evt('a-1', 'x', 2)], { expectedSeq: 1 });
    expect(await s.currentVersion('a-1')).toBe(2);
  });

  it('idempotency: append con eventId duplicado es no-op', async () => {
    const s = new InMemoryEventStore();
    await s.append([evt('a-1', 'x', 1, { eventId: 'evt-fixed' })]);
    // Retry con mismo eventId
    const result = await s.append([
      evt('a-1', 'x', 1, { eventId: 'evt-fixed' }),
    ]);
    expect(result).toHaveLength(1);
    expect(await s.currentVersion('a-1')).toBe(1); // no duplicó
  });

  it('append vacío: no-op', async () => {
    const s = new InMemoryEventStore();
    expect(await s.append([])).toEqual([]);
  });
});

describe('InMemoryEventStore — read', () => {
  it('aggregate inexistente: read devuelve []', async () => {
    const s = new InMemoryEventStore();
    expect(await s.read('nope')).toEqual([]);
  });

  it('read con fromSeq filtra', async () => {
    const s = new InMemoryEventStore();
    await s.append([
      evt('a-1', 'x', 1),
      evt('a-1', 'y', 2),
      evt('a-1', 'z', 3),
    ]);
    const r = await s.read('a-1', { fromSeq: 2 });
    expect(r).toHaveLength(2);
    expect(r[0]!.sequenceNumber).toBe(2);
  });

  it('read con toSeq filtra', async () => {
    const s = new InMemoryEventStore();
    await s.append([
      evt('a-1', 'x', 1),
      evt('a-1', 'y', 2),
      evt('a-1', 'z', 3),
    ]);
    const r = await s.read('a-1', { toSeq: 2 });
    expect(r).toHaveLength(2);
    expect(r[r.length - 1]!.sequenceNumber).toBe(2);
  });
});

describe('InMemoryEventStore — readByType', () => {
  it('filtra por aggregateType + tenant', async () => {
    const s = new InMemoryEventStore();
    await s.append([evt('a-1', 'x', 1)]);
    await s.append([
      evt('a-2', 'y', 1, {
        metadata: { tenantId: 'tenant-2', causedByUid: 'u', occurredAt: 'z' },
      }),
    ]);
    const t1 = await s.readByType('incident', 'tenant-1');
    expect(t1).toHaveLength(1);
    expect(t1[0]!.aggregateId).toBe('a-1');
  });

  it('respeta limit', async () => {
    const s = new InMemoryEventStore();
    await s.append([
      evt('a-1', 'x', 1),
      evt('a-1', 'y', 2),
      evt('a-1', 'z', 3),
    ]);
    const r = await s.readByType('incident', 'tenant-1', { limit: 2 });
    expect(r).toHaveLength(2);
  });
});

describe('InMemoryEventStore — metrics', () => {
  it('totalEvents, totalAggregates, types', async () => {
    const s = new InMemoryEventStore();
    await s.append([evt('a-1', 'created', 1)]);
    await s.append([evt('a-1', 'updated', 2)]);
    await s.append([evt('a-2', 'created', 1)]);
    const m = await s.getMetrics();
    expect(m.totalEvents).toBe(3);
    expect(m.totalAggregates).toBe(2);
    expect(m.eventTypesSeen).toContain('created');
    expect(m.eventTypesSeen).toContain('updated');
  });

  it('appendCount + readCount incrementan', async () => {
    const s = new InMemoryEventStore();
    await s.append([evt('a-1', 'x', 1)]);
    await s.append([evt('a-1', 'y', 2)]);
    await s.read('a-1');
    const m = await s.getMetrics();
    expect(m.appendCount).toBe(2);
    expect(m.readCount).toBeGreaterThan(0);
  });

  it('latency promedio se calcula sobre samples reales', async () => {
    // Clock controlado para que el delta sea predecible.
    let t = 0;
    const s = new InMemoryEventStore(() => {
      t += 5; // 5ms por op
      return t;
    });
    await s.append([evt('a-1', 'x', 1)]);
    const m = await s.getMetrics();
    expect(m.avgAppendLatencyMs).toBeGreaterThanOrEqual(0);
  });
});
