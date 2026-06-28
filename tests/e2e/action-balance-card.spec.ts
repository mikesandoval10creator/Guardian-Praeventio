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

  // FIXME (distinct harness gap — narrowed 2026-06-27): the projectId/namespace
  // gap is FIXED (server honors GOOGLE_CLOUD_PROJECT under the emulator) and the
  // browser auth-ready path works under `--mode test` — the sibling specs +
  // "mounts authenticated" test above now pass green. The REMAINING blocker here
  // is client-side: ProjectContext must SELECT the seeded project (the seed only
  // creates the project doc; navigateAuthenticated signs the user in but never
  // sets an active project), and the card needs seeded corrective_actions to
  // render. Without a selected project the page mounts in its empty state, so
  // `action-balance-card` never appears. Card render/balance math is covered by
  // ActionBalanceCard.test.tsx. Un-fixme once the E2E harness selects a project
  // client-side (and seeds corrective actions).
  test.fixme('renders the ISO 45001 action-balance card with real actions', async ({ page }) => {
    test.skip(process.env.E2E_FULL_STACK !== '1', 'Requires full E2E stack. Run `npm run test:e2e:full`.');
    const seed = await seedProject();
    try {
      await navigateAuthenticated(page, '/corrective-actions');
      const card = page.getByTestId('action-balance-card');
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('action-balance-bars')).toBeVisible();
    } finally {
      await seed.cleanup();
    }
  });
});
