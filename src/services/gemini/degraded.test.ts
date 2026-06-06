// Tests — GeminiDegradedError + isGeminiDegradedError.

import { describe, it, expect } from 'vitest';
import { GeminiDegradedError, isGeminiDegradedError } from './degraded';

describe('GeminiDegradedError', () => {
  it('carries the message and the degraded result', () => {
    const fallback = { ok: true };
    const err = new GeminiDegradedError('upstream_down', fallback);
    expect(err.message).toBe('upstream_down');
    expect(err.degradedResult).toBe(fallback);
    expect(err.name).toBe('GeminiDegradedError');
    expect(err).toBeInstanceOf(Error);
  });

  it('preserves the original cause when provided', () => {
    const cause = new Error('ETIMEDOUT');
    const err = new GeminiDegradedError('upstream_down', {}, { cause });
    expect((err as { cause?: unknown }).cause).toBe(cause);
  });
});

describe('isGeminiDegradedError', () => {
  it('recognises a real instance', () => {
    expect(isGeminiDegradedError(new GeminiDegradedError('x', {}))).toBe(true);
  });

  it('recognises a module-boundary duplicate by name + shape', () => {
    const lookalike = { name: 'GeminiDegradedError', degradedResult: { a: 1 } };
    expect(isGeminiDegradedError(lookalike)).toBe(true);
  });

  it('rejects unrelated errors and values', () => {
    expect(isGeminiDegradedError(new Error('nope'))).toBe(false);
    expect(isGeminiDegradedError({ name: 'GeminiDegradedError' })).toBe(false); // no degradedResult
    expect(isGeminiDegradedError(null)).toBe(false);
    expect(isGeminiDegradedError('GeminiDegradedError')).toBe(false);
  });
});
