import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Landing page smoke tests — la única superficie 100% pública (sin auth).
 * Estos son los tests más baratos y los que tienen que pasar SÍ o SÍ en
 * cada PR.
 *
 * TODO.md H20 (reactivado 2026-05-19): el suite estaba con `.skip` global
 * por miedo a flaky CI sin firebase-applet-config.json. Ahora hacemos
 * skip CONDICIONAL: si el archivo existe (localmente o tras inject CI),
 * corre. Si no, deja un skip claro como pendiente del workflow.
 */
const firebaseConfigExists = (() => {
  try {
    return fs.existsSync(path.join(process.cwd(), 'firebase-applet-config.json'));
  } catch {
    return false;
  }
})();

test.describe('Landing page', () => {
  test.skip(
    !firebaseConfigExists,
    'firebase-applet-config.json missing — CI workflow must inject it before this suite can run (TODO.md H20)',
  );

  test('hero loads with brand identity', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Guardian Praeventio|Praeventio Guard/i);
    // Hero headline (landing.hero.title_line_1 + title_line_2) se renderiza
    // partido por <br/> + <span>, así que aseveramos contra el <h1> completo
    // con toContainText en vez de buscar un nodo de texto contiguo.
    const heroHeading = page.getByRole('heading', { level: 1 });
    await expect(heroHeading).toContainText(/revoluci[oó]n de la/i);
    await expect(heroHeading).toContainText(/prevenci[oó]n de riesgos/i);
    // Subtitle (landing.hero.subtitle) — sí es un nodo único.
    await expect(page.getByText(/Gesti[oó]n de riesgos.*bienestar.*cumplimiento/i)).toBeVisible();
  });

  test('compliance badges row renders all 7', async ({ page }) => {
    await page.goto('/');
    // Mirrors COMPLIANCE_BADGES in src/pages/LandingPage.tsx (#1164): DS 54 was
    // dropped (derogated by DS 44/2024) and OHSAS 18001 was dropped as a
    // compliance badge (superseded by ISO 45001). (OHSAS may still appear
    // elsewhere as historical/educational content — not asserted here.)
    const expected = ['DS 44/2024', 'Ley 16.744', 'ISO 45001', 'SUSESO', 'ISL', 'ACHS', 'IST'];
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
    // Real tier names from src/services/pricing/tiers.ts (the `nombre` field),
    // NOT the old fake plans. The 4 landing cards map to gratis/cobre/plata/oro.
    await expect(page.getByText(/Gratis/i).first()).toBeVisible();
    await expect(page.getByText(/Cobre/i).first()).toBeVisible();
    await expect(page.getByText(/Plata/i).first()).toBeVisible();
    await expect(page.getByText(/Oro/i).first()).toBeVisible();
  });

  test('Oro has RECOMENDADO pill (gold)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/RECOMENDADO/i)).toBeVisible();
  });

  test('Plata has POPULAR pill (teal)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/POPULAR/i)).toBeVisible();
  });

  test('footer has contact email + Santiago location', async ({ page }) => {
    await page.goto('/');
    await page.locator('footer, [role="contentinfo"]').first().scrollIntoViewIfNeeded();
    await expect(page.getByText(/contacto@praeventio\.net/i)).toBeVisible();
    await expect(page.getByText(/Santiago.*Chile/i)).toBeVisible();
  });

  test('CTA primary "Entrar a la app" button is visible and clickable', async ({ page }) => {
    await page.goto('/');
    // El CTA primario del hero (landing.hero.cta_primary = "Entrar a la app").
    // El locator viejo /ENTRAR/i + .first() agarraba el botón de la barra nav
    // (primero en el DOM), frágil ante visibilidad responsive — apuntamos al
    // botón primario del hero, que es el verdadero call-to-action.
    const cta = page.getByRole('button', { name: /Entrar a la app/i });
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
  });
});
