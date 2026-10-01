// Praeventio Guard — Contract test #4: configuración Sentry alineada
// con el perfil privacy-first explícito para Sentry v11 y `redactPii` como
// backstop en beforeSend.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SENTRY_PATH = resolve(REPO_ROOT, 'src', 'lib', 'sentry.ts');

describe('Sentry configuration contract', () => {
  it('src/lib/sentry.ts existe', () => {
    expect(existsSync(SENTRY_PATH)).toBe(true);
  });

  it('uses the explicit Sentry v11 dataCollection privacy profile, not the removed option', () => {
    const src = readFileSync(SENTRY_PATH, 'utf8');
    expect(src).toMatch(/^\s+dataCollection:\s*createSentryV10PrivacyDataCollection\(\),/m);
    expect(src).not.toMatch(/^\s+sendDefaultPii:\s*(?:true|false)\s*,?\s*$/m);
  });

  it('redactPii sigue siendo backstop en beforeSend', () => {
    const src = readFileSync(SENTRY_PATH, 'utf8');
    expect(src).toMatch(/beforeSend/);
    expect(src).toContain('redactPii');
  });
});
