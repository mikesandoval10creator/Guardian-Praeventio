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
    await expect(heroHeading).toContainText(/5 minutos que pueden/i);
    await expect(heroHeading).toContainText(/salvar tu vida/i);
    // Subtitle (landing.hero.subtitle) — sí es un nodo único.
    await expect(page.getByText(/charla de 5 minutos/i)).toBeVisible();
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

  // 2026-07 Claude Design: the former Vida + Cómo-funciona sections are folded
  // into one dark "El Sistema" section with six vida-crítica cards.
  test('El Sistema — vida-crítica features visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/La victoria se gana antes de la batalla/i)).toBeVisible();
    await expect(page.getByText(/SOS y hombre-caído/i)).toBeVisible();
    await expect(page.getByText(/Red mesh sin señal/i)).toBeVisible();
  });

  test('El Sistema — IA, biometría and evidencia cards visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Inteligencia Artificial/i).first()).toBeVisible();
    await expect(page.getByText(/Biometr[ií]a 100% en el dispositivo/i)).toBeVisible();
    await expect(page.getByText(/Evidencia que no se borra/i)).toBeVisible();
  });

  test('pricing tiers grid renders the real tiers from tiers.ts', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/La vida no tiene precio/i)).toBeVisible();
    // Real tier names from src/services/pricing/tiers.ts (`nombre`). The 2026-07
    // design shows all seven: the free row + six metal cards.
    for (const name of ['Gratis', 'Cobre', 'Plata', 'Oro', 'Titanio', 'Platino', 'Diamante']) {
      await expect(page.getByText(new RegExp(name, 'i')).first()).toBeVisible();
    }
  });

  test('pricing shows the "Para tu dotación" recommended badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Para tu dotaci[oó]n/i)).toBeVisible();
  });

  test('pricing has the monthly/annual toggle and workers slider', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Mensual/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Anual/i })).toBeVisible();
    await expect(page.locator('#pv-workers')).toBeVisible();
  });

  test('footer has contact email + Santiago location', async ({ page }) => {
    await page.goto('/');
    await page.locator('footer, [role="contentinfo"]').first().scrollIntoViewIfNeeded();
    await expect(page.getByText(/contacto@praeventio\.net/i)).toBeVisible();
    await expect(page.getByText(/Santiago.*Chile/i)).toBeVisible();
  });

  test('CTA primary "Proteger a mi equipo" button is visible and clickable', async ({ page }) => {
    await page.goto('/');
    // El CTA primario del hero (landing.hero.cta_primary = "Proteger a mi equipo").
    const cta = page.getByRole('button', { name: /Proteger a mi equipo/i }).first();
    await expect(cta).toBeVisible();
    await expect(cta).toBeEnabled();
  });
});
