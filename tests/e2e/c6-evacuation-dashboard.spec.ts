import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * C6 — EvacuationDashboard renders REAL seeded data: an ACTIVE drill under
 * `tenants/{tid}/projects/{pid}/evacuations` (the exact path the page queries
 * client-side, gated by the tenant rules + the custom token's tenantId claim
 * 'e2e-tenant'). The page discovers the un-ended drill, resumes it, and the
 * status board lists the expected workers as MISSING — the worker's name can
 * only come from the seeded doc read through the real rules-gated query.
 *
 * Unique uid per spec (auto-select gotcha). Requires the full stack.
 */

const USER = { uid: 'e2e-c6-evac', email: 'c6-evac@praeventio.test', displayName: 'C6 Evac' };
const DRILL_ID = 'e2e-drill-c6';

function emulatorDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('c6-evacuation-dashboard.spec: FIRESTORE_EMULATOR_HOST is not set.');
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return admin.firestore();
}

test.describe('C6 — EvacuationDashboard con drill activo sembrado', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('la página retoma el drill activo y el tablero lista al trabajador esperado como faltante', async ({ page }) => {
    await loginAsTestUser(page, USER);
    const seed = await seedProject({ supervisorUid: USER.uid });
    const db = emulatorDb();
    // The page queries tenants/{tokenTenantId}/projects/{pid}/evacuations —
    // the custom token's claim is 'e2e-tenant' (fixtures/auth.ts), so the seed
    // MUST live under that tenant.
    const drillRef = db.doc(`tenants/e2e-tenant/projects/${seed.projectId}/evacuations/${DRILL_ID}`);

    try {
      await drillRef.set({
        id: DRILL_ID,
        projectId: seed.projectId,
        kind: 'drill',
        startedAt: new Date().toISOString(),
        startedByUid: USER.uid,
        meetingPointId: 'meeting-point-main',
        expectedWorkers: [
          { uid: 'e2e-worker-ana', fullName: 'Ana Cortés E2E' },
          { uid: 'e2e-worker-beto', fullName: 'Beto Rojas E2E' },
        ],
        // computeStatus() maps over drill.scans — the field is REQUIRED even
        // when nobody has scanned yet (first-run finding: omitting it threw
        // and the missing list never rendered).
        scans: [],
        // no endedAt → ACTIVE: the dashboard must discover + resume it.
      });

      await page.goto('/evacuation-dashboard');
      await signInBrowserViaCustomToken(page);
      await expect(page.getByTestId('evacDashboard.page')).toBeVisible({ timeout: 15_000 });

      // The drill card renders from the REAL tenant-scoped query.
      await expect(page.getByTestId(`evacuation-dashboard-${DRILL_ID}`)).toBeVisible({ timeout: 20_000 });

      // Un-fabricable: the missing list carries the seeded fullNames — they
      // can only exist if the rules-gated client read returned our doc. (The
      // page renders the NEW live board from components/evacuation/
      // EvacuationDashboard.tsx, which lists missing workers WITHOUT the old
      // StatusBoard's per-worker testids — assert by real content instead.)
      await expect(page.getByText('Faltan (2)')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Ana Cortés E2E')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('Beto Rojas E2E')).toBeVisible({ timeout: 10_000 });
    } finally {
      await drillRef.delete().catch(() => {});
      await seed.cleanup();
    }
  });
});
