// Praeventio Guard — Sprint 22 prod hardening (Bucket X) tests.
//
// Vitest harness for `geminiCircuit.ts`. Uses an injected clock to
// simulate the WINDOW_MS / OPEN_DURATION_MS transitions deterministically
// without `vi.useFakeTimers` (the breaker has no internal timers — it
// reads clock at decision time, so a callable clock is enough).

import { describe, it, expect, beforeEach } from 'vitest';
import { GeminiCircuitBreaker } from './geminiCircuit.js';

let now = 0;
const clock = () => now;
let breaker: GeminiCircuitBreaker;

beforeEach(() => {
  now = 1_000_000;
  breaker = new GeminiCircuitBreaker(clock);
});

describe('GeminiCircuitBreaker — initial state', () => {
  it('starts closed for any unknown key', () => {
    expect(breaker.getState('gemini')).toBe('closed');
    expect(breaker.isOpen('gemini')).toBe(false);
    expect(breaker.isOpen('tenant-A')).toBe(false);
  });
});

describe('GeminiCircuitBreaker — opening transition', () => {
  it('opens after THRESHOLD failures inside WINDOW_MS', () => {
    for (let i = 0; i < breaker.THRESHOLD; i += 1) {
      breaker.recordFailure('gemini');
      now += 1_000; // 1s between failures, well within WINDOW_MS=60s
    }
    expect(breaker.getState('gemini')).toBe('open');
    expect(breaker.isOpen('gemini')).toBe(true);
  });

  it('does not open if failures are spread beyond WINDOW_MS', () => {
    for (let i = 0; i < breaker.THRESHOLD; i += 1) {
      breaker.recordFailure('gemini');
      now += breaker.WINDOW_MS + 1;
    }
    // Each failure resets the window since the previous one is stale,
    // so the counter never accumulates to THRESHOLD.
    expect(breaker.getState('gemini')).toBe('closed');
  });

  it('isolates failures per key', () => {
    for (let i = 0; i < breaker.THRESHOLD; i += 1) {
      breaker.recordFailure('gemini');
    }
    expect(breaker.isOpen('gemini')).toBe(true);
    expect(breaker.isOpen('tenant-A')).toBe(false);
    expect(breaker.getState('tenant-A')).toBe('closed');
  });
});

describe('GeminiCircuitBreaker — half-open transition', () => {
  function trip() {
    for (let i = 0; i < breaker.THRESHOLD; i += 1) {
      breaker.recordFailure('gemini');
    }
  }

  it('moves from open to half-open after OPEN_DURATION_MS elapses', () => {
    trip();
    expect(breaker.getState('gemini')).toBe('open');

    now += breaker.OPEN_DURATION_MS + 1;
    expect(breaker.getState('gemini')).toBe('half-open');
    // half-open is not "open" — callers can probe Gemini again.
    expect(breaker.isOpen('gemini')).toBe(false);
  });

  it('recordSuccess in half-open resets the breaker to closed', () => {
    trip();
    now += breaker.OPEN_DURATION_MS + 1;
    expect(breaker.getState('gemini')).toBe('half-open');

    breaker.recordSuccess('gemini');
    expect(breaker.getState('gemini')).toBe('closed');
    expect(breaker.isOpen('gemini')).toBe(false);
  });

  it('recordFailure in half-open re-opens the breaker', () => {
    trip();
    now += breaker.OPEN_DURATION_MS + 1;
    expect(breaker.getState('gemini')).toBe('half-open');

    breaker.recordFailure('gemini');
    expect(breaker.getState('gemini')).toBe('open');

    // And it stays open for another full OPEN_DURATION_MS.
    now += breaker.OPEN_DURATION_MS - 1;
    expect(breaker.getState('gemini')).toBe('open');
    now += 2;
    expect(breaker.getState('gemini')).toBe('half-open');
  });
});

describe('GeminiCircuitBreaker — recordSuccess in closed state', () => {
  it('clears any stale partial-failure counter', () => {
    for (let i = 0; i < breaker.THRESHOLD - 1; i += 1) {
      breaker.recordFailure('gemini');
    }
    // Below threshold — still closed but counter present.
    expect(breaker.getState('gemini')).toBe('closed');

    breaker.recordSuccess('gemini');
    // Now another single failure should NOT trip the breaker.
    breaker.recordFailure('gemini');
    expect(breaker.getState('gemini')).toBe('closed');
  });
});

describe('GeminiCircuitBreaker — snapshot', () => {
  it('returns the state of every tracked key', () => {
    for (let i = 0; i < breaker.THRESHOLD; i += 1) {
      breaker.recordFailure('gemini');
    }
    breaker.recordFailure('tenant-A');
    const snap = breaker.snapshot();
    expect(snap['gemini']).toBe('open');
    expect(snap['tenant-A']).toBe('closed');
  });
});
