import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './fixtures/auth';
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
      await page.goto(`/projects/${seed.projectId}/gantt`);

      await page.getByRole('button', { name: /Iniciar proceso/i }).click();
      await page.getByLabel(/Tipo/i).selectOption('concreto');
      await page.getByLabel(/Nombre/i).fill('Hormigonado piso 3');
      await page.getByRole('button', { name: /^Iniciar/i }).click();
      await expect(page.getByText(/Hormigonado piso 3/i)).toBeVisible();

      await page.getByText(/Hormigonado piso 3/i).click();
      await page.getByRole('button', { name: /Cerrar proceso/i }).click();

      const xpPreview = await page.getByText(/\+\s*\d+\s*XP/i).innerText();
      expect(xpPreview).toMatch(/\+\s*\d+\s*XP/);

      await page.getByRole('button', { name: /Cerrar y celebrar/i }).click();
      await expect(page.getByText(/proceso completado/i)).toBeVisible({ timeout: 5_000 });
    } finally {
      await seed.cleanup();
    }
  });
});
