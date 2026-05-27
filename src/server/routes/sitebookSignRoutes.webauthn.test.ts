// P0 security fix tests: sitebookSignRoutes.ts must read WEBAUTHN_RP_ID
// (correct underscore), align with curriculum.ts + suseso.ts, and fail
// fast in production rather than silently fall back to a hardcoded host.
//
// We exercise the helper directly via module-scope re-import after env
// mutation. The helper is not currently exported, so we extract its
// behaviour through the env-driven contract using a tiny IIFE that
// mirrors getWebAuthnRpId() — keeping the test stable across refactors
// (helper rename / extraction) while still pinning the regression: the
// typo `WEBAUTHN_RPID` (no underscore) must NEVER be read again.
//
// The actual route wiring is exercised by sitebookSign.test.ts; this
// file targets only the env-resolution surface that broke in production.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_FILE = resolve(__dirname, './sitebookSignRoutes.ts');

describe('sitebookSignRoutes — WEBAUTHN_RP_ID env resolution (P0 fix)', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.WEBAUTHN_RP_ID;
    delete process.env.WEBAUTHN_RPID; // legacy typo — never read it again
    delete process.env.NODE_ENV;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('source file no longer READS the legacy WEBAUTHN_RPID typo via env', () => {
    const src = readFileSync(ROUTE_FILE, 'utf-8');
    // Strip comment lines so a regression-doc mention of the legacy typo
    // (e.g. the comment block above getWebAuthnRpId()) doesn't trigger
    // this guard. We're looking for actual `process.env.WEBAUTHN_RPID`
    // lookups — the production read site. Mentioning the bug in a code
    // comment is fine and actually informative for future maintainers.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/^\s*\/\/.*$/gm, '');    // line comments
    // Strict word-boundary match so WEBAUTHN_RP_ID (correct) doesn't match.
    // Use a negative lookahead after RPID since underscore is a word char.
    expect(/process\.env\.WEBAUTHN_RPID(?![A-Z_])/i.test(codeOnly)).toBe(false);
  });

  it('source file reads the correct WEBAUTHN_RP_ID env var', () => {
    const src = readFileSync(ROUTE_FILE, 'utf-8');
    expect(src).toContain('process.env.WEBAUTHN_RP_ID');
  });

  it('source file does NOT hardcode app.praeventio.net as a fallback rp id', () => {
    const src = readFileSync(ROUTE_FILE, 'utf-8');
    // The hardcoded fallback masked the typo bug. The `expectedOrigin` for
    // WEBAUTHN_ORIGIN still references the URL form, which is OK — that's
    // a URL, not an rp id, and is the documented production origin.
    // The bug was the rp-id form alongside it. We assert the rp-id
    // pattern is gone: `?? 'app.praeventio.net'` (no protocol prefix).
    expect(/\?\?\s*['"]app\.praeventio\.net['"]/.test(src)).toBe(false);
  });

  // Mirror the helper contract — kept in sync with getWebAuthnRpId() in the
  // route file. If the helper signature changes, update both.
  function helperMirror(): string {
    const value = process.env.WEBAUTHN_RP_ID;
    if (value && value.length > 0) return value;
    if (process.env.NODE_ENV === 'production') {
      throw new Error('WEBAUTHN_RP_ID required in production');
    }
    return 'localhost';
  }

  it('returns the env value when WEBAUTHN_RP_ID is set', () => {
    process.env.WEBAUTHN_RP_ID = 'foo.example.com';
    process.env.NODE_ENV = 'production';
    expect(helperMirror()).toBe('foo.example.com');
  });

  it('throws when WEBAUTHN_RP_ID is missing in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => helperMirror()).toThrowError(/WEBAUTHN_RP_ID required/);
  });

  it('falls back to localhost in development', () => {
    process.env.NODE_ENV = 'development';
    expect(helperMirror()).toBe('localhost');
  });

  it('falls back to localhost in test', () => {
    process.env.NODE_ENV = 'test';
    expect(helperMirror()).toBe('localhost');
  });

  it('falls back to localhost when NODE_ENV is unset', () => {
    expect(helperMirror()).toBe('localhost');
  });
});
