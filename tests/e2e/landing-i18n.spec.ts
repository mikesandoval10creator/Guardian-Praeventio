import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Landing i18n parity guard (2026-05-30).
 *
 * The whole public landing — hero, nav AND the body (problem / features /
 * how / pricing / final-CTA / footer) — is now i18n'd. Before, only the hero
 * was translated while the body was hardcoded Spanish, so a non-Spanish
 * browser saw a MIXED render. This spec pins the browser to `en-US` (overriding
 * the suite-wide `es-CL`) and asserts the landing renders FULLY in English,
 * end to end, with zero Spanish leakage in any section.
 *
 * Same conditional skip as landing.spec.ts (TODO.md H20): runs only when
 * firebase-applet-config.json is present (CI injects it / local has it).
 */
const firebaseConfigExists = (() => {
  try {
    return fs.existsSync(path.join(process.cwd(), 'firebase-applet-config.json'));
  } catch {
    return false;
  }
})();

test.describe('Landing page — English locale (full i18n)', () => {
  // Override the suite-wide es-CL pin so the navigator-based language detector
  // (src/i18n/index.ts) resolves to English.
  test.use({
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });

  test.skip(
    !firebaseConfigExists,
    'firebase-applet-config.json missing — CI workflow must inject it before this suite can run (TODO.md H20)',
  );

  test('renders fully in English across every section', async ({ page }) => {
    await page.goto('/');

    // Hero — English brand phrase ("5 minutes that can save your life").
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/5 minutes that can/i);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/save your life/i);

    // Body sections that USED to be hardcoded Spanish — now English.
    await expect(page.getByText(/Why Guardian/i)).toBeVisible();
    await expect(page.getByText(/spreadsheets and paperwork/i)).toBeVisible();
    await expect(page.getByText(/Connects facts that today die/i)).toBeVisible();
    await expect(page.getByText(/SOS & man-down/i).first()).toBeVisible();
    await expect(page.getByText(/How it works/i).first()).toBeVisible();
    await expect(page.getByText(/Automatic compliance/i).first()).toBeVisible();
    await expect(page.getByText(/Plans for every company/i)).toBeVisible();
    await expect(page.getByText(/Made in Chile/i)).toBeVisible();

    // CTA button localized too (hero + close share the label — .first()).
    await expect(page.getByRole('button', { name: /Start free/i }).first()).toBeVisible();
  });

  test('has zero Spanish leakage in the body', async ({ page }) => {
    await page.goto('/');
    // Each of these was a hardcoded Spanish literal before the i18n pass; under
    // an English browser none of them must appear anywhere on the page.
    for (const spanish of [
      /Por qué Guardian/i,
      /hojas de cálculo y papeleo/i,
      /Cómo funciona/i,
      /Planes para cada empresa/i,
      /Respuesta a Emergencias/i,
      /Empieza hoy/i,
      /Prevención de riesgos en la palma/i,
      /Hecho en Chile/i,
    ]) {
      await expect(page.getByText(spanish)).toHaveCount(0);
    }
  });
});
