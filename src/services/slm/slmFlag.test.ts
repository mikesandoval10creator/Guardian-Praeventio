/**
 * B14 — flag-gate tests for the SLM offline default-ON contract.
 *
 *   1. Default (nothing set) → ON.
 *   2. Kill-switch via process.env ('false' / '0') → OFF.
 *   3. Explicit truthy values stay ON.
 *   4. Global debug override wins over process.env.
 *   5. Garbage values do NOT kill the flag (fail-open to default ON).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { isSlmOfflineEnabled } from './slmFlag';

declare global {
  // eslint-disable-next-line no-var
  var __SLM_OFFLINE_ENABLED__: boolean | undefined;
}

afterEach(() => {
  delete process.env.SLM_OFFLINE_ENABLED;
  delete (globalThis as Record<string, unknown>).__SLM_OFFLINE_ENABLED__;
});

describe('isSlmOfflineEnabled — default ON + kill-switch (B14)', () => {
  it('is ON by default when no env var is set', () => {
    expect(isSlmOfflineEnabled()).toBe(true);
  });

  it("kill-switch: SLM_OFFLINE_ENABLED='false' disables", () => {
    process.env.SLM_OFFLINE_ENABLED = 'false';
    expect(isSlmOfflineEnabled()).toBe(false);
  });

  it("kill-switch: SLM_OFFLINE_ENABLED='0' disables", () => {
    process.env.SLM_OFFLINE_ENABLED = '0';
    expect(isSlmOfflineEnabled()).toBe(false);
  });

  it("explicit 'true' stays ON", () => {
    process.env.SLM_OFFLINE_ENABLED = 'true';
    expect(isSlmOfflineEnabled()).toBe(true);
  });

  it('global debug override (false) wins over process.env (true)', () => {
    process.env.SLM_OFFLINE_ENABLED = 'true';
    (globalThis as Record<string, unknown>).__SLM_OFFLINE_ENABLED__ = false;
    expect(isSlmOfflineEnabled()).toBe(false);
  });

  it('global debug override (true) wins over process.env (false)', () => {
    process.env.SLM_OFFLINE_ENABLED = 'false';
    (globalThis as Record<string, unknown>).__SLM_OFFLINE_ENABLED__ = true;
    expect(isSlmOfflineEnabled()).toBe(true);
  });

  it('garbage values fall through to the default (ON)', () => {
    process.env.SLM_OFFLINE_ENABLED = 'banana';
    expect(isSlmOfflineEnabled()).toBe(true);
  });
});
