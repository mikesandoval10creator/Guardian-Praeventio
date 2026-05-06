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
      // Sprint 34 — robustness pass per audit P0 §1.4 (continue-on-error
      // removed). Reemplazamos `waitForTimeout(2_000)` por una poll
      // explícita contra el feed: si el sync handler termina antes el
      // test corre rápido; si no, el poll espera hasta 12s con
      // intervalos exponenciales en lugar de un sleep ciego.
      await page.goto(`/projects/${seed.projectId}/findings/new`);

      await context.setOffline(true);

      await page.getByLabel(/Descripci[oó]n/i).fill('Cable suelto en piso 3');
      await page.getByRole('button', { name: /Guardar/i }).click();

      // Sin error y sin alerta: la app encola en IndexedDB.
      await expect(page.getByText(/Guardado para sincronizar/i)).toBeVisible({ timeout: 8_000 });

      // Reconectar — el sync handler dispara cuando el SW recibe el evento
      // `online`. No usamos waitForTimeout: pollearemos el feed.
      await context.setOffline(false);

      // El hallazgo debe haberse pushed al backend y aparecer en el feed.
      // expect.poll es robusto frente a la latencia variable del emulador
      // de Firestore (frío puede tardar 4-6s en confirmar el write).
      await page.goto(`/projects/${seed.projectId}/findings`);
      await expect.poll(
        async () => await page.getByText(/Cable suelto en piso 3/i).isVisible().catch(() => false),
        { timeout: 12_000, intervals: [500, 1000, 2000] },
      ).toBe(true);
    } finally {
      await seed.cleanup();
    }
  });
});
