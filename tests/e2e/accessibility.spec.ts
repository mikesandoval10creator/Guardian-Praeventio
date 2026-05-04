import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Sprint 20 Fase 6 — A11y baseline en E2E con axe-core.
 *
 * Estrategia:
 *   1. Cargamos la landing pública (`/`) — única superficie sin auth.
 *   2. Corremos `axe.analyze()` con tags WCAG 2.1 A + AA.
 *   3. Aserto duro: cero violations `serious` ni `critical`. Si aparece
 *      una nueva violación de ese nivel, el test rompe el build (es la
 *      única forma de gatear regresiones de a11y antes de prod).
 *   4. Soft-log de violations `minor`/`moderate` para que el equipo las
 *      vea en el reporte sin bloquear el merge — son backlog, no gate.
 *
 * Gateado por `E2E_FULL_STACK=1` igual que los specs Sprint 19, porque
 * la landing depende del bundle Firebase (sin VITE_FIREBASE_* el app
 * monta ErrorBoundary "Sistema Interrumpido"). Cuando CI inyecte
 * secrets de un proyecto Firebase de test, podemos quitar el gate.
 *
 * Licencia axe-core MPL-2.0 — uso solo en tests, no se bundlea a prod.
 */
test.describe('Accessibility (axe-core)', () => {
  test('landing page has no serious/critical a11y violations', async ({ page }, testInfo) => {
    test.skip(
      process.env.E2E_FULL_STACK !== '1',
      'Requires full E2E stack (preview server). Run `npm run test:e2e:full`.',
    );

    await page.goto('/');
    // Esperar a que React monte el hero — sin esto axe puede correr sobre
    // un DOM en mid-render y reportar fantasmas.
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    const minor = results.violations.filter(
      (v) => v.impact === 'minor' || v.impact === 'moderate',
    );

    if (minor.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[a11y] ${minor.length} minor/moderate violations on /:`,
        minor.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
      );
      // Adjuntamos el detalle al reporte HTML de Playwright para triaging.
      await testInfo.attach('axe-minor-violations.json', {
        body: JSON.stringify(minor, null, 2),
        contentType: 'application/json',
      });
    }

    if (blocking.length > 0) {
      // eslint-disable-next-line no-console
      console.error(
        `[a11y] BLOCKING violations on /:`,
        blocking.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length })),
      );
      await testInfo.attach('axe-blocking-violations.json', {
        body: JSON.stringify(blocking, null, 2),
        contentType: 'application/json',
      });
    }

    expect(blocking, `serious/critical a11y violations: ${blocking.map((v) => v.id).join(', ')}`).toHaveLength(0);
  });

  test('landing page exposes a main landmark and a top-level heading', async ({ page }) => {
    test.skip(
      process.env.E2E_FULL_STACK !== '1',
      'Requires full E2E stack (preview server). Run `npm run test:e2e:full`.',
    );

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Estos son requisitos mínimos de WCAG 2.1: landmark `main` y `h1`
    // por documento. axe ya los chequea, pero los aislamos en un test
    // dedicado para que la falla sea legible si se rompe.
    const main = page.locator('main, [role="main"]').first();
    await expect(main).toHaveCount(1);

    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();
  });
});
