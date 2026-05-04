import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Offline resilience (PWA + IndexedDB) (Sprint 19 unskip):
 *   Crear hallazgo con red caída → IndexedDB queue → reconectar → sync
 *   a Firestore → hallazgo visible en feed.
 *
 * Este es el test más crítico para safety en faena: si la app pierde
 * datos cuando el supervisor está bajo tierra sin señal, traicionamos
 * el caso de uso. Requiere el stack completo (Express + Firestore
 * Emulator).
 */
test.describe('Offline-first sync', () => {
  test('hallazgo creado offline se sincroniza al recuperar la red', async ({ page, context }) => {
    test.skip(
      process.env.E2E_FULL_STACK !== '1',
      'Requires full E2E stack (preview + Express + Firestore Emulator). Run `npm run test:e2e:full`.',
    );

    await loginAsTestUser(page);
    const seed = await seedProject();

    try {
      await page.goto(`/projects/${seed.projectId}/findings/new`);

      await context.setOffline(true);

      await page.getByLabel(/Descripci[oó]n/i).fill('Cable suelto en piso 3');
      await page.getByRole('button', { name: /Guardar/i }).click();

      // Sin error y sin alerta: la app encola en IndexedDB.
      await expect(page.getByText(/Guardado para sincronizar/i)).toBeVisible();

      // Reconectar y dar tiempo al sync handler.
      await context.setOffline(false);
      await page.waitForTimeout(2_000);

      // El hallazgo debe haberse pushed al backend y aparecer en el feed.
      await page.goto(`/projects/${seed.projectId}/findings`);
      await expect(page.getByText(/Cable suelto en piso 3/i)).toBeVisible({ timeout: 10_000 });
    } finally {
      await seed.cleanup();
    }
  });
});
