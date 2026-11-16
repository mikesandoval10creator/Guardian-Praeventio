import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getGeminiApiKey, requireGeminiApiKey } from './geminiApiKey.js';

/**
 * Contract for call-scope key resolution.
 *
 * The regression this guards: 31 production modules used to read
 * `const API_KEY = process.env.GEMINI_API_KEY` at MODULE SCOPE. That froze the
 * credential at import time, which makes a per-user ("bring your own
 * subscription") credential impossible — the app would always use whatever the
 * process environment held at boot.
 *
 * The key must therefore be resolved on every CALL, so that a credential
 * injected or rotated at runtime is picked up without a restart.
 */
describe('getGeminiApiKey', () => {
  const ORIGINAL = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = ORIGINAL;
  });

  it('returns undefined when no key is configured', () => {
    expect(getGeminiApiKey()).toBeUndefined();
  });

  it('reads the environment on every call, not at import time', () => {
    // First call: no key configured.
    expect(getGeminiApiKey()).toBeUndefined();

    // The credential appears later (rotation / per-request injection).
    process.env.GEMINI_API_KEY = 'late-key';

    // A second call MUST observe it. This is the exact property that a
    // module-scope constant cannot provide.
    expect(getGeminiApiKey()).toBe('late-key');
  });

  it('reflects a changed value without re-importing', () => {
    process.env.GEMINI_API_KEY = 'first';
    expect(getGeminiApiKey()).toBe('first');

    process.env.GEMINI_API_KEY = 'second';
    expect(getGeminiApiKey()).toBe('second');
  });

  it('treats whitespace-only values as absent', () => {
    process.env.GEMINI_API_KEY = '   ';
    expect(getGeminiApiKey()).toBeUndefined();
  });

  it('trims surrounding whitespace from the environment value', () => {
    process.env.GEMINI_API_KEY = '  padded-key  ';
    expect(getGeminiApiKey()).toBe('padded-key');
  });

  it('prefers an explicit per-call credential over the environment', () => {
    process.env.GEMINI_API_KEY = 'env-key';
    expect(getGeminiApiKey({ userApiKey: 'user-key' })).toBe('user-key');
  });

  it('ignores a blank explicit credential and falls back to the environment', () => {
    process.env.GEMINI_API_KEY = 'env-key';
    expect(getGeminiApiKey({ userApiKey: '   ' })).toBe('env-key');
  });

  it('never returns the key through an error message', () => {
    process.env.GEMINI_API_KEY = 'super-secret-value';
    expect(() => requireGeminiApiKey({ userApiKey: '' })).not.toThrow();
    expect(requireGeminiApiKey()).toBe('super-secret-value');
  });
});

describe('requireGeminiApiKey', () => {
  const ORIGINAL = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = ORIGINAL;
  });

  it('throws a configuration error when no key is available', () => {
    expect(() => requireGeminiApiKey()).toThrow('GEMINI_API_KEY is not configured');
  });

  it('returns the key when one is configured', () => {
    process.env.GEMINI_API_KEY = 'configured';
    expect(requireGeminiApiKey()).toBe('configured');
  });

  it('does not leak the key in the thrown error', () => {
    delete process.env.GEMINI_API_KEY;
    try {
      requireGeminiApiKey();
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('GEMINI_API_KEY=');
    }
  });
});
