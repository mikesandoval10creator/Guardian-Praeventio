// Praeventio Guard — Contract test #4: configuración Sentry alineada
// con la directiva 2026-05-17 (sendDefaultPii: true + redactPii como
// backstop en beforeSend).

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SENTRY_PATH = resolve(REPO_ROOT, 'src', 'lib', 'sentry.ts');

describe('Sentry configuration contract', () => {
  it('src/lib/sentry.ts existe', () => {
    expect(existsSync(SENTRY_PATH)).toBe(true);
  });

  it('sendDefaultPii está habilitado (directiva usuario 2026-05-17)', () => {
    const src = readFileSync(SENTRY_PATH, 'utf8');
    expect(src).toContain('sendDefaultPii: true');
  });

  it('redactPii sigue siendo backstop en beforeSend', () => {
    const src = readFileSync(SENTRY_PATH, 'utf8');
    expect(src).toMatch(/beforeSend/);
    expect(src).toContain('redactPii');
  });
});
