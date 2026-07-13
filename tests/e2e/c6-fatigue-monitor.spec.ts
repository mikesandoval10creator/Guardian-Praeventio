import { test, expect } from '@playwright/test';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';

/**
 * C6 — FatigueMonitor is client-only BY DESIGN (DS 594 tracking stays on
 * device: no Firestore surface, sessions live in idb-keyval namespaced by
 * uid). The real-data assertion is therefore a UI-driven persistence round
 * trip: two preset clicks write REAL WorkSession entries to IndexedDB, and
 * the count SURVIVES a full page reload — something React state alone cannot
 * fake. The NIOSH/circadian engine stays unit-covered.
 *
 * Requires the full stack for suite consistency (auth fixture).
 */

test.describe('C6 — FatigueMonitor round-trip IndexedDB', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('los turnos registrados por UI sobreviven el reload (persistencia real en el dispositivo)', async ({ page }) => {
    await loginAsTestUser(page);
    await page.goto('/fatigue');
    await signInBrowserViaCustomToken(page);

    // Sessions are namespaced by ownerUid AT CLICK TIME. Under full-suite load
    // the auth context can resolve BETWEEN the two clicks, splitting the
    // sessions across the 'anonymous' and uid namespaces (count 1, flaky).
    // The page shows a role="note" banner only while !user — wait for it to
    // clear so both writes land in the SAME (authed) namespace.
    await expect(page.locator('main [role="note"]')).toHaveCount(0, { timeout: 15_000 });

    // Two real preset clicks → two WorkSession writes to idb-keyval.
    const preset = page.getByRole('button', { name: 'Nocturno 8h' });
    await expect(preset).toBeVisible({ timeout: 15_000 });
    await preset.click();
    await preset.click();

    const count = page.getByTestId('fatigue-session-count');
    await expect(count).toContainText('2', { timeout: 10_000 });

    // The un-fakeable leg: reload wipes React state; the count can only come
    // back from the REAL IndexedDB store. Same auth-settled barrier: the count
    // reads the uid namespace only once the user context resolves.
    await page.reload();
    await signInBrowserViaCustomToken(page);
    await expect(page.locator('main [role="note"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('fatigue-session-count')).toContainText('2', { timeout: 15_000 });
  });
});
