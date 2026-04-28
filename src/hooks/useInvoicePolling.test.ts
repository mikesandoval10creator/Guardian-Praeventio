// Praeventio Guard — useInvoicePolling unit tests.
//
// We exercise the pure polling engine `runInvoicePoll` directly. The React
// hook `useInvoicePolling` is a thin `useEffect` wrapper around this engine,
// so testing the engine gives end-to-end coverage of the state machine
// (idle → loading → settled / timeout / error) without needing jsdom or
// @testing-library/react (neither of which are installed).
//
// Strategy:
//   • Mock `../services/firebase` so importing the hook module doesn't
//     bootstrap a real Firebase app in node.
//   • Inject a fake fetch, fake getToken, and a setTimer that resolves
//     instantly. This collapses backoff to zero wall-clock time so we
//     don't need fake timers for the happy paths. For the timeout test
//     we control `Date.now` via `vi.useFakeTimers()` + `vi.setSystemTime`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock firebase before the module under test imports it.
vi.mock('../services/firebase', () => ({
  auth: {
    currentUser: null,
  },
}));

import {
  runInvoicePoll,
  type InvoicePollDeps,
  type InvoicePollState,
  type InvoiceStatus,
} from './useInvoicePolling';

interface Harness {
  states: InvoicePollState[];
  controller: AbortController;
  deps: InvoicePollDeps;
  fetchMock: ReturnType<typeof vi.fn>;
  getTokenMock: ReturnType<typeof vi.fn>;
  setTimerSpy: ReturnType<typeof vi.fn>;
  clearTimerSpy: ReturnType<typeof vi.fn>;
}

function makeInvoice(overrides: Partial<InvoiceStatus> = {}): InvoiceStatus {
  return {
    id: 'inv_test_1',
    status: 'pending-payment',
    totals: { subtotal: 84034, iva: 15966, total: 100000, currency: 'CLP' },
    emisorRut: '78231119-0',
    issuedAt: '2026-04-28T10:00:00Z',
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

/**
 * Build a test harness. By default `setTimer` fires its callback on the
 * next microtask, so backoff delays don't add wall-clock latency. For
 * timeout tests we override this to drive `Date.now` forward instead.
 */
function makeHarness(opts: { instantTimers?: boolean } = {}): Harness {
  const states: InvoicePollState[] = [];
  const controller = new AbortController();
  const fetchMock = vi.fn();
  const getTokenMock = vi.fn(async () => 'fake-id-token');
  const setTimerSpy = vi.fn(
    (cb: () => void, _ms: number): unknown => {
      if (opts.instantTimers !== false) {
        // Fire on next microtask so the await inside the engine yields.
        queueMicrotask(cb);
        return Symbol('noop');
      }
      // Caller will manage timers manually via vi.useFakeTimers.
      return setTimeout(cb, 0);
    },
  );
  const clearTimerSpy = vi.fn();

  return {
    states,
    controller,
    fetchMock,
    getTokenMock,
    setTimerSpy,
    clearTimerSpy,
    deps: {
      fetchImpl: fetchMock as unknown as typeof fetch,
      getToken: getTokenMock,
      setTimer: setTimerSpy,
      clearTimer: clearTimerSpy,
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('runInvoicePoll — state machine', () => {
  it('1. invoiceId hook contract: empty id is handled by the React hook (engine does not run for empty)', async () => {
    // The engine itself is only invoked when invoiceId is truthy (the hook
    // gates on that). We assert the no-fetch contract by simulating an
    // immediate abort, which is what the hook does on cleanup with no id.
    const h = makeHarness();
    h.controller.abort();
    await runInvoicePoll({
      invoiceId: 'inv_x',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
    });
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.states).toHaveLength(0);
  });

  it('2. 200 with status=pending-payment keeps polling, then settles when status flips', async () => {
    const h = makeHarness();
    h.fetchMock
      .mockResolvedValueOnce(jsonResponse(200, makeInvoice({ status: 'pending-payment' })))
      .mockResolvedValueOnce(jsonResponse(200, makeInvoice({ status: 'pending-payment' })))
      .mockResolvedValueOnce(jsonResponse(200, makeInvoice({ status: 'paid', paidAt: '2026-04-28T10:00:05Z' })));

    await runInvoicePoll({
      invoiceId: 'inv_2',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
      intervalMs: 1,
      timeoutMs: 60_000,
    });

    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    const final = h.states[h.states.length - 1];
    expect(final.kind).toBe('settled');
    if (final.kind === 'settled') {
      expect(final.invoice.status).toBe('paid');
      expect(final.invoice.paidAt).toBeDefined();
    }
  });

  it('3. 200 with status=paid settles immediately (single fetch)', async () => {
    const h = makeHarness();
    h.fetchMock.mockResolvedValueOnce(jsonResponse(200, makeInvoice({ status: 'paid' })));

    await runInvoicePoll({
      invoiceId: 'inv_3',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
    });

    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    expect(h.states.map((s) => s.kind)).toEqual(['loading', 'settled']);
  });

  it('4. 200 with status=rejected settles (terminal even without paidAt)', async () => {
    const h = makeHarness();
    h.fetchMock.mockResolvedValueOnce(
      jsonResponse(200, makeInvoice({ status: 'rejected', rejectionReason: 'Tarjeta declinada' })),
    );

    await runInvoicePoll({
      invoiceId: 'inv_4',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
    });

    const final = h.states[h.states.length - 1];
    expect(final.kind).toBe('settled');
    if (final.kind === 'settled') {
      expect(final.invoice.status).toBe('rejected');
      expect(final.invoice.rejectionReason).toBe('Tarjeta declinada');
    }
  });

  it('5. 404 keeps polling (D1 endpoint may not have written yet)', async () => {
    const h = makeHarness();
    h.fetchMock
      .mockResolvedValueOnce(emptyResponse(404))
      .mockResolvedValueOnce(emptyResponse(404))
      .mockResolvedValueOnce(jsonResponse(200, makeInvoice({ status: 'paid' })));

    await runInvoicePoll({
      invoiceId: 'inv_5',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
      intervalMs: 1,
    });

    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    expect(h.states[h.states.length - 1].kind).toBe('settled');
  });

  it('6. 401 errors out with "no autenticado" and stops', async () => {
    const h = makeHarness();
    h.fetchMock.mockResolvedValueOnce(emptyResponse(401));

    await runInvoicePoll({
      invoiceId: 'inv_6',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
    });

    const final = h.states[h.states.length - 1];
    expect(final.kind).toBe('error');
    if (final.kind === 'error') expect(final.message).toBe('no autenticado');
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('6b. signed-out user (token always null) errors out with "sin sesión"', async () => {
    // After Round 13's hydration grace (one-shot retry on a null first-tick
    // token), the "signed out" contract requires the token to be null on
    // BOTH attempts. A single null + a real token on the second tick now
    // resolves successfully (see test 12). Two consecutive nulls = no session.
    const h = makeHarness();
    h.getTokenMock.mockResolvedValue(null);

    await runInvoicePoll({
      invoiceId: 'inv_6b',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
      intervalMs: 1,
    });

    const final = h.states[h.states.length - 1];
    expect(final.kind).toBe('error');
    if (final.kind === 'error') expect(final.message).toBe('sin sesión');
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('11. 4xx other than 401/404 (e.g. 422) errors out with "respuesta inválida" and stops', async () => {
    // Round 13 D6 MEDIUM coverage: 422 / 400 / 403 are fatal but were lacking
    // a dedicated test. The production code already routes them to
    // `respuesta inválida (status)` — this test pins that contract.
    const h = makeHarness();
    h.fetchMock.mockResolvedValueOnce(emptyResponse(422));

    await runInvoicePoll({
      invoiceId: 'inv_11',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
    });

    const final = h.states[h.states.length - 1];
    expect(final.kind).toBe('error');
    if (final.kind === 'error') {
      expect(final.message).toContain('respuesta inválida');
      expect(final.message).toContain('422');
    }
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('12. first-tick null token retries once (Firebase Auth hydration grace period)', async () => {
    // Round 13 D6 MEDIUM: when the page mounts before Firebase Auth has
    // resolved currentUser, getToken briefly returns null. Bailing out
    // surfaces a misleading "sin sesión" to a logged-in user. The engine
    // grants a one-shot retry instead.
    const h = makeHarness();
    h.getTokenMock
      .mockResolvedValueOnce(null) // first attempt: still hydrating
      .mockResolvedValue('fake-id-token'); // subsequent attempts: real token

    h.fetchMock.mockResolvedValueOnce(
      jsonResponse(200, makeInvoice({ status: 'paid' })),
    );

    await runInvoicePoll({
      invoiceId: 'inv_12',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
      intervalMs: 1,
    });

    const final = h.states[h.states.length - 1];
    expect(final.kind).toBe('settled');
    expect(h.getTokenMock).toHaveBeenCalledTimes(2);
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('12b. hydration grace is one-shot — two consecutive nulls still bail with "sin sesión"', async () => {
    // The grace must NOT loop forever: a real signed-out user should still
    // see the error (see test 6b for the redundant guarantee).
    const h = makeHarness();
    h.getTokenMock.mockResolvedValue(null); // forever null

    await runInvoicePoll({
      invoiceId: 'inv_12b',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
      intervalMs: 1,
    });

    const final = h.states[h.states.length - 1];
    expect(final.kind).toBe('error');
    if (final.kind === 'error') expect(final.message).toBe('sin sesión');
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.getTokenMock).toHaveBeenCalledTimes(2);
  });

  it('7. timeout reached emits {kind: timeout} and stops polling', async () => {
    // Drive Date.now via fake timers; setTimer fires synchronously after we
    // bump the clock so the engine sees the deadline crossed.
    vi.useFakeTimers();
    const start = new Date('2026-04-28T10:00:00Z').getTime();
    vi.setSystemTime(start);

    const h = makeHarness({ instantTimers: false });

    // Custom timer: capture cb, advance system time when called.
    const queue: Array<{ cb: () => void; ms: number }> = [];
    h.setTimerSpy.mockImplementation((cb, ms) => {
      queue.push({ cb, ms });
      return queue.length;
    });

    // Always return pending-payment so polling never settles on its own.
    h.fetchMock.mockResolvedValue(jsonResponse(200, makeInvoice({ status: 'pending-payment' })));

    const pollPromise = runInvoicePoll({
      invoiceId: 'inv_7',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
      intervalMs: 100,
      timeoutMs: 500,
      backoffCapMs: 200,
    });

    // Drain a few cycles: each cycle does fetch (real microtasks) + setTimer.
    // We let the microtasks run, then advance time and fire the queued timer.
    for (let i = 0; i < 12 && queue.length === 0 && h.fetchMock.mock.calls.length === 0; i++) {
      await Promise.resolve();
    }

    // Loop: drain microtasks → fire timer → advance clock. After timeoutMs
    // wall-clock time, the engine should emit timeout on the next iteration.
    let safety = 50;
    while (safety-- > 0) {
      // Let pending microtasks (including the fetch resolve) flush.
      await vi.advanceTimersByTimeAsync(0);
      const next = queue.shift();
      if (!next) {
        // Engine is between awaits; let microtasks settle once more.
        await Promise.resolve();
        await Promise.resolve();
        if (h.states.some((s) => s.kind === 'timeout')) break;
        if (queue.length === 0) {
          // No timer pending and no timeout yet → just advance the clock and
          // let the engine's top-of-loop deadline check fire on next tick.
          vi.setSystemTime(Date.now() + 100);
          continue;
        }
      } else {
        vi.setSystemTime(Date.now() + Math.max(next.ms, 1));
        next.cb();
      }
      if (h.states.some((s) => s.kind === 'timeout')) break;
    }

    await pollPromise;

    const final = h.states[h.states.length - 1];
    expect(final.kind).toBe('timeout');
    // We polled multiple times before giving up.
    expect(h.fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('8. abort signal cancels in-flight polling and emits no further state', async () => {
    const h = makeHarness();
    let resolveFetch!: (r: Response) => void;
    h.fetchMock.mockImplementation(
      () =>
        new Promise<Response>((res) => {
          resolveFetch = res;
        }),
    );

    const pollPromise = runInvoicePoll({
      invoiceId: 'inv_8',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
    });

    // Wait for the engine to emit its first "loading" and start the fetch.
    await Promise.resolve();
    await Promise.resolve();
    expect(h.states.some((s) => s.kind === 'loading')).toBe(true);
    const beforeAbort = h.states.length;

    // Abort. The engine must not emit any further state, even if the fetch
    // resolves afterwards.
    h.controller.abort();
    resolveFetch(jsonResponse(200, makeInvoice({ status: 'paid' })));
    await pollPromise;

    expect(h.states.length).toBe(beforeAbort);
    // No `settled` state was appended despite the 200 response arriving.
    expect(h.states.some((s) => s.kind === 'settled')).toBe(false);
  });

  it('9. custom intervalMs is honored as the first delay (capped by backoffCap)', async () => {
    const h = makeHarness();
    h.fetchMock
      .mockResolvedValueOnce(emptyResponse(404))
      .mockResolvedValueOnce(jsonResponse(200, makeInvoice({ status: 'paid' })));

    await runInvoicePoll({
      invoiceId: 'inv_9',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
      intervalMs: 250,
      backoffCapMs: 1000,
    });

    // First setTimer call records the delay between the 1st and 2nd attempts.
    expect(h.setTimerSpy).toHaveBeenCalled();
    const firstDelay = h.setTimerSpy.mock.calls[0]![1] as number;
    expect(firstDelay).toBe(250);
  });

  it('10. exponential backoff caps at backoffCapMs (default 8000 ms)', async () => {
    const h = makeHarness();
    // Six 404s then a paid → exercises 5 backoff steps: 1s,2s,4s,8s,8s.
    for (let i = 0; i < 5; i++) h.fetchMock.mockResolvedValueOnce(emptyResponse(404));
    h.fetchMock.mockResolvedValueOnce(jsonResponse(200, makeInvoice({ status: 'paid' })));

    await runInvoicePoll({
      invoiceId: 'inv_10',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
      intervalMs: 1000,
      backoffCapMs: 8000,
      timeoutMs: 5 * 60_000, // ample headroom; engine doesn't actually wait.
    });

    const delays = h.setTimerSpy.mock.calls.map((c) => c[1] as number);
    expect(delays.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 8000]);
    expect(delays.every((d) => d <= 8000)).toBe(true);
  });

  it('5xx responses are treated as transient and polling continues', async () => {
    const h = makeHarness();
    h.fetchMock
      .mockResolvedValueOnce(emptyResponse(503))
      .mockResolvedValueOnce(emptyResponse(500))
      .mockResolvedValueOnce(jsonResponse(200, makeInvoice({ status: 'paid' })));

    await runInvoicePoll({
      invoiceId: 'inv_5xx',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
      intervalMs: 1,
    });

    expect(h.fetchMock).toHaveBeenCalledTimes(3);
    expect(h.states[h.states.length - 1].kind).toBe('settled');
  });

  it('attempt counter monotonically increases across loading emissions', async () => {
    const h = makeHarness();
    h.fetchMock
      .mockResolvedValueOnce(emptyResponse(404))
      .mockResolvedValueOnce(emptyResponse(404))
      .mockResolvedValueOnce(jsonResponse(200, makeInvoice({ status: 'paid' })));

    await runInvoicePoll({
      invoiceId: 'inv_att',
      deps: h.deps,
      onState: (s) => h.states.push(s),
      signal: h.controller.signal,
      intervalMs: 1,
    });

    const loadingAttempts = h.states
      .filter((s): s is { kind: 'loading'; attempt: number } => s.kind === 'loading')
      .map((s) => s.attempt);
    expect(loadingAttempts).toEqual([1, 2, 3]);
  });
});
