import { describe, it, expect, vi } from 'vitest';
import {
  isUnretriableFirebaseError,
  resilientFirestoreWithCache,
  resilientRead,
  ResilientReadError,
} from './resilientReader';

const fastSleep = async (_ms: number) => {
  // Skip real timers in tests so we don't wait the actual backoff.
};

describe('resilientRead', () => {
  it('primer attempt funciona: no retry, no fallback', async () => {
    const read = vi.fn(async () => 'ok');
    const r = await resilientRead(read, { sleep: fastSleep });
    expect(r.value).toBe('ok');
    expect(r.fromFallback).toBe(false);
    expect(r.attempts).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('falla 2x → retry, attempt 3 ok', async () => {
    let count = 0;
    const read = vi.fn(async () => {
      count++;
      if (count < 3) throw new Error('transient');
      return 'good';
    });
    const r = await resilientRead(read, { sleep: fastSleep });
    expect(r.value).toBe('good');
    expect(r.fromFallback).toBe(false);
    expect(r.attempts).toHaveLength(3);
    expect(r.attempts[0]!.error).toBe('transient');
    expect(r.attempts[1]!.error).toBe('transient');
    expect(r.attempts[2]!.error).toBeUndefined();
  });

  it('todos los attempts fallan + sin fallback → ResilientReadError', async () => {
    const read = vi.fn(async () => {
      throw new Error('permanent');
    });
    await expect(resilientRead(read, { sleep: fastSleep })).rejects.toBeInstanceOf(
      ResilientReadError,
    );
    expect(read).toHaveBeenCalledTimes(3); // default maxAttempts
  });

  it('todos fallan + fallback set → fromFallback=true', async () => {
    const read = async () => {
      throw new Error('no network');
    };
    const fallback = vi.fn(async () => 'cached');
    const r = await resilientRead(read, { sleep: fastSleep, fallback });
    expect(r.value).toBe('cached');
    expect(r.fromFallback).toBe(true);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(r.attempts).toHaveLength(3);
  });

  it('primary falla + fallback falla → ResilientReadError con ambos errores', async () => {
    const read = async () => {
      throw new Error('primary boom');
    };
    const fallback = async () => {
      throw new Error('cache empty');
    };
    try {
      await resilientRead(read, { sleep: fastSleep, fallback });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(ResilientReadError);
      expect((err as Error).message).toContain('primary boom');
      expect((err as Error).message).toContain('cache empty');
    }
  });

  it('isUnretriable bypassa los retries y va directo al fallback', async () => {
    const read = vi.fn(async () => {
      const e = new Error('permission-denied');
      (e as Error & { code?: string }).code = 'permission-denied';
      throw e;
    });
    const fallback = vi.fn(async () => 'fallback-value');
    const r = await resilientRead(read, {
      sleep: fastSleep,
      fallback,
      isUnretriable: isUnretriableFirebaseError,
    });
    expect(r.value).toBe('fallback-value');
    expect(r.fromFallback).toBe(true);
    // Solo UN attempt, no los 3 default.
    expect(read).toHaveBeenCalledTimes(1);
    expect(r.attempts).toHaveLength(1);
  });

  it('isUnretriable sin fallback → throw inmediato', async () => {
    const read = vi.fn(async () => {
      const e = new Error('not-found');
      (e as Error & { code?: string }).code = 'not-found';
      throw e;
    });
    await expect(
      resilientRead(read, {
        sleep: fastSleep,
        isUnretriable: isUnretriableFirebaseError,
      }),
    ).rejects.toBeInstanceOf(ResilientReadError);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('timeout per attempt: read tarda más → fallback dispara', async () => {
    const slowRead: () => Promise<string> = () =>
      new Promise((res) => setTimeout(() => res('tarde'), 5000));
    const fallback = async () => 'cache';
    const r = await resilientRead(slowRead, {
      sleep: fastSleep,
      perAttemptTimeoutMs: 50,
      fallback,
    });
    expect(r.value).toBe('cache');
    expect(r.attempts.every((a) => a.error?.includes('timeout'))).toBe(true);
  });

  it('maxAttempts custom', async () => {
    const read = vi.fn(async () => {
      throw new Error('always fail');
    });
    try {
      await resilientRead(read, { sleep: fastSleep, maxAttempts: 5 });
    } catch {
      /* ignore */
    }
    expect(read).toHaveBeenCalledTimes(5);
  });

  it('exponential backoff: 500ms, 1000ms, 2000ms', async () => {
    const sleepMs: number[] = [];
    const sleep = async (ms: number) => {
      sleepMs.push(ms);
    };
    const read = vi.fn(async () => {
      throw new Error('fail');
    });
    await resilientRead(read, {
      sleep,
      maxAttempts: 4,
    }).catch(() => {});
    // Between 4 attempts hay 3 sleeps: 500, 1000, 2000.
    expect(sleepMs).toEqual([500, 1000, 2000]);
  });

  it('maxBackoffMs cap', async () => {
    const sleepMs: number[] = [];
    const sleep = async (ms: number) => {
      sleepMs.push(ms);
    };
    const read = vi.fn(async () => {
      throw new Error('fail');
    });
    await resilientRead(read, {
      sleep,
      maxAttempts: 6,
      baseBackoffMs: 1000,
      maxBackoffMs: 3000, // cap < natural 16000 at attempt 5
    }).catch(() => {});
    // 1000, 2000, 3000 (capped), 3000 (capped), 3000 (capped)
    expect(sleepMs).toEqual([1000, 2000, 3000, 3000, 3000]);
  });

  it('latencyMs incluido', async () => {
    let t = 1000;
    const r = await resilientRead(async () => 'fast', {
      sleep: fastSleep,
      nowMs: () => {
        const v = t;
        t += 5;
        return v;
      },
    });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe('resilientFirestoreWithCache builder', () => {
  it('curry consistente: read ok → fromFallback=false', async () => {
    const reader = resilientFirestoreWithCache(
      async () => ({ data: 'fresh' }),
      async () => ({ data: 'stale-cache' }),
      { sleep: fastSleep },
    );
    const r = await reader();
    expect(r.value).toEqual({ data: 'fresh' });
    expect(r.fromFallback).toBe(false);
  });

  it('read falla → cache fallback', async () => {
    const reader = resilientFirestoreWithCache(
      async () => {
        throw new Error('offline');
      },
      async () => ({ data: 'stale-cache' }),
      { sleep: fastSleep },
    );
    const r = await reader();
    expect(r.value).toEqual({ data: 'stale-cache' });
    expect(r.fromFallback).toBe(true);
  });
});

describe('isUnretriableFirebaseError', () => {
  it('permission-denied → true', () => {
    expect(isUnretriableFirebaseError({ code: 'permission-denied' })).toBe(true);
  });

  it('not-found → true', () => {
    expect(isUnretriableFirebaseError({ code: 'not-found' })).toBe(true);
  });

  it('invalid-argument → true', () => {
    expect(isUnretriableFirebaseError({ code: 'invalid-argument' })).toBe(true);
  });

  it('unauthenticated → true', () => {
    expect(isUnretriableFirebaseError({ code: 'unauthenticated' })).toBe(true);
  });

  it('unavailable → false (network blip, retry vale la pena)', () => {
    expect(isUnretriableFirebaseError({ code: 'unavailable' })).toBe(false);
  });

  it('deadline-exceeded → false', () => {
    expect(isUnretriableFirebaseError({ code: 'deadline-exceeded' })).toBe(
      false,
    );
  });

  it('error sin code → false', () => {
    expect(isUnretriableFirebaseError(new Error('generic'))).toBe(false);
  });

  it('null/undefined → false', () => {
    expect(isUnretriableFirebaseError(null)).toBe(false);
    expect(isUnretriableFirebaseError(undefined)).toBe(false);
  });
});
