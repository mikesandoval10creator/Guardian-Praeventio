import { test, expect } from '@playwright/test';
import { navigateAuthenticated } from './fixtures/navigation';

/**
 * Sprint A2 — Auditoría 5S tool mounted at /auditoria-5s.
 *
 * FiveSAuditForm is a self-contained tool: it computes the audit score
 * client-side via the REAL pure `buildFiveSAuditReport` engine (the fiveS route
 * is stateless compute — there is no persistence to fabricate). No Firestore /
 * ProjectContext dependency, so this is a RELIABLE UI E2E (no harness gap): it
 * drives the mounted UI and asserts the engine's real output.
 *
 * Gated by E2E_FULL_STACK=1 (the route lives behind the authed app shell).
 * Runs under locale es-CL (playwright.config) → level label is "Excelente".
 */
test.describe('Auditoría 5S tool', () => {
  test('computes the real 5S score from the checklist ratings', async ({ page }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');

    await navigateAuthenticated(page, '/auditoria-5s');
    await expect(page.getByTestId('auditoria-5s-page')).toBeVisible({ timeout: 15_000 });

    // Naming a zone reveals the audit form.
    await page.getByTestId('five-s-zone-input').fill('Bodega E2E');
    const form = page.getByTestId('five-s-audit-form');
    await expect(form).toBeVisible();

    // Rate every checklist item "Sí" (2) → all dimensions 100 → overall 100.
    const yes = page.locator('[data-testid^="five-s-rating-"][data-testid$="-2"]');
    const count = await yes.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) await yes.nth(i).click();

    await page.getByTestId('five-s-submit').click();

    // Real engine output rendered (100/100, level "Excelente" under es-CL).
    const score = page.getByTestId('five-s-result-score');
    await expect(score).toBeVisible({ timeout: 10_000 });
    await expect(score).toContainText('100/100');
    await expect(score).toContainText(/Excelente/i);
  });
});
