import { describe, it, expect, vi } from 'vitest';
import {
  GenericOutboxEngine,
  createInMemoryOutboxAdapter,
  type OutboxEvent,
  type OutboxSender,
  type TelemetryEvent,
} from './genericOutboxEngine';
import {
  computeNextRetryAt,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_CAP_MS,
} from './outboxBackoff';

interface FakePayload {
  title: string;
}

function event(
  id: string,
  over: Partial<OutboxEvent<FakePayload>> = {},
): OutboxEvent<FakePayload> {
  return {
    clientEventId: id,
    kind: 'fake',
    priority: 'normal',
    payload: { title: `evento ${id}` },
    occurredAt: '2026-05-14T10:00:00Z',
    ...over,
  };
}

describe('GenericOutboxEngine — enqueue', () => {
  it('encola un nuevo event + emite telemetry "enqueued"', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const events: TelemetryEvent[] = [];
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'success' as const }),
      nowMs: () => 1000,
      onTelemetry: (e) => events.push(e),
    });
    const ok = await engine.enqueue(event('e1'));
    expect(ok).toBe(true);
    const list = await adapter.listEntries();
    expect(list).toHaveLength(1);
    expect(list[0]!.event.clientEventId).toBe('e1');
    expect(events).toContainEqual({
      kind: 'enqueued',
      entryId: 'e1',
      priority: 'normal',
    });
  });

  it('dedup por clientEventId: re-enqueue el mismo NO duplica', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'success' as const }),
    });
    await engine.enqueue(event('e1'));
    await engine.enqueue(event('e1', { payload: { title: 'distinto' } }));
    const list = await adapter.listEntries();
    expect(list).toHaveLength(1);
    // El primero gana (no overwrite por idempotencia).
    expect(list[0]!.event.payload.title).toBe('evento e1');
  });

  it('cuando cola está llena: evict el más viejo de menor prioridad', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const evicted: TelemetryEvent[] = [];
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'success' as const }),
      maxEntries: 3,
      onTelemetry: (e) => {
        if (e.kind === 'evicted') evicted.push(e);
      },
    });
    // 3 background events first (older).
    await engine.enqueue(event('bg1', { priority: 'background' }));
    await engine.enqueue(event('bg2', { priority: 'background' }));
    await engine.enqueue(event('n1', { priority: 'normal' }));
    // El 4to (critical) llena → evict el bg1 (más viejo background).
    const ok = await engine.enqueue(event('crit', { priority: 'critical' }));
    expect(ok).toBe(true);
    const list = await adapter.listEntries();
    const ids = list.map((e) => e.event.clientEventId).sort();
    expect(ids).toEqual(['bg2', 'crit', 'n1']);
    expect(evicted).toHaveLength(1);
    expect(evicted[0]!.kind).toBe('evicted');
  });

  it('cuando cola llena Y nuevo event es de menor o igual prioridad: rechaza', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'success' as const }),
      maxEntries: 2,
    });
    await engine.enqueue(event('c1', { priority: 'critical' }));
    await engine.enqueue(event('c2', { priority: 'critical' }));
    // Tercer event normal — NO hay nada de menor prioridad para evict.
    const ok = await engine.enqueue(event('n1', { priority: 'normal' }));
    expect(ok).toBe(false);
    const list = await adapter.listEntries();
    expect(list).toHaveLength(2);
  });
});

describe('GenericOutboxEngine — flush', () => {
  it('flush con sender que succede: borra entries + emite flush_success', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const events: TelemetryEvent[] = [];
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'success' as const }),
      onTelemetry: (e) => events.push(e),
    });
    await engine.enqueue(event('e1'));
    await engine.enqueue(event('e2'));
    const stats = await engine.flush();
    expect(stats.succeeded).toBe(2);
    expect(stats.attempted).toBe(2);
    expect((await adapter.listEntries())).toHaveLength(0);
    expect(events.filter((e) => e.kind === 'flush_success')).toHaveLength(2);
  });

  it('flush ordena por priority: critical > normal > background', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const orderSent: string[] = [];
    const sender: OutboxSender<FakePayload> = async (e) => {
      orderSent.push(e.clientEventId);
      return { kind: 'success' as const };
    };
    const engine = new GenericOutboxEngine<FakePayload>({ adapter, sender });
    // Insertar en orden contrario al esperado.
    await engine.enqueue(event('bg', { priority: 'background' }));
    await engine.enqueue(event('n', { priority: 'normal' }));
    await engine.enqueue(event('c', { priority: 'critical' }));
    await engine.flush();
    expect(orderSent).toEqual(['c', 'n', 'bg']);
  });

  it('flush con sender que retry: incrementa retryCount + computa nextRetryAt', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const events: TelemetryEvent[] = [];
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'retry' as const, error: 'network blip' }),
      nowMs: () => 10_000,
      onTelemetry: (e) => events.push(e),
    });
    await engine.enqueue(event('e1'));
    const stats = await engine.flush();
    expect(stats.retried).toBe(1);
    const list = await adapter.listEntries();
    expect(list[0]!.retryCount).toBe(1);
    expect(list[0]!.lastError).toBe('network blip');
    // nextRetryAt = 10_000 + 1000 (baseMs default).
    expect(list[0]!.nextRetryAt).toBe(11_000);
    expect(events.filter((e) => e.kind === 'flush_retry')).toHaveLength(1);
  });

  it('flush respeta nextRetryAt: no re-intenta si NO está ready', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    let now = 1000;
    const sender = vi.fn(async () => ({ kind: 'retry' as const, error: 'x' }));
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender,
      nowMs: () => now,
    });
    await engine.enqueue(event('e1'));
    // Primer flush: marca retry (nextRetryAt = 1000 + 1000 = 2000).
    await engine.flush();
    expect(sender).toHaveBeenCalledTimes(1);
    // Segundo flush ANTES de nextRetryAt → NO se intenta.
    now = 1500;
    const stats2 = await engine.flush();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(stats2.attempted).toBe(0);
    // Tercer flush DESPUÉS de nextRetryAt → sí se intenta.
    now = 2500;
    await engine.flush();
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('sender throws → tratado como retry transitorio', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => {
        throw new Error('connection refused');
      },
      nowMs: () => 1000,
    });
    await engine.enqueue(event('e1'));
    const stats = await engine.flush();
    expect(stats.retried).toBe(1);
    const list = await adapter.listEntries();
    expect(list[0]!.lastError).toBe('connection refused');
  });

  it('permanent_failure: borra entry + emite telemetry', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const events: TelemetryEvent[] = [];
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({
        kind: 'permanent_failure' as const,
        error: '403 forbidden',
      }),
      onTelemetry: (e) => events.push(e),
    });
    await engine.enqueue(event('e1'));
    const stats = await engine.flush();
    expect(stats.permanentlyFailed).toBe(1);
    expect((await adapter.listEntries())).toHaveLength(0);
    expect(
      events.filter((e) => e.kind === 'flush_permanent_failure'),
    ).toHaveLength(1);
  });

  it('TTL excedido: entry dead-lettered (retenido, NO descartado) + emite dead_lettered ttl', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const events: TelemetryEvent[] = [];
    let now = 1000;
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'success' as const }),
      nowMs: () => now,
      ttlHours: 1,
      onTelemetry: (e) => events.push(e),
    });
    await engine.enqueue(event('e1', { priority: 'critical' }));
    // Avanzamos 2 horas — más que el TTL de 1h.
    now += 2 * 60 * 60 * 1000;
    const stats = await engine.flush();
    expect(stats.deadLettered).toBe(1);
    // 🛟 El dato de seguridad NO se descarta: queda retenido como dead-letter.
    const list = await adapter.listEntries();
    expect(list).toHaveLength(1);
    expect(list[0]!.deadLettered).toBe(true);
    expect(list[0]!.deadLetterReason).toBe('ttl');
    expect(
      events.find(
        (e) =>
          e.kind === 'dead_lettered' &&
          e.entryId === 'e1' &&
          e.reason === 'ttl' &&
          e.priority === 'critical',
      ),
    ).toBeDefined();
  });

  it('maxRetries excedido: entry dead-lettered como max_retries (retenido)', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const events: TelemetryEvent[] = [];
    let now = 1000;
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'retry' as const, error: 'x' }),
      nowMs: () => now,
      maxRetries: 3,
      onTelemetry: (e) => events.push(e),
    });
    await engine.enqueue(event('e1'));
    // 3 flushes; cada vez el sender retry → retryCount sube.
    for (let i = 0; i < 3; i++) {
      await engine.flush();
      now += 60_000; // skip past backoff
    }
    expect((await adapter.listEntries())[0]!.retryCount).toBe(3);
    // 4to flush: el engine ve retryCount >= maxRetries (3) → dead-letter.
    const stats = await engine.flush();
    expect(stats.deadLettered).toBe(1);
    const list = await adapter.listEntries();
    expect(list).toHaveLength(1);
    expect(list[0]!.deadLettered).toBe(true);
    expect(list[0]!.deadLetterReason).toBe('max_retries');
    expect(
      events.find(
        (e) =>
          e.kind === 'dead_lettered' &&
          e.entryId === 'e1' &&
          e.reason === 'max_retries',
      ),
    ).toBeDefined();
  });

  it('dead-letter NO se reintenta en flushes posteriores y el sender no se invoca', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    let now = 1000;
    const sender = vi.fn(async () => ({ kind: 'retry' as const, error: 'x' }));
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender,
      nowMs: () => now,
      maxRetries: 1,
    });
    await engine.enqueue(event('e1'));
    await engine.flush(); // retryCount → 1
    now += 60_000;
    await engine.flush(); // retryCount >= 1 → dead-letter
    const callsAfterDeadLetter = sender.mock.calls.length;
    now += 60_000;
    const stats = await engine.flush();
    // No se vuelve a invocar al sender para un dead-letter.
    expect(sender.mock.calls.length).toBe(callsAfterDeadLetter);
    expect(stats.attempted).toBe(0);
    expect(stats.deadLettered).toBe(0); // ya estaba dead-lettered, no recuenta
  });

  it('deadLetters() expone los retenidos; clearDeadLetter() los remueve tras escalar', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const now = 1000;
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'retry' as const, error: 'x' }),
      nowMs: () => now,
      maxRetries: 0, // dead-letter al primer flush
    });
    await engine.enqueue(event('e1', { priority: 'critical' }));
    await engine.flush();
    let dl = await engine.deadLetters();
    expect(dl.map((e) => e.event.clientEventId)).toEqual(['e1']);
    // clearDeadLetter sobre un id NO dead-lettered es no-op.
    await engine.clearDeadLetter('inexistente');
    expect(await engine.deadLetters()).toHaveLength(1);
    // Escalado por otra vía → se remueve.
    await engine.clearDeadLetter('e1');
    dl = await engine.deadLetters();
    expect(dl).toHaveLength(0);
    expect(await adapter.listEntries()).toHaveLength(0);
  });

  it('capacidad: un dead-letter NUNCA es evictado para admitir un entry nuevo', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const now = 1000;
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'retry' as const, error: 'x' }),
      nowMs: () => now,
      maxEntries: 1,
      maxRetries: 0,
    });
    // e1 (background) se dead-letterea.
    await engine.enqueue(event('e1', { priority: 'background' }));
    await engine.flush();
    expect((await engine.deadLetters()).map((e) => e.event.clientEventId)).toEqual([
      'e1',
    ]);
    // Cola llena (1) con un dead-letter. Un nuevo critical NO puede evictar al
    // dead-letter retenido → se rechaza (protege el dato de seguridad retenido).
    const ok = await engine.enqueue(event('e2', { priority: 'critical' }));
    expect(ok).toBe(false);
    expect((await adapter.listEntries()).map((e) => e.event.clientEventId)).toEqual([
      'e1',
    ]);
  });

  it('stats() separa pending de deadLettered', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const now = 1000;
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'retry' as const, error: 'x' }),
      nowMs: () => now,
      maxRetries: 0,
    });
    await engine.enqueue(event('dead', { priority: 'critical' }));
    await engine.flush(); // → dead-letter
    await engine.enqueue(event('alive', { priority: 'normal' }));
    const s = await engine.stats();
    expect(s.total).toBe(2);
    expect(s.pending).toBe(1);
    expect(s.deadLettered).toBe(1);
  });

  it('error en telemetry callback NO crashea el flush', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'success' as const }),
      onTelemetry: () => {
        throw new Error('telemetry boom');
      },
    });
    await engine.enqueue(event('e1'));
    const stats = await engine.flush();
    expect(stats.succeeded).toBe(1);
  });
});

describe('GenericOutboxEngine — stats', () => {
  it('reporta total + byPriority + oldestQueuedAt + nextRetryReadyAt', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    let now = 1000;
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'success' as const }),
      nowMs: () => now,
    });
    await engine.enqueue(event('c', { priority: 'critical' }));
    now += 1000;
    await engine.enqueue(event('n1', { priority: 'normal' }));
    now += 1000;
    await engine.enqueue(event('n2', { priority: 'normal' }));
    now += 1000;
    await engine.enqueue(event('bg', { priority: 'background' }));
    const s = await engine.stats();
    expect(s.total).toBe(4);
    expect(s.byPriority).toEqual({ critical: 1, normal: 2, background: 1 });
    expect(s.oldestQueuedAt).toBe('1970-01-01T00:00:01.000Z');
  });

  it('cola vacía: total 0, sin oldest', async () => {
    const adapter = createInMemoryOutboxAdapter<FakePayload>();
    const engine = new GenericOutboxEngine<FakePayload>({
      adapter,
      sender: async () => ({ kind: 'success' as const }),
    });
    const s = await engine.stats();
    expect(s.total).toBe(0);
    expect(s.oldestQueuedAt).toBeUndefined();
  });
});

describe('computeNextRetryAt', () => {
  it('retryCount 1 → delay = baseMs', () => {
    expect(computeNextRetryAt({ now: 1000, retryCount: 1 })).toBe(
      1000 + DEFAULT_BACKOFF_BASE_MS,
    );
  });

  it('retryCount 2 → delay = 2 * baseMs', () => {
    expect(computeNextRetryAt({ now: 0, retryCount: 2 })).toBe(2000);
  });

  it('retryCount 3 → 4s', () => {
    expect(computeNextRetryAt({ now: 0, retryCount: 3 })).toBe(4000);
  });

  it('retryCount 6 → 32s', () => {
    expect(computeNextRetryAt({ now: 0, retryCount: 6 })).toBe(32000);
  });

  it('retryCount 7 → cap (60s default)', () => {
    expect(computeNextRetryAt({ now: 0, retryCount: 7 })).toBe(
      DEFAULT_BACKOFF_CAP_MS,
    );
  });

  it('retryCount alto cap respetado', () => {
    expect(computeNextRetryAt({ now: 0, retryCount: 100 })).toBe(
      DEFAULT_BACKOFF_CAP_MS,
    );
  });

  it('retryCount 0 → tratado como 1 (defensive)', () => {
    expect(computeNextRetryAt({ now: 0, retryCount: 0 })).toBe(
      DEFAULT_BACKOFF_BASE_MS,
    );
  });

  it('custom base + cap', () => {
    expect(
      computeNextRetryAt({
        now: 0,
        retryCount: 3,
        baseMs: 500,
        capMs: 1500,
      }),
    ).toBe(1500); // 500 * 4 = 2000 capped to 1500
  });
});
