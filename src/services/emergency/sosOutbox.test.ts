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

  it('un enqueue durante un flush en vuelo NO se pierde (race lost-update)', async () => {
    // Reproduce el bug: flushSos() se dispara en enqueueSos (drain al
    // reconectar) sobre el MISMO singleton. flush() hace load→send(red)→save;
    // si un enqueue corre mientras send está en vuelo, el save() stale del
    // flush sobreescribe el SOS recién encolado → SOS perdido.
    const storage = new InMemorySosStorage();
    let releaseSend: (v: { ok: boolean }) => void = () => {};
    const sendGate = new Promise<{ ok: boolean }>((r) => { releaseSend = r; });
    const send = vi
      .fn<(e: SosEvent) => Promise<{ ok: boolean; error?: string }>>()
      .mockReturnValueOnce(sendGate)
      .mockResolvedValue({ ok: true });
    const outbox = new SosOutbox({ storage, send });

    // SOS #1 ya encolado y vencido para reintento.
    await outbox.enqueue(makeEvent({ clientEventId: 'e1' }));

    // flush() carga [e1], llama send(e1) que queda BLOQUEADO en sendGate.
    const flushing = outbox.flush();
    // Mientras el flush está bloqueado enviando e1, llega y se encola e2.
    const enqueuing = outbox.enqueue(makeEvent({ clientEventId: 'e2' }));
    // Deja que ambos avancen por sus load/save y que el flush se pare en la red.
    await new Promise((r) => setTimeout(r, 0));
    releaseSend({ ok: true });
    await Promise.all([flushing, enqueuing]);

    // e1 se envió y salió de la cola; e2 DEBE seguir presente.
    const ids = (await outbox.snapshot()).map((e) => e.event.clientEventId);
    expect(ids).toContain('e2');
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

  it('flush NUNCA descarta en silencio: tras MAX_RETRY mueve a dead-letter', async () => {
    // 🛟 Un SOS no puede perderse en silencio. Tras agotar reintentos
    // debe quedar retenido como dead-letter para escalamiento presencial,
    // no desaparecer (bug DEEP-EX-03 / TODO §2.32 P2).
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
    expect(final).toHaveLength(1); // RETENIDO, no descartado
    expect(final[0].deadLettered).toBe(true);
    expect(final[0].event.clientEventId).toBe('evt-1');

    const dead = await outbox.deadLetters();
    expect(dead).toHaveLength(1);
    expect(dead[0].event.clientEventId).toBe('evt-1');
  });

  it('flush no reintenta un entry dead-lettered (no llama send) y lo reporta', async () => {
    const storage = new InMemorySosStorage();
    const send = vi.fn().mockResolvedValue({ ok: false });
    let now = 0;
    const outbox = new SosOutbox({ storage, send, now: () => now });
    await outbox.enqueue(makeEvent());
    for (let i = 0; i < 7; i++) {
      now += 999_999;
      await outbox.flush();
    }
    const callsAfterDeadLetter = send.mock.calls.length;
    now += 999_999;
    const summary = await outbox.flush();
    expect(send.mock.calls.length).toBe(callsAfterDeadLetter); // no reintento
    expect(summary.deadLettered).toBe(1);
    expect(summary.pending).toBe(0); // dead-letters no cuentan como pendientes
  });

  it('clearDeadLetter remueve un dead-letter ya escalado presencialmente', async () => {
    const storage = new InMemorySosStorage();
    const send = vi.fn().mockResolvedValue({ ok: false });
    let now = 0;
    const outbox = new SosOutbox({ storage, send, now: () => now });
    await outbox.enqueue(makeEvent());
    for (let i = 0; i < 7; i++) {
      now += 999_999;
      await outbox.flush();
    }
    expect(await outbox.deadLetters()).toHaveLength(1);
    await outbox.clearDeadLetter('evt-1');
    expect(await outbox.deadLetters()).toHaveLength(0);
    expect(await outbox.snapshot()).toHaveLength(0);
  });

  it('el hard-cap nunca evicta un dead-letter en favor de un pendiente más nuevo', async () => {
    // 🛟 Un SOS no entregado (dead-letter) es lo MÁS importante: jamás
    // debe ser desplazado por eventos pendientes más nuevos.
    const storage = new InMemorySosStorage();
    const send = vi.fn().mockResolvedValue({ ok: false });
    let now = 0;
    const outbox = new SosOutbox({ storage, send, now: () => now });
    // Dead-letterear evt-dead
    await outbox.enqueue(makeEvent({ clientEventId: 'evt-dead' }));
    for (let i = 0; i < 7; i++) {
      now += 999_999;
      await outbox.flush();
    }
    expect((await outbox.deadLetters())[0].event.clientEventId).toBe('evt-dead');
    // Saturar la cola con 60 pendientes nuevos
    for (let i = 0; i < 60; i++) {
      await outbox.enqueue(makeEvent({ clientEventId: `evt-new-${i}` }));
    }
    const snap = await outbox.snapshot();
    expect(snap.length).toBeLessThanOrEqual(50);
    // El dead-letter sigue presente pese a la saturación
    expect(snap.some((e) => e.event.clientEventId === 'evt-dead' && e.deadLettered)).toBe(true);
  });

  it('flush con send que throws lo trata como fallo (no rompe la cola)', async () => {
    const storage = new InMemorySosStorage();
    const send = vi.fn().mockRejectedValue(new Error('boom'));
    const now = 0;
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
