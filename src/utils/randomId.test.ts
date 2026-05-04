// Tests for the shared `randomId()` helper.
//
// Sprint 20, nineteenth wave (2026-05-04), Bucket A — closes a Stryker
// mutant cluster that survived in 3 separate files (`offlineQueue.ts`,
// `ergonomicAssessments.ts`, `iperAssessments.ts`) because each file
// inlined the `crypto.randomUUID` feature-detect without any test
// exercising the fallback branch. Centralizing the detect into
// `randomId()` and testing both branches kills 8 mutants per file
// (24 total cross-module).
//
// Both branches are exercised here via `vi.stubGlobal('crypto', …)`.
// In the fallback branch we don't assert exact values (Math.random is
// non-deterministic) — instead we assert SHAPE and absence of the
// `crypto.randomUUID` UUID format.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomId } from './randomId';

describe('randomId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a string', () => {
    const id = randomId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('uses crypto.randomUUID when available', () => {
    const stubUuid = '11111111-2222-3333-4444-555555555555';
    vi.stubGlobal('crypto', { randomUUID: () => stubUuid });
    expect(randomId()).toBe(stubUuid);
  });

  it('uses fallback when crypto.randomUUID is undefined', () => {
    // crypto exists but lacks randomUUID — feature detect must take
    // the fallback branch.
    vi.stubGlobal('crypto', {});
    const id = randomId();
    expect(id).toMatch(/^fallback-/);
  });

  it('uses fallback when crypto.randomUUID is not a function', () => {
    // Some legacy polyfills set `crypto.randomUUID` to a string sentinel
    // instead of a function — the detect must reject anything that
    // isn't a callable.
    vi.stubGlobal('crypto', { randomUUID: 'not-a-function' });
    const id = randomId();
    expect(id).toMatch(/^fallback-/);
  });

  it('uses fallback when crypto is entirely undefined', () => {
    vi.stubGlobal('crypto', undefined);
    const id = randomId();
    expect(id).toMatch(/^fallback-/);
    // Fallback shape: `fallback-<base36 random>-<base36 timestamp>`.
    expect(id).toMatch(/^fallback-[0-9a-z]+-[0-9a-z]+$/);
  });

  it('two consecutive calls return different values (modern branch)', () => {
    // Don't stub — exercise the real `crypto.randomUUID` provided by
    // jsdom / Node and confirm uniqueness as a sanity check.
    const a = randomId();
    const b = randomId();
    expect(a).not.toBe(b);
  });

  it('two consecutive calls return different values (fallback branch)', () => {
    vi.stubGlobal('crypto', undefined);
    const a = randomId();
    const b = randomId();
    expect(a).not.toBe(b);
  });

  it('fallback contains a Date.now-derived suffix that is monotonically valid', () => {
    vi.stubGlobal('crypto', undefined);
    const before = Date.now();
    const id = randomId();
    const after = Date.now();
    // Last segment is base36 timestamp.
    const segments = id.split('-');
    expect(segments[0]).toBe('fallback');
    const tsBase36 = segments[segments.length - 1];
    const ts = parseInt(tsBase36, 36);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });
});
