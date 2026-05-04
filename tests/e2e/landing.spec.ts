import { test, expect } from '@playwright/test';

/**
 * Landing page smoke tests — la única superficie 100% pública (sin auth).
 * Estos son los tests más baratos y los que tienen que pasar SÍ o SÍ en
 * cada PR.
 */
test.describe('Landing page', () => {
  test('hero loads with brand identity', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Guardian Praeventio|Praeventio Guard/i);
    // Hero copy de praeventio.net (sincronizado en Sprint 16)
    await expect(page.getByText(/revoluci[oó]n de la prevenci[oó]n/i)).toBeVisible();
    await expect(page.getByText(/Gesti[oó]n de riesgos.*bienestar.*cumplimiento/i)).toBeVisible();
  });

  test('compliance badges row renders all 9', async ({ page }) => {
    await page.goto('/');
    // Badges: DS 54, DS 40, Ley 16.744, ISO 45001, OHSAS 18001, SUSESO, ISL, ACHS, IST
    const expected = ['DS 54', 'DS 40', 'Ley 16.744', 'ISO 45001', 'OHSAS 18001', 'SUSESO', 'ISL', 'ACHS', 'IST'];
    for (const badge of expected) {
      await expect(page.getByText(badge, { exact: false }).first()).toBeVisible();
    }
  });

  test('"Por qué Guardian" pain-point section visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Por qu[eé] Guardian/i)).toBeVisible();
    await expect(page.getByText(/hojas de c[aá]lculo y papeleo/i)).toBeVisible();
  });

  test('"Cómo funciona" 3-step flow visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/C[oó]mo funciona/i)).toBeVisible();
    await expect(page.getByText(/Registra/i).first()).toBeVisible();
    await expect(page.getByText(/IA analiza/i).first()).toBeVisible();
    await expect(page.getByText(/Cumplimiento autom[aá]tico/i).first()).toBeVisible();
  });

  test('pricing tiers card grid has 4 plans', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Planes para cada empresa/i)).toBeVisible();
    await expect(page.getByText(/Gratuito/i).first()).toBeVisible();
    await expect(page.getByText(/Comit[eé]/i).first()).toBeVisible();
    await expect(page.getByText(/Departamento/i).first()).toBeVisible();
    await expect(page.getByText(/Enterprise/i).first()).toBeVisible();
  });

  test('Departamento has RECOMENDADO pill (gold)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/RECOMENDADO/i)).toBeVisible();
  });

  test('Comité has POPULAR pill (teal)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/POPULAR/i)).toBeVisible();
  });

  test('footer has contact email + Santiago location', async ({ page }) => {
    await page.goto('/');
    await page.locator('footer, [role="contentinfo"]').first().scrollIntoViewIfNeeded();
    await expect(page.getByText(/contacto@praeventio\.net/i)).toBeVisible();
    await expect(page.getByText(/Santiago.*Chile/i)).toBeVisible();
  });

  test('CTA "ENTRAR" button is visible and clickable', async ({ page }) => {
    await page.goto('/');
    const cta = page.getByRole('button', { name: /ENTRAR/i }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
  });
});
