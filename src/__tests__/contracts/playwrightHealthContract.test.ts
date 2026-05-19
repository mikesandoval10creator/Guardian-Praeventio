// Praeventio Guard — Contract test #1: Playwright probes el endpoint
// real del backend (/api/health) y no la ruta histórica /health.
//
// Cierra hallazgo H2 del plan integrado 2026-05-17. Sin este test, una
// regresión silenciosa que vuelva a `/health` produce timeouts en CI
// sin causa visible.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = resolve(REPO_ROOT, 'playwright.config.ts');

describe('playwright health probe contract', () => {
  it('apunta a /api/health (no /health)', () => {
    expect(existsSync(CONFIG_PATH)).toBe(true);
    const content = readFileSync(CONFIG_PATH, 'utf8');
    expect(content).toContain('http://localhost:3000/api/health');
    expect(content).not.toMatch(/url:\s*['"]http:\/\/localhost:3000\/health['"]/);
  });
});
