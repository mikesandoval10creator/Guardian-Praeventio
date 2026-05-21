// Contract test — Fase B.3 del plan integrado (verificación 2026-05-21).
//
// Verifica que playwright.config.ts apunte al endpoint REAL del backend
// (`/api/health`). Origen: hallazgo H2 del plan (probe E2E desalineado).
// Si alguien vuelve a poner `/health` (sin prefijo `/api`), este test
// rompe el build antes de que llegue a CI.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('playwright.config.ts — health probe contract (H2)', () => {
  const cfg = readFileSync(
    resolve(process.cwd(), 'playwright.config.ts'),
    'utf8',
  );

  it('apunta a /api/health (no /health) en al menos un webServer', () => {
    // El config tiene 2 modos (default + E2E_FULL_STACK). Al menos uno
    // debe declarar el endpoint real del backend Express.
    expect(cfg).toMatch(/url:\s*['"]http:\/\/localhost:3000\/api\/health['"]/);
  });

  it('no usa el endpoint legacy /health sin prefijo /api', () => {
    // Patrón prohibido — captura la regresión histórica.
    expect(cfg).not.toMatch(/url:\s*['"]http:\/\/localhost:3000\/health['"]/);
  });
});
