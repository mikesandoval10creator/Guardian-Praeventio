import { test, expect } from '@playwright/test';
import { navigateAuthenticated } from './fixtures/navigation';
import { seedProject } from './fixtures/seed';

/**
 * Sprint A1 — compliance traffic light mounted in the Dashboard header.
 *
 * End-to-end against the REAL stack: the widget only renders once
 * GET /api/compliance/:projectId/traffic-light returns a server-computed
 * snapshot (real legal engine, no fabricated data). This verifies the full
 * wire: auth → project membership → engine → coverage-aware view → mount.
 *
 * Gated by E2E_FULL_STACK=1 (needs auth emulator + Firestore + Express).
 */
test.describe('Compliance traffic light (Dashboard)', () => {
  test('dashboard header renders the real compliance traffic light', async ({ page }) => {
    test.skip(
      process.env.E2E_FULL_STACK !== '1',
      'Requires full E2E stack. Run `npm run test:e2e:full`.',
    );
    const seed = await seedProject();
    try {
      await navigateAuthenticated(page, '/dashboard');

      const widget = page.getByTestId('compliance-traffic-light');
      await expect(widget).toBeVisible({ timeout: 15_000 });

      // Compact badge shows the real compliance label (i18n), never a
      // fabricated number on its own.
      await expect(widget).toContainText(/Cumplimiento|Compliance|Conformidade/i);
    } finally {
      await seed.cleanup();
    }
  });
});
