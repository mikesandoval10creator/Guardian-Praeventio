// Tests §12.5.1 split step 3 — gemini/parsing.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { parseGeminiJson, withExponentialBackoff } from './parsing';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseGeminiJson', () => {
  it('text válido → JSON parsed', () => {
    const out = parseGeminiJson<{ a: number }>({ text: '{"a":42}' });
    expect(out.a).toBe(42);
  });

  it('text undefined → throws gemini_empty_response', () => {
    expect(() => parseGeminiJson({})).toThrow('gemini_empty_response');
  });

  it('text vacío "" → throws (vacío trata como ausente)', () => {
    expect(() => parseGeminiJson({ text: '' })).toThrow('gemini_empty_response');
  });

  it('JSON inválido → propaga SyntaxError nativo', () => {
    expect(() => parseGeminiJson({ text: 'no json' })).toThrow(SyntaxError);
  });

  it('preserva tipo genérico T', () => {
    interface Result {
      label: string;
      value: number;
    }
    const out = parseGeminiJson<Result>({ text: '{"label":"x","value":1}' });
    expect(out.label).toBe('x');
    expect(out.value).toBe(1);
  });
});

describe('withExponentialBackoff', () => {
  it('operation OK al primer intento → no retries', async () => {
    const op = vi.fn(async () => 'ok');
    const out = await withExponentialBackoff(op, 3, 1);
    expect(out).toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retry en 429 hasta success', async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      calls++;
      if (calls < 3) {
        const err = new Error('rate-limit') as Error & { status?: number };
        err.status = 429;
        throw err;
      }
      return 'eventual-ok';
    });
    const out = await withExponentialBackoff(op, 5, 1);
    expect(out).toBe('eventual-ok');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('retry en 503 hasta maxRetries → throws', async () => {
    const op = vi.fn(async () => {
      const err = new Error('unavailable') as Error & { status?: number };
      err.status = 503;
      throw err;
    });
    await expect(withExponentialBackoff(op, 2, 1)).rejects.toThrow('unavailable');
    // 1 + 2 = 3 intentos totales (1 inicial + 2 retries)
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('error sin status 429/503 → throws inmediato (no retry)', async () => {
    const op = vi.fn(async () => {
      const err = new Error('unauthorized') as Error & { status?: number };
      err.status = 401;
      throw err;
    });
    await expect(withExponentialBackoff(op, 5, 1)).rejects.toThrow('unauthorized');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('error sin status → throws inmediato', async () => {
    const op = vi.fn(async () => {
      throw new Error('plain error');
    });
    await expect(withExponentialBackoff(op, 5, 1)).rejects.toThrow('plain error');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('maxRetries=0 → un solo intento, propaga error', async () => {
    const op = vi.fn(async () => {
      const err = new Error('rl') as Error & { status?: number };
      err.status = 429;
      throw err;
    });
    await expect(withExponentialBackoff(op, 0, 1)).rejects.toThrow('rl');
    expect(op).toHaveBeenCalledTimes(1);
  });
});
