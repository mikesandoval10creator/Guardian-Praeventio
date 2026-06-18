import { test, expect } from '@playwright/test';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Process lifecycle E2E (Sprint 16 → Sprint 19 unskip):
 *   StartProcessModal → process en estado "active" en Firestore →
 *   CloseProcessModal con preview de XP → confetti positivo →
 *   process en estado "completed" + XP otorgado a la cuadrilla.
 *
 * Es el flujo canónico end-to-end para validar la estructura orgánica
 * Proyecto → Cuadrilla → Procesos → Tareas. Requiere el stack completo
 * (Express + Firestore Emulator). Activar con `npm run test:e2e:full`
 * o `E2E_FULL_STACK=1 playwright test`.
 */
// FIXME (2026-05-30, layer 2): the auth/project root cause is fixed (see PR #601
// / the full note in sos-button.spec.ts) — `/projects/{id}/gantt` now renders.
// What remains is feature-level: the "Iniciar proceso" → close → XP-grant flow
// assertions need reconciling with the live render. Now locally-iterable
// (Java 21 + emulator). Un-fixme once verified end-to-end.
// Sprint E2E-99 — un-fixme: ruta corregida a /cuadrillas (StartProcessModal
// vive en CuadrillasDashboard; no existe /projects/:id/gantt).
test.describe('Process lifecycle (start → close → XP)', () => {
  test('iniciar y cerrar un proceso otorga XP a la cuadrilla', async ({ page }) => {
    test.skip(
      process.env.E2E_FULL_STACK !== '1',
      'Requires full E2E stack (preview + Express + Firestore Emulator). Run `npm run test:e2e:full`.',
    );

    await loginAsTestUser(page, { roles: ['supervisor'] });
    const seed = await seedProject({
      projectName: 'Constructora Test',
      crewName: 'Cuadrilla Alfa',
    });

    try {
      // Sprint 34 — robustness pass per audit P0 §1.4. Cada interacción
      // ahora tiene timeout explícito (default 5s era muy corto en el
      // emulador frío) y waitFor en los botones evita race conditions
      // con los listeners de Firestore que pintan el modal.
      await page.goto('/cuadrillas');
      // §2.24 fix (2026-05-22) — wait barrier auth real antes de UI checks.
      await signInBrowserViaCustomToken(page);

      const startBtn = page.getByRole('button', { name: /Iniciar proceso/i });
      await startBtn.waitFor({ state: 'visible', timeout: 15_000 });
      await startBtn.click();

      await page.getByLabel(/Tipo/i).selectOption('concreto');
      await page.getByLabel(/Nombre/i).fill('Hormigonado piso 3');
      await page.getByRole('button', { name: /^Iniciar/i }).click();

      const newProcess = page.getByText(/Hormigonado piso 3/i).first();
      await expect(newProcess).toBeVisible({ timeout: 10_000 });

      await newProcess.click();
      const closeBtn = page.getByRole('button', { name: /Cerrar proceso/i });
      await closeBtn.waitFor({ state: 'visible', timeout: 10_000 });
      await closeBtn.click();

      // expect.poll en lugar de innerText() one-shot: el preview de XP
      // se calcula async desde el cloud function y a veces tarda 1-2s.
      await expect.poll(
        async () => (await page.getByText(/\+\s*\d+\s*XP/i).innerText().catch(() => '')),
        { timeout: 8_000, intervals: [300, 500, 1000] },
      ).toMatch(/\+\s*\d+\s*XP/);

      await page.getByRole('button', { name: /Cerrar y celebrar/i }).click();
      await expect(page.getByText(/proceso completado/i)).toBeVisible({ timeout: 10_000 });
    } finally {
      await seed.cleanup();
    }
  });
});
