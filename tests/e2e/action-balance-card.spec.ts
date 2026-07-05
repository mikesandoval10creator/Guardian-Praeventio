import { test, expect } from '@playwright/test';
import { navigateAuthenticated } from './fixtures/navigation';
import { seedProject } from './fixtures/seed';

/**
 * Sprint A1 — ActionBalanceCard mounted in the CorrectiveActions page.
 *
 * The card is a pure widget (`buildBalanceReport` over the real corrective
 * actions the page already fetches via useCorrectiveActions). Its render +
 * ISO 45001 hierarchy math are covered by ActionBalanceCard.test.tsx and
 * weakActionDetector tests; this spec covers the page-level wire.
 *
 * Gated by E2E_FULL_STACK=1 (auth emulator + Firestore + Express).
 */
test.describe('Corrective actions — action balance card', () => {
  test('corrective-actions page mounts authenticated without crashing', async ({ page }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');
    const seed = await seedProject();
    try {
      await navigateAuthenticated(page, '/corrective-actions');
      // No global error boundary.
      await expect(
        page.getByText(/Sistema Interrumpido|Error Boundary|Something went wrong/i),
      ).not.toBeVisible({ timeout: 5_000 });
      // The page mounts in one of its valid states (loaded or no-project empty).
      const loaded = page.getByTestId('corrective-actions-page');
      const empty = page.getByTestId('corrective-actions-page-empty');
      await expect(loaded.or(empty)).toBeVisible({ timeout: 15_000 });
    } finally {
      await seed.cleanup();
    }
  });

  // Re-enabled (Bloque A, 2026-07-05): the seeded project DOES auto-select
  // client-side (the firestore.rules read→get/list split at firestore.rules:395
  // was already in place). The prior flake was pure latency — ProjectContext's
  // `projects` snapshot can take >15s under a cold Firestore emulator with
  // parallel workers, overrunning the old 15s card-visibility timeout. Fixed by
  // waiting on the loaded (project-selected) gate with headroom first.
  test('renders the ISO 45001 action-balance card with real actions', async ({ page }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');
    const seed = await seedProject();
    try {
      await navigateAuthenticated(page, '/corrective-actions');
      // Wait for the loaded (project-selected) state before asserting the card —
      // the client `projects` snapshot is the slow step under a cold emulator.
      await expect(page.getByTestId('corrective-actions-page')).toBeVisible({ timeout: 30_000 });
      const card = page.getByTestId('action-balance-card');
      await expect(card).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('action-balance-bars')).toBeVisible();
    } finally {
      await seed.cleanup();
    }
  });
});
