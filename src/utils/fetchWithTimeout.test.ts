// SPDX-License-Identifier: MIT
//
// Tests for fetchWithTimeout: a thin wrapper around global fetch that aborts
// the request when a timeout elapses, forwards an external abort signal, and
// always clears its internal timer.
//
// Slow-HTTP mitigation: external services (OAuth, Gemini, OpenWeather, USGS)
// can wedge a backend worker indefinitely if the upstream never sends bytes.
// This util ensures every external fetch has a hard ceiling.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithTimeout, FetchTimeoutError } from './fetchWithTimeout';

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns the Response when fetch resolves before the timeout', async () => {
    const fakeResponse = new Response('ok', { status: 200 });
    const fetchImpl = vi.fn(async () => fakeResponse);

    const result = await fetchWithTimeout('https://example.test/x', {}, {
      timeoutMs: 5_000,
      fetchImpl,
    });

    expect(result).toBe(fakeResponse);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('passes an AbortSignal to fetch so the request is cancellable', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response('ok');
    });

    await fetchWithTimeout('https://example.test/x', {}, {
      timeoutMs: 5_000,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalled();
  });

  it('throws FetchTimeoutError when fetch exceeds the timeout', async () => {
    // A fetch that resolves only if its signal aborts.
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    const promise = fetchWithTimeout('https://example.test/x', {}, {
      timeoutMs: 10_000,
      fetchImpl,
    });
    // Attach a no-op rejection handler so an unhandled rejection doesn't
    // crash the test runner while we advance timers.
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(10_001);

    await expect(promise).rejects.toBeInstanceOf(FetchTimeoutError);
  });

  it('forwards an external AbortSignal — pre-aborted external triggers abort immediately', async () => {
    // Mimic real fetch: it rejects immediately if the signal is already
    // aborted at call time, without waiting for a future 'abort' event.
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new DOMException('aborted', 'AbortError'));
            return;
          }
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    const external = new AbortController();
    external.abort();

    await expect(
      fetchWithTimeout('https://example.test/x', { signal: external.signal }, {
        timeoutMs: 10_000,
        fetchImpl,
      }),
    ).rejects.toThrow();
  });

  it('forwards an external AbortSignal — late external abort cancels in-flight fetch', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    const external = new AbortController();
    const promise = fetchWithTimeout('https://example.test/x', { signal: external.signal }, {
      timeoutMs: 60_000,
      fetchImpl,
    });
    promise.catch(() => {});

    external.abort();

    await expect(promise).rejects.toThrow();
  });

  it('uses default timeout 10_000ms when not specified', async () => {
    const fetchImpl = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    const promise = fetchWithTimeout('https://example.test/x', {}, {
      fetchImpl,
    });
    promise.catch(() => {});

    // Just under default timeout — still pending.
    await vi.advanceTimersByTimeAsync(9_999);
    // Push past default timeout — should reject.
    await vi.advanceTimersByTimeAsync(2);

    await expect(promise).rejects.toBeInstanceOf(FetchTimeoutError);
  });

  it('clears the timeout timer when fetch resolves (no lingering timer)', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'));
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    await fetchWithTimeout('https://example.test/x', {}, {
      timeoutMs: 5_000,
      fetchImpl,
    });

    expect(clearSpy).toHaveBeenCalled();
  });

  it('clears the timeout timer when fetch rejects (no lingering timer)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    await expect(
      fetchWithTimeout('https://example.test/x', {}, {
        timeoutMs: 5_000,
        fetchImpl,
      }),
    ).rejects.toThrow('network down');

    expect(clearSpy).toHaveBeenCalled();
  });

  it('preserves the original RequestInit properties (method, headers, body)', async () => {
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(init?.body).toBe('{"hello":"world"}');
      return new Response('ok');
    });

    await fetchWithTimeout(
      'https://example.test/x',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"hello":"world"}',
      },
      { timeoutMs: 1_000, fetchImpl },
    );
  });
});
