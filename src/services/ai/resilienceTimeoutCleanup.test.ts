import { afterEach, describe, expect, it, vi } from 'vitest';
import { resilientRead } from '../firestore/resilientReader.js';
import { answer } from './resilientAiOrchestrator.js';

afterEach(() => vi.restoreAllMocks());

// Observe the real timer branch instead of disabling Vitest's leak detector.
// A cleared Timeout handle alone does not settle its pending Promise.
function observeTimeoutBranches() {
  const originalRace = Promise.race;
  const branches: Promise<unknown>[] = [];
  vi.spyOn(Promise, 'race').mockImplementation((values) => {
    const entries = Array.from(values);
    branches.push(Promise.resolve(entries[1]));
    return originalRace.call(Promise, entries);
  });
  return async () => {
    // No race is also valid: a single completion Promise has no orphan branch.
    let settled = 0;
    for (const branch of branches) {
      void branch.then(
        () => {
          settled += 1;
        },
        () => {
          settled += 1;
        },
      );
    }
    await Promise.resolve();
    expect(settled).toBe(branches.length);
  };
}

describe('resilience timeout branch cleanup', () => {
  it.each([42, undefined, null])(
    'settles the losing reader timeout and preserves value %s',
    async (value) => {
      const assertSettled = observeTimeoutBranches();
      const result = await resilientRead(async () => value, { maxAttempts: 1 });
      expect(result.value).toBe(value);
      expect(result.fromFallback).toBe(false);
      await assertSettled();
    },
  );

  it('settles the reader timeout after rejection without replacing the real fallback value', async () => {
    const assertSettled = observeTimeoutBranches();
    const fallbackValue = { source: 'synthetic cache' };
    const result = await resilientRead(
      async () => {
        throw new Error('synthetic read failure');
      },
      {
        maxAttempts: 1,
        fallback: () => fallbackValue,
      },
    );
    expect(result.value).toBe(fallbackValue);
    expect(result.fromFallback).toBe(true);
    await assertSettled();
  });

  it('settles the losing AI tier timeout without changing its answer', async () => {
    const assertSettled = observeTimeoutBranches();
    const result = await answer(
      { prompt: 'synthetic cleanup probe' },
      {
        slm: async () => ({ text: 'synthetic answer', confidence: 0.9 }),
      },
      { allowedTiers: ['slm'] },
    );
    expect(result.tier).toBe('slm');
    expect(result.text).toBe('synthetic answer');
    await assertSettled();
  });

  it('settles the AI timeout after rejection and still returns a marked degraded answer', async () => {
    const assertSettled = observeTimeoutBranches();
    const result = await answer(
      { prompt: 'synthetic cleanup probe' },
      {
        slm: async () => {
          throw new Error('synthetic model failure');
        },
      },
      { allowedTiers: ['slm'] },
    );
    expect(result.tier).toBe('canned');
    expect(result.degraded).toBe(true);
    expect(result.tierErrors[0]?.error).toContain('synthetic model failure');
    await assertSettled();
  });

  it('cleans both deadlines after synchronous callback throws', async () => {
    vi.useFakeTimers();
    try {
      const readResult = await resilientRead(
        () => {
          throw new Error('synthetic sync read failure');
        },
        {
          maxAttempts: 1,
          fallback: () => 'synthetic cache',
        },
      );
      const aiResult = await answer(
        { prompt: 'synthetic sync probe' },
        {
          slm: () => {
            throw new Error('synthetic sync model failure');
          },
        },
        { allowedTiers: ['slm'] },
      );
      expect(readResult.value).toBe('synthetic cache');
      expect(aiResult.tier).toBe('canned');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['reader', 'ai'] as const)(
    'handles a late %s rejection without changing the already returned fallback',
    async (kind) => {
      vi.useFakeTimers();
      try {
        const lateFailure = () =>
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error('synthetic late failure')), 100);
          });
        const pending =
          kind === 'reader'
            ? resilientRead(lateFailure, {
                maxAttempts: 1,
                perAttemptTimeoutMs: 50,
                fallback: () => 'synthetic cache',
              }).then((result) => result.value)
            : answer(
                { prompt: 'synthetic late probe' },
                {
                  slm: lateFailure,
                  zettelkasten: async () => ({
                    text: 'synthetic cache',
                    confidence: 0.6,
                  }),
                },
                { allowedTiers: ['slm', 'zettelkasten'], tierTimeoutMs: 50 },
              ).then((result) => result.text);
        await vi.advanceTimersByTimeAsync(50);
        const result = await pending;
        expect(result).toBe('synthetic cache');
        await vi.runAllTimersAsync();
        expect(await pending).toBe(result);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        await vi.runAllTimersAsync();
        vi.useRealTimers();
      }
    },
  );
});
