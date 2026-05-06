import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './fixtures/auth';

/**
 * FallDetection opt-in (Sprint 17b → Sprint 19 unskip):
 *   Default OFF en localStorage / IndexedDB. Toggle en Settings.
 *   Sin activación, el monitor no arranca. La preferencia persiste
 *   tras reload (idb-keyval).
 */
test.describe('FallDetection toggle preference', () => {
  test('toggle activa la detección y persiste tras reload', async ({ page }) => {
    test.skip(
      process.env.E2E_FULL_STACK !== '1',
      'Requires full E2E stack (preview + Express + Firestore Emulator). Run `npm run test:e2e:full`.',
    );

    // Sprint 34 — robustness pass per audit P0 §1.4 (continue-on-error
    // removed). Replaces implicit auto-waits with explicit `waitFor`
    // anchored on role+name so el spec falla rápido y claro si el
    // collapsable de Settings no expande, en vez de quedar flaky.
    await loginAsTestUser(page);
    await page.goto('/settings');

    const securitySection = page.getByText(/Seguridad y Privacidad/i).first();
    await securitySection.waitFor({ state: 'visible', timeout: 10_000 });
    await securitySection.click();

    const enable = page.getByRole('button', { name: /Activar detecci[oó]n de ca[ií]da/i });
    await enable.waitFor({ state: 'visible', timeout: 10_000 });

    await enable.click();

    const disable = page.getByRole('button', { name: /Desactivar detecci[oó]n de ca[ií]da/i });
    // El switch flip dispara un write a idb-keyval; expect.poll es más
    // robusto que un solo expect contra el race condition del aria-busy.
    await expect.poll(
      async () => disable.isVisible(),
      { timeout: 8_000, intervals: [200, 400, 800] },
    ).toBe(true);

    // Reload — la preferencia debe sobrevivir gracias a idb-keyval.
    await page.reload();
    const securitySection2 = page.getByText(/Seguridad y Privacidad/i).first();
    await securitySection2.waitFor({ state: 'visible', timeout: 10_000 });
    await securitySection2.click();
    await expect(
      page.getByRole('button', { name: /Desactivar detecci[oó]n de ca[ií]da/i }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
