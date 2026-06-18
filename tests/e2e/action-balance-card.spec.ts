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

  // FIXME (harness gap): asserting the balance card with REAL actions needs the
  // corrective-actions API (Express :3000) to see the project seeded by the
  // test's admin SDK AND ProjectContext to select it — the same cross-process
  // Firestore-visibility gap that fixme'd the compliance + SOS specs. The card's
  // render/balance logic is already covered by ActionBalanceCard.test.tsx.
  // Un-fixme once the harness shares one emulator project across processes.
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
