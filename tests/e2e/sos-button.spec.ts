import { test, expect } from '@playwright/test';

/**
 * SOSButton E2E (Sprint 14):
 *   3-second long-press → write a la collection emergency_alerts +
 *   FCM notify supervisores. NO debe disparar con tap corto.
 *
 * Mockea Firestore + FCM via fixtures. Skipea hasta tener fixtures
 * setup en Sprint 19.
 */
test.describe('SOSButton long-press', () => {
  test.skip('TODO Sprint 19 — needs auth fixture + Firestore mock', async ({ page }) => {
    // Plan:
    // 1. await loginAsTestUser(page)
    // 2. await switchToEmergencyMode(page)
    // 3. const sos = page.getByRole('button', { name: /^SOS$/i })
    // 4. // Tap corto NO debe disparar
    // 5. await sos.click({ delay: 200 })
    // 6. await expect(page.getByText(/Alerta enviada/i)).not.toBeVisible({ timeout: 1500 })
    // 7. // Long-press 3s SÍ dispara
    // 8. const box = await sos.boundingBox()
    // 9. await page.mouse.down(box.x + 10, box.y + 10)
    // 10. await page.waitForTimeout(3200)
    // 11. await page.mouse.up()
    // 12. await expect(page.getByText(/Alerta enviada/i)).toBeVisible({ timeout: 5_000 })
    expect(true).toBe(true);
  });

  test.skip('TODO Sprint 19 — fallback tel: si geo bloqueado', async () => {
    // Verificar que cuando geolocation deniega, llega a tel: project.phone.
    expect(true).toBe(true);
  });
});
