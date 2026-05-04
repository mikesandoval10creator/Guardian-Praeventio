import { test, expect } from '@playwright/test';

/**
 * Process lifecycle E2E (Sprint 16):
 *   StartProcessModal → process en estado "active" en Firestore →
 *   CloseProcessModal con preview de XP → confetti positivo →
 *   process en estado "completed" + XP otorgado a la cuadrilla.
 *
 * Es el flujo canónico end-to-end para validar la estructura orgánica
 * Proyecto → Cuadrilla → Procesos → Tareas. Skipea hasta tener
 * Firestore emulator + auth mock en CI.
 */
test.describe('Process lifecycle (start → close → XP)', () => {
  test.skip('TODO Sprint 19 — necesita Firestore emulator + crew seed', async ({ page }) => {
    // Plan:
    // 1. await loginAsTestUser(page, { roles: ['supervisor'] })
    // 2. await seedProject(page, { name: 'Constructora Test', crew: 'Cuadrilla Alfa' })
    // 3. await page.goto('/projects/:id/gantt')
    // 4. await page.getByRole('button', { name: /Iniciar proceso/i }).click()
    // 5. // StartProcessModal
    // 6. await page.getByLabel(/Tipo/i).selectOption('concreto')
    // 7. await page.getByLabel(/Nombre/i).fill('Hormigonado piso 3')
    // 8. await page.getByRole('button', { name: /Iniciar/i }).click()
    // 9. await expect(page.getByText(/Hormigonado piso 3/i)).toBeVisible()
    // 10. // Click el process bloque en Gantt
    // 11. await page.getByText(/Hormigonado piso 3/i).click()
    // 12. // ProcessDetailModal abre
    // 13. await page.getByRole('button', { name: /Cerrar proceso/i }).click()
    // 14. // CloseProcessModal con XP preview
    // 15. const xpPreview = await page.getByText(/\+\s*\d+\s*XP/i).innerText()
    // 16. expect(xpPreview).toMatch(/\+\s*\d+\s*XP/)
    // 17. await page.getByRole('button', { name: /Cerrar y celebrar/i }).click()
    // 18. // confetti dispara, modal cierra
    // 19. await expect(page.getByText(/proceso completado/i)).toBeVisible({ timeout: 5_000 })
    expect(true).toBe(true);
  });
});
