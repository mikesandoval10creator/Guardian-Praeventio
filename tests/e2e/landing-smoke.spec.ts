import { test, expect } from '@playwright/test';

/**
 * Sprint E2E-99 — Landing page smoke (sin auth).
 *
 * El test más barato: verifica que la landing pública renderiza sin crash.
 * NO necesita E2E_FULL_STACK — solo el preview server. Debe pasar en cada PR.
 * Si este test falla, la app está fundamentalmente rota (React no monta).
 */
test.describe('Landing page smoke (no auth)', () => {
  test('landing renders without error boundary', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    await expect(
      page.getByText(/Sistema Interrumpido|Error Boundary|Something went wrong/i),
    ).not.toBeVisible({ timeout: 5_000 });
    const body = page.locator('body');
    await expect(body).toBeVisible();
    await expect(body).toHaveText(/\S+/, { timeout: 10_000 });
  });

  test('landing has a heading', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
  });

  test('landing has navigation links', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    const nav = page.locator('nav, [role="navigation"]').first();
    await expect(nav).toBeVisible({ timeout: 10_000 });
  });
});
