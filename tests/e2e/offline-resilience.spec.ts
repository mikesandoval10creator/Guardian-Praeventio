import { test, expect } from '@playwright/test';

/**
 * Offline resilience (PWA + IndexedDB):
 *   Crear hallazgo / proceso con red caída → IndexedDB queue →
 *   reconectar → sync a Firestore → action visible en feed.
 *
 * Este es el test más crítico para safety en faena: si la app pierde
 * datos cuando el supervisor está bajo tierra sin señal, la app
 * traiciona el caso de uso. Skipea hasta tener fixtures.
 */
test.describe('Offline-first sync', () => {
  test.skip('TODO Sprint 19 — needs auth + offline simulation', async ({ page, context }) => {
    // Plan:
    // 1. loginAsTestUser
    // 2. await context.setOffline(true)
    // 3. await page.goto('/findings/new')
    // 4. await page.getByLabel(/Descripci[oó]n/i).fill('Cable suelto en piso 3')
    // 5. await page.getByRole('button', { name: /Guardar/i }).click()
    // 6. // No alert ni error: queda en queue
    // 7. await expect(page.getByText(/Guardado para sincronizar/i)).toBeVisible()
    // 8. // Reconnect
    // 9. await context.setOffline(false)
    // 10. await page.waitForTimeout(2000)
    // 11. // Sync handler debe haber pusheado a Firestore
    // 12. await page.goto('/findings')
    // 13. await expect(page.getByText(/Cable suelto en piso 3/i)).toBeVisible()
    expect(true).toBe(true);
  });
});
