import { test, expect } from '@playwright/test';
import { navigateAuthenticated } from './fixtures/navigation';
import { seedProject } from './fixtures/seed';

/**
 * Sprint E2E-99 — Smoke tests de páginas autenticadas críticas.
 *
 * Tests MÍNIMOS: verifican que la página MONTA sin crash. NO testean flujos
 * completos (eso son specs por dominio) ni copy específico (eso es frágil: la
 * redacción de cada página deriva con i18n/diseño). El objetivo es atrapar
 * REGRESIONES de render: si una página empieza a tirar error boundary o queda
 * en blanco, este test rompe el build.
 *
 * Estrategia robusta (web-first, anti-brittle): login → navegar → NO hay error
 * boundary → el body tiene contenido (no quedó en blanco). Es el mismo patrón
 * que landing-smoke.spec.ts. Gated por E2E_FULL_STACK=1 (auth emulator + Firestore).
 */
const PROJECT_PAGES = [
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/emergency', name: 'Emergency' },
  { path: '/findings', name: 'Findings' },
  { path: '/documents', name: 'Documents' },
  { path: '/calendar', name: 'Calendar' },
  { path: '/settings', name: 'Settings' },
  { path: '/analytics', name: 'Analytics' },
  { path: '/corrective-actions', name: 'Corrective Actions' },
  { path: '/cuadrillas', name: 'Cuadrillas' },
  { path: '/driving', name: 'Driving' },
  { path: '/comite-paritario', name: 'CPHS' },
  // C6 — protocol pages get mount-smoke here; their real form→engine→score
  // flows are Bloque C5's dedicated specs (protocolo-tmert/prexor, ceal-sm).
  { path: '/tmert', name: 'TMERT' },
  { path: '/prexor', name: 'PREXOR' },
  { path: '/ceal-sm', name: 'CEAL-SM Campaigns' },
  { path: '/planesi', name: 'PLANESI' },
];

const NO_PROJECT_PAGES = [
  { path: '/accessibility', name: 'Accessibility' },
];

const ERROR_BOUNDARY = /Sistema Interrumpido|Error Boundary|Something went wrong/i;

async function expectPageMounts(page: import('@playwright/test').Page): Promise<void> {
  // 1) No crashed into the global error boundary.
  await expect(page.getByText(ERROR_BOUNDARY)).not.toBeVisible({ timeout: 5_000 });
  // 2) The page rendered actual content (caught white-screen / failed mount).
  await expect(page.locator('body')).toHaveText(/\S/, { timeout: 15_000 });
}

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
        await expectPageMounts(page);
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
      await expectPageMounts(page);
    });
  }
});
