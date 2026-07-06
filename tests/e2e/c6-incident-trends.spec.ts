import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * C6 — IncidentTrends aggregates REAL seeded incidents SERVER-side: the page
 * calls /api/sprint-k/:pid/incident-trends/* which reads the top-level
 * `incidents` collection (where projectId ==) with the Admin SDK. Seeding 3
 * incidents inside the default 12-month window must surface total '3' and a
 * non-empty sparkline — numbers only the server aggregation can produce.
 *
 * Unique uid per spec (auto-select gotcha). Requires the full stack.
 */

const USER = { uid: 'e2e-c6-trends', email: 'c6-trends@praeventio.test', displayName: 'C6 Trends' };

function emulatorDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('c6-incident-trends.spec: FIRESTORE_EMULATOR_HOST is not set.');
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return admin.firestore();
}

test.describe('C6 — IncidentTrends con incidentes sembrados', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('el total agregado server-side refleja los 3 incidentes reales de la ventana', async ({ page }) => {
    await loginAsTestUser(page, USER);
    const seed = await seedProject({ supervisorUid: USER.uid });
    const db = emulatorDb();
    const day = 24 * 60 * 60 * 1000;
    const seededRefs: FirebaseFirestore.DocumentReference[] = [];

    try {
      const incidents = [
        { occurredAt: new Date(Date.now() - 5 * day).toISOString(), severity: 'high', incidentType: 'caida_altura', status: 'closed', summary: 'Incidente E2E 1' },
        { occurredAt: new Date(Date.now() - 35 * day).toISOString(), severity: 'medium', incidentType: 'golpe', status: 'closed', summary: 'Incidente E2E 2' },
        { occurredAt: new Date(Date.now() - 65 * day).toISOString(), severity: 'low', incidentType: 'near_miss', status: 'closed', summary: 'Incidente E2E 3' },
      ];
      for (const inc of incidents) {
        const ref = await db.collection('incidents').add({ projectId: seed.projectId, ...inc });
        seededRefs.push(ref);
      }

      await page.goto('/incident-trends');
      await signInBrowserViaCustomToken(page);
      await expect(page.getByTestId('incident-trends-page')).toBeVisible({ timeout: 15_000 });

      // Aggregated server-side from the seeded docs (defaults: 12m window).
      await expect(page.getByTestId('incident-trends-total')).toContainText('3', { timeout: 20_000 });
      await expect(page.getByTestId('incident-trends-chart')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('incident-trends-chart-empty')).toHaveCount(0);
    } finally {
      await Promise.all(seededRefs.map((r) => r.delete().catch(() => {})));
      await seed.cleanup();
    }
  });
});
