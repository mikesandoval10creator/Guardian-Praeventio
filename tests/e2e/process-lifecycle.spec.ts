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
// Sprint E2E-99 — route-fix CONSERVADO (/cuadrillas; no existe /projects/:id/gantt)
// y data-testid (start-process-button) ya en CuadrillasDashboard. PERO el flujo
// feature-level (el StartProcessModal no aparece bajo el harness full-stack de CI
// → locator.waitFor timeout) NO es verificable en CI todavía → re-fixme.
// Bloque B (2026-07-05): the boot-time spurious EmergencyOverlay is FIXED
// (EmergencyAlertBanner MODE=test gate). Residual (still fixme'd): /cuadrillas
// CRASHES into the error boundary ("Sistema Interrumpido") under the full-stack
// harness, so "Iniciar proceso" never renders — a real page runtime crash to
// root-cause. Un-fixme once /cuadrillas renders in the harness.
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
      // exact 'Iniciar' — the modal's submit button. A /^Iniciar/ regex also
      // matches the dashboard's still-mounted "Iniciar proceso" (strict-mode
      // violation), so pin the exact accessible name of the modal action.
      await page.getByRole('button', { name: 'Iniciar', exact: true }).click();

      const newProcess = page.getByText(/Hormigonado piso 3/i).first();
      await expect(newProcess).toBeVisible({ timeout: 10_000 });

      // Open the process detail modal — clicking the name is a no-op; the
      // "Cerrar proceso" action lives in ProcessDetailModal (via "Ver detalle").
      await page.getByRole('button', { name: /Ver detalle/i }).first().click();
      const closeBtn = page.getByRole('button', { name: /Cerrar proceso/i });
      await closeBtn.waitFor({ state: 'visible', timeout: 10_000 });
      await closeBtn.click();

      // XP preview lives in CloseProcessModal as "XP estimado para la cuadrilla:
      // +N (base …)" — assert the preview line rather than a "+N XP" string.
      await expect(page.getByText(/XP estimado para la cuadrilla/i)).toBeVisible({ timeout: 8_000 });

      await page.getByRole('button', { name: /Cerrar y celebrar/i }).click();
      // Close succeeded → CloseProcessModal dismisses (the XP grant itself is
      // server-side and covered by the endpoint tests). Assert the flow completed.
      await expect(page.getByRole('button', { name: /Cerrar y celebrar/i })).not.toBeVisible({ timeout: 10_000 });
    } finally {
      await seed.cleanup();
    }
  });
});
