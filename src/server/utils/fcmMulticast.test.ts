import { describe, it, expect, vi } from 'vitest';
import {
  FCM_MULTICAST_MAX_TOKENS,
  sendMulticastChunked,
} from './fcmMulticast.js';

function buildMessaging(opts: {
  perChunkResult?: (chunkIndex: number, tokens: readonly string[]) => {
    successCount: number;
    failureCount: number;
  };
  throwOnChunk?: number;
}) {
  const calls: Array<{ tokens: string[]; notificationTitle?: string }> = [];
  let chunkIndex = -1;
  const sendEachForMulticast = vi.fn(async (msg: { tokens: string[]; notification?: { title?: string } }) => {
    chunkIndex += 1;
    calls.push({ tokens: [...msg.tokens], notificationTitle: msg.notification?.title });
    if (opts.throwOnChunk === chunkIndex) {
      throw new Error('boom');
    }
    const r = opts.perChunkResult?.(chunkIndex, msg.tokens) ?? {
      successCount: msg.tokens.length,
      failureCount: 0,
    };
    return r;
  });
  return { messaging: { sendEachForMulticast } as any, calls };
}

describe('sendMulticastChunked', () => {
  it('tokens vacíos → no llama messaging, devuelve counters en cero', async () => {
    const { messaging, calls } = buildMessaging({});
    const r = await sendMulticastChunked(messaging, [], { notification: { title: 't', body: 'b' } });
    expect(r.attempted).toBe(0);
    expect(r.chunkCount).toBe(0);
    expect(r.successCount).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('1–500 tokens → exactamente un chunk', async () => {
    const tokens = Array.from({ length: 500 }, (_, i) => `tok-${i}`);
    const { messaging, calls } = buildMessaging({});
    const r = await sendMulticastChunked(messaging, tokens, {
      notification: { title: 'x', body: 'y' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].tokens).toHaveLength(500);
    expect(r.chunkCount).toBe(1);
    expect(r.successCount).toBe(500);
  });

  it('501 tokens → 2 chunks (500 + 1)', async () => {
    const tokens = Array.from({ length: 501 }, (_, i) => `tok-${i}`);
    const { messaging, calls } = buildMessaging({});
    const r = await sendMulticastChunked(messaging, tokens, {
      notification: { title: 'x', body: 'y' },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].tokens).toHaveLength(500);
    expect(calls[1].tokens).toHaveLength(1);
    expect(r.chunkCount).toBe(2);
    expect(r.attempted).toBe(501);
    expect(r.successCount).toBe(501);
  });

  it('1200 tokens → 3 chunks (500 + 500 + 200)', async () => {
    const tokens = Array.from({ length: 1200 }, (_, i) => `tok-${i}`);
    const { messaging, calls } = buildMessaging({});
    const r = await sendMulticastChunked(messaging, tokens, {
      notification: { title: 'x', body: 'y' },
    });
    expect(calls.map((c) => c.tokens.length)).toEqual([500, 500, 200]);
    expect(r.successCount).toBe(1200);
  });

  it('agrega failureCount entre chunks', async () => {
    const tokens = Array.from({ length: 600 }, (_, i) => `tok-${i}`);
    const { messaging } = buildMessaging({
      perChunkResult: (_idx, t) => ({
        successCount: t.length - 1,
        failureCount: 1,
      }),
    });
    const r = await sendMulticastChunked(messaging, tokens, {
      notification: { title: 'x', body: 'y' },
    });
    expect(r.successCount).toBe(598);
    expect(r.failureCount).toBe(2);
  });

  it('chunk que tira → errorCount=1, siguientes chunks siguen', async () => {
    const tokens = Array.from({ length: 1200 }, (_, i) => `tok-${i}`);
    const { messaging, calls } = buildMessaging({ throwOnChunk: 1 });
    const r = await sendMulticastChunked(messaging, tokens, {
      notification: { title: 'x', body: 'y' },
    });
    expect(calls).toHaveLength(3);
    expect(r.errorCount).toBe(1);
    expect(r.successCount).toBe(500 + 200);
  });

  it('expone el tope máximo de 500 (límite Firebase Admin)', () => {
    expect(FCM_MULTICAST_MAX_TOKENS).toBe(500);
  });
});
