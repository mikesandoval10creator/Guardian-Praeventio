// Praeventio Guard — Contract test #3: release blockers (LICENSE,
// assetlinks SHA-256 real, Dockerfile sin firebase-applet-config,
// cloudbuild owner correcto).
//
// Cierra H3, H4, H6, H8 del plan integrado 2026-05-17.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

describe('release blockers', () => {
  it('LICENSE existe en raíz', () => {
    expect(existsSync(resolve(REPO_ROOT, 'LICENSE'))).toBe(true);
  });

  it('public/.well-known/assetlinks.json no contiene placeholders', () => {
    const path = resolve(REPO_ROOT, 'public', '.well-known', 'assetlinks.json');
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, 'utf8');
    expect(content).not.toContain('REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD');
    expect(content).not.toContain('REPLACE_WITH_');
  });

  it('cloudbuild.yaml apunta al repo correcto (no dahosandoval)', () => {
    const cb = read('cloudbuild.yaml');
    expect(cb).not.toContain('dahosandoval/Guardian-Praeventio');
  });

  it('Dockerfile no copia firebase-applet-config.json en la imagen', () => {
    const dockerfile = read('Dockerfile');
    expect(dockerfile).not.toMatch(/^COPY firebase-applet-config\.json/m);
  });

  it('Dockerfile.api no copia firebase-applet-config.json en la imagen', () => {
    const dockerfile = read('Dockerfile.api');
    expect(dockerfile).not.toMatch(/COPY .*firebase-applet-config\.json/m);
  });

  it('.dockerignore excluye firebase-applet-config.json', () => {
    const ignore = read('.dockerignore');
    expect(ignore).toContain('firebase-applet-config.json');
  });
});
