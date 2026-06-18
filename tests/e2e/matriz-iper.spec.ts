import { test, expect } from '@playwright/test';
import { navigateAuthenticated } from './fixtures/navigation';

/**
 * Sprint A2 — Matriz IPER 5x5 tool mounted at /matriz-iper.
 *
 * IperMatrixCard is a self-contained tool: it computes risk client-side via the
 * REAL pure `calculateIper` engine (rawScore = probability × severity), with no
 * Firestore / ProjectContext dependency. That makes this a RELIABLE UI E2E (no
 * harness cross-process gap) — it drives the mounted UI and asserts the engine's
 * real output, not a fabricated value.
 *
 * Gated by E2E_FULL_STACK=1 (the route lives behind the authed app shell).
 */
test.describe('Matriz IPER 5x5 tool', () => {
  test('computes the real risk score from probability × severity', async ({ page }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');

    await navigateAuthenticated(page, '/matriz-iper');

    const card = page.getByTestId('iper-matrix-card');
    await expect(card).toBeVisible({ timeout: 15_000 });

    // Default 3 × 3 → rawScore 9 (real calculateIper engine).
    await expect(page.getByTestId('iper-score')).toHaveText('9');

    // 5 × 5 → 25 — the engine recomputes client-side on input change.
    await page.getByTestId('iper-probability').selectOption('5');
    await page.getByTestId('iper-severity').selectOption('5');
    await expect(page.getByTestId('iper-score')).toHaveText('25');

    // 1 × 1 → 1 (lowest).
    await page.getByTestId('iper-probability').selectOption('1');
    await page.getByTestId('iper-severity').selectOption('1');
    await expect(page.getByTestId('iper-score')).toHaveText('1');
  });
});
