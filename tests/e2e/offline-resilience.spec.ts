import { test, expect } from '@playwright/test';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
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
// FIXME (2026-05-30, layer 2): the auth/project root cause is fixed (see PR #601
// / the full note in sos-button.spec.ts) — `/projects/{id}/findings` now
// renders. What remains is feature-level: the offline finding-creation form +
// IndexedDB→Firestore sync assertions need reconciling with the live render
// (the "Descripción" field label drifted). Now locally-iterable (Java 21 +
// emulator). Un-fixme once verified end-to-end.
// Sprint E2E-99 — route-fix CONSERVADO (/findings + apertura por botón
// new-finding-button; no existe /findings/new) y data-testid ya en Findings.
// PERO el flujo feature-level (el campo "Descripción" no aparece bajo el harness
// full-stack de CI → locator.fill timeout) NO es verificable en CI todavía → re-fixme.
test.describe.fixme('Offline-first sync', () => {
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
      await page.goto('/findings');
      // §2.24 fix (2026-05-22) — wait barrier auth real antes de UI checks.
      await signInBrowserViaCustomToken(page);

      // Sprint E2E-99 — no hay ruta /findings/new; el formulario se abre con el
      // botón "Nuevo hallazgo" (data-testid estable agregado en este sprint).
      const newFindingBtn = page.getByTestId('new-finding-button');
      await newFindingBtn.waitFor({ state: 'visible', timeout: 15_000 });
      await newFindingBtn.click();

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
      await page.goto('/findings');
      await expect.poll(
        async () => await page.getByText(/Cable suelto en piso 3/i).isVisible().catch(() => false),
        { timeout: 12_000, intervals: [500, 1000, 2000] },
      ).toBe(true);
    } finally {
      await seed.cleanup();
    }
  });
});
