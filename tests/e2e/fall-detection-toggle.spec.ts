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

    await loginAsTestUser(page);
    await page.goto('/settings');
    await page.getByText(/Seguridad y Privacidad/i).click();

    const enable = page.getByRole('button', { name: /Activar detecci[oó]n de ca[ií]da/i });
    await expect(enable).toBeVisible();

    await enable.click();

    const disable = page.getByRole('button', { name: /Desactivar detecci[oó]n de ca[ií]da/i });
    await expect(disable).toBeVisible();

    // Reload — la preferencia debe sobrevivir gracias a idb-keyval.
    await page.reload();
    await page.getByText(/Seguridad y Privacidad/i).click();
    await expect(
      page.getByRole('button', { name: /Desactivar detecci[oó]n de ca[ií]da/i }),
    ).toBeVisible();
  });
});
