import { test, expect } from '@playwright/test';
import { navigateAuthenticated } from './fixtures/navigation';
import { seedProject } from './fixtures/seed';

/**
 * Sprint E2E-99 — Smoke tests de páginas autenticadas críticas.
 *
 * Tests MÍNIMOS: verifican que la página renderiza sin crash y muestra el
 * contenido esperado. NO testean flujos completos (eso son specs por dominio).
 * El objetivo es atrapar REGRESIONES de render: si una página empieza a tirar
 * error o queda en blanco, este test rompe el build.
 *
 * Estrategia: login → navegar → no error boundary → contenido específico visible.
 * Gated por E2E_FULL_STACK=1 (necesita auth emulator + Firestore).
 */
const PROJECT_PAGES = [
  { path: '/dashboard', name: 'Dashboard', content: /panel|dashboard|proyecto|resumen/i },
  { path: '/emergency', name: 'Emergency', content: /emergencia|emergency|SOS/i },
  { path: '/findings', name: 'Findings', content: /hallazgo|finding/i },
  { path: '/documents', name: 'Documents', content: /documento|document/i },
  { path: '/calendar', name: 'Calendar', content: /calendario|calendar|agenda/i },
  { path: '/settings', name: 'Settings', content: /configuraci|setting|ajuste/i },
  { path: '/analytics', name: 'Analytics', content: /anal[ií]tic|analytics|dashboard/i },
  { path: '/corrective-actions', name: 'Corrective Actions', content: /correctiv|acci[oó]n|action/i },
  { path: '/cuadrillas', name: 'Cuadrillas', content: /cuadrilla|crew|equipo/i },
  { path: '/driving', name: 'Driving', content: /conducci|driving|veh[ií]culo/i },
  { path: '/comite-paritario', name: 'CPHS', content: /comit[eé]|paritario|cphs/i },
];

const NO_PROJECT_PAGES = [
  { path: '/accessibility', name: 'Accessibility', content: /accesibil|accessibility/i },
];

test.describe('Smoke — authenticated pages render without crash', () => {
  for (const p of PROJECT_PAGES) {
    test(`${p.name} (${p.path}) renders`, async ({ page }) => {
      test.skip(
        process.env.E2E_FULL_STACK !== '1',
        'Requires full E2E stack. Run `npm run test:e2e:full`.',
      );
      const seed = await seedProject();
      try {
        await navigateAuthenticated(page, p.path);
        await expect(
          page.getByText(/Sistema Interrumpido|Error Boundary|Something went wrong/i),
        ).not.toBeVisible({ timeout: 5_000 });
        await expect(page.locator('body')).toHaveText(p.content, { timeout: 15_000 });
      } finally {
        await seed.cleanup();
      }
    });
  }

  for (const p of NO_PROJECT_PAGES) {
    test(`${p.name} (${p.path}) renders`, async ({ page }) => {
      test.skip(
        process.env.E2E_FULL_STACK !== '1',
        'Requires full E2E stack. Run `npm run test:e2e:full`.',
      );
      await navigateAuthenticated(page, p.path);
      await expect(
        page.getByText(/Sistema Interrumpido|Error Boundary|Something went wrong/i),
      ).not.toBeVisible({ timeout: 5_000 });
      await expect(page.locator('body')).toHaveText(p.content, { timeout: 15_000 });
    });
  }
});
