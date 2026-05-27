// Praeventio Guard — useStreamedGuardian unit tests.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  streamGuardian,
  streamGuardianText,
  StreamGuardianError,
} from './useStreamedGuardian';

// Mock firebase auth.currentUser so authHeader() resolves.
vi.mock('../services/firebase', () => ({
  auth: {
    currentUser: {
      getIdToken: async () => 'test-id-token',
    },
  },
}));

function sseStream(messages: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < messages.length) {
        controller.enqueue(encoder.encode(messages[i]));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

function mockFetchOk(body: ReadableStream<Uint8Array>): typeof fetch {
  return vi.fn(async () => {
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch;
}

function mockFetchError(status: number, body: object): typeof fetch {
  return vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const ORIGINAL_FETCH = global.fetch;

describe('streamGuardian SSE consumer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('yield tokens individuales y luego done=true', async () => {
    global.fetch = mockFetchOk(
      sseStream([
        'data: {"text":"Hola"}\n\n',
        'data: {"text":" mundo"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const events: Array<{ text: string; done: boolean }> = [];
    for await (const ev of streamGuardian({ query: 'test' })) {
      events.push(ev);
      if (ev.done) break;
    }
    expect(events).toEqual([
      { text: 'Hola', done: false },
      { text: ' mundo', done: false },
      { text: '', done: true },
    ]);
  });

  it('streamGuardianText concatena todos los tokens', async () => {
    global.fetch = mockFetchOk(
      sseStream([
        'data: {"text":"DS 594"}\n\n',
        'data: {"text":" art. 70"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const text = await streamGuardianText({ query: 'q' });
    expect(text).toBe('DS 594 art. 70');
  });

  it('soporta chunks fragmentados (token roto cruza buffer boundary)', async () => {
    // Mensaje split en 2 chunks que cruzan el separator \n\n.
    global.fetch = mockFetchOk(
      sseStream([
        'data: {"text":"Pri',
        'mero"}\n\ndata: {"tex',
        't":"Segundo"}\n\ndata: [DONE]\n\n',
      ]),
    );
    const text = await streamGuardianText({ query: 'q' });
    expect(text).toBe('PrimeroSegundo');
  });

  it('lanza StreamGuardianError con HTTP 401', async () => {
    global.fetch = mockFetchError(401, { error: 'Unauthorized' });
    await expect(
      streamGuardianText({ query: 'q' }),
    ).rejects.toMatchObject({
      name: 'StreamGuardianError',
      httpStatus: 401,
    });
  });

  it('lanza con http 429 quota_exceeded', async () => {
    global.fetch = mockFetchError(429, { error: 'quota_exceeded' });
    try {
      await streamGuardianText({ query: 'q' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(StreamGuardianError);
      expect((err as StreamGuardianError).httpStatus).toBe(429);
      expect((err as StreamGuardianError).message).toContain('quota_exceeded');
    }
  });

  it('ignora eventos malformados sin romper el stream', async () => {
    global.fetch = mockFetchOk(
      sseStream([
        ':comment heartbeat\n\n', // keepalive comment SSE
        'data: not-json\n\n',     // payload inválido → skip
        'data: {"text":"ok"}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const text = await streamGuardianText({ query: 'q' });
    expect(text).toBe('ok');
  });

  it('respeta AbortSignal cuando el caller cancela mid-stream', async () => {
    global.fetch = vi.fn(async (_url, init) => {
      // Simular un stream lento que respeta abort.
      const signal = (init as RequestInit | undefined)?.signal;
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          if (signal?.aborted) {
            controller.error(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener('abort', () => {
            controller.error(new DOMException('Aborted', 'AbortError'));
          });
          // Nunca emite — pero abre el stream.
          await new Promise(() => undefined);
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 30);
    await expect(
      streamGuardianText({ query: 'q', signal: controller.signal }),
    ).rejects.toThrow();
  });
});
