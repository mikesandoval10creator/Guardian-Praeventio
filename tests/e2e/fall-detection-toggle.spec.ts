import { test, expect } from '@playwright/test';

/**
 * FallDetection opt-in (Sprint 17b):
 *   Default OFF en localStorage / IndexedDB. Toggle en Settings.
 *   Sin activación, el monitor no arranca.
 */
test.describe('FallDetection toggle preference', () => {
  test.skip('TODO Sprint 19 — needs auth fixture', async ({ page }) => {
    // Plan:
    // 1. loginAsTestUser
    // 2. await page.goto('/settings')
    // 3. await page.getByText(/Seguridad y Privacidad/i).click()
    // 4. // Toggle empieza apagado
    // 5. const toggle = page.getByRole('button', { name: /Activar detecci[oó]n de ca[ií]da/i })
    // 6. await expect(toggle).toBeVisible()
    // 7. // Click activa
    // 8. await toggle.click()
    // 9. await expect(page.getByRole('button', { name: /Desactivar detecci[oó]n de ca[ií]da/i })).toBeVisible()
    // 10. // Reload, persistencia idb-keyval
    // 11. await page.reload()
    // 12. await expect(page.getByRole('button', { name: /Desactivar detecci[oó]n de ca[ií]da/i })).toBeVisible()
    expect(true).toBe(true);
  });
});
