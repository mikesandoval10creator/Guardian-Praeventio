import { describe, it, expect, vi } from 'vitest';
import {
  SosOutbox,
  InMemorySosStorage,
  computeBackoffMs,
  type SosEvent,
} from './sosOutbox.js';

function makeEvent(over: Partial<SosEvent> = {}): SosEvent {
  return {
    clientEventId: over.clientEventId ?? 'evt-1',
    workerUid: over.workerUid ?? 'w1',
    reason: over.reason ?? 'manual_button',
    occurredAt: over.occurredAt ?? '2026-05-11T10:00:00Z',
    coords: over.coords,
  };
}

describe('computeBackoffMs', () => {
  it('1s, 2s, 4s, 8s, 16s, 32s, cap 60s', () => {
    expect(computeBackoffMs(0)).toBe(1000);
    expect(computeBackoffMs(1)).toBe(2000);
    expect(computeBackoffMs(5)).toBe(32000);
    expect(computeBackoffMs(10)).toBe(60000); // capped
  });
});

describe('SosOutbox', () => {
  it('enqueue persiste el evento', async () => {
    const storage = new InMemorySosStorage();
    const outbox = new SosOutbox({ storage, send: async () => ({ ok: true }) });
    await outbox.enqueue(makeEvent());
    const snap = await outbox.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].event.clientEventId).toBe('evt-1');
  });

  it('enqueue es idempotente por clientEventId', async () => {
    const storage = new InMemorySosStorage();
    const outbox = new SosOutbox({ storage, send: async () => ({ ok: true }) });
    await outbox.enqueue(makeEvent());
    await outbox.enqueue(makeEvent());
    expect(await outbox.snapshot()).toHaveLength(1);
  });

  it('flush envía y remueve si send=ok', async () => {
    const storage = new InMemorySosStorage();
    const send = vi.fn().mockResolvedValue({ ok: true });
    const outbox = new SosOutbox({ storage, send });
    await outbox.enqueue(makeEvent());
    const result = await outbox.flush();
    expect(result.sent).toBe(1);
    expect(result.pending).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await outbox.snapshot()).toHaveLength(0);
  });

  it('flush reintenta con backoff si send falla', async () => {
    const storage = new InMemorySosStorage();
    const send = vi.fn().mockResolvedValue({ ok: false, error: 'network' });
    let now = 1000;
    const outbox = new SosOutbox({ storage, send, now: () => now });
    await outbox.enqueue(makeEvent());
    const r1 = await outbox.flush();
    expect(r1.sent).toBe(0);
    expect(r1.pending).toBe(1);
    const snap1 = await outbox.snapshot();
    expect(snap1[0].retryCount).toBe(1);
    expect(snap1[0].nextRetryAt).toBe(now + 2000); // backoff(1)=2s

    // Antes del tiempo de retry → no se reintenta
    now += 500;
    const r2 = await outbox.flush();
    expect(r2.pending).toBe(1);
    expect(send).toHaveBeenCalledTimes(1); // sigue 1 (no se reintentó)

    // Después del tiempo de retry → sí
    now += 2500;
    await outbox.flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('flush abandona después de MAX_RETRY (6)', async () => {
    const storage = new InMemorySosStorage();
    const send = vi.fn().mockResolvedValue({ ok: false });
    let now = 0;
    const outbox = new SosOutbox({ storage, send, now: () => now });
    await outbox.enqueue(makeEvent());
    // Forzar 7 intentos: avanzar reloj mucho cada vez
    for (let i = 0; i < 7; i++) {
      now += 999_999;
      await outbox.flush();
    }
    const final = await outbox.snapshot();
    expect(final).toHaveLength(0); // entry abandonada
  });

  it('flush con send que throws lo trata como fallo (no rompe la cola)', async () => {
    const storage = new InMemorySosStorage();
    const send = vi.fn().mockRejectedValue(new Error('boom'));
    let now = 0;
    const outbox = new SosOutbox({ storage, send, now: () => now });
    await outbox.enqueue(makeEvent());
    const result = await outbox.flush();
    expect(result.pending).toBe(1);
    const snap = await outbox.snapshot();
    expect(snap[0].lastError).toBe('boom');
  });

  it('hard cap 50 entries: descarta el más viejo si se llena', async () => {
    const storage = new InMemorySosStorage();
    const outbox = new SosOutbox({ storage, send: async () => ({ ok: false }) });
    for (let i = 0; i < 51; i++) {
      await outbox.enqueue(makeEvent({ clientEventId: `evt-${i}` }));
    }
    const snap = await outbox.snapshot();
    expect(snap).toHaveLength(50);
    // El más viejo (evt-0) debe haberse descartado, el más nuevo (evt-50) debe estar
    expect(snap.some((e) => e.event.clientEventId === 'evt-0')).toBe(false);
    expect(snap.some((e) => e.event.clientEventId === 'evt-50')).toBe(true);
  });
});
