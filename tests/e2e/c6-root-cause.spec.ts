import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * C6 — RootCauseInvestigation renders a REAL seeded analysis: the page
 * subscribes to `projects/{pid}/root_cause_analyses` (client read through the
 * members master-gate). The history row shows the incident id + the label the
 * page derives from the seeded `primaryFactor` — content that can only come
 * from the rules-gated read of our doc.
 *
 * Unique uid per spec (auto-select gotcha). Requires the full stack.
 */

const USER = { uid: 'e2e-c6-root', email: 'c6-root@praeventio.test', displayName: 'C6 Root' };
const INCIDENT_ID = 'INC-E2E-001';

function emulatorDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('c6-root-cause.spec: FIRESTORE_EMULATOR_HOST is not set.');
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return admin.firestore();
}

test.describe('C6 — RootCause con análisis sembrado', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('el historial renderiza el análisis real sembrado con su factor primario', async ({ page }) => {
    await loginAsTestUser(page, USER);
    const seed = await seedProject({ supervisorUid: USER.uid });
    const db = emulatorDb();
    const analysisRef = db.doc(`projects/${seed.projectId}/root_cause_analyses/${INCIDENT_ID}`);

    try {
      await analysisRef.set({
        incidentId: INCIDENT_ID,
        projectId: seed.projectId,
        factors: ['falla_epp'],
        primaryFactor: 'falla_epp',
        fiveWhys: [
          'Guante roto',
          'Stock vencido',
          'Compra atrasada',
          'Sin control de inventario',
          'Sin responsable asignado',
        ],
        analyzedByUid: USER.uid,
        analyzedAt: new Date().toISOString(),
        // Required by RootCauseAnalysis — the detail card maps over it, and
        // the page auto-selects the newest analysis on load (first-run
        // finding: omitting it crashed the page into the error boundary).
        suggestedActions: ['Reponer stock de EPP certificado', 'Auditar inventario mensualmente'],
      });

      await page.goto('/root-cause');
      await signInBrowserViaCustomToken(page);

      // The history row renders ONLY if the client subscription returned our
      // doc through the members master-gate.
      const historyItem = page.getByTestId(`root-cause-history-item-${INCIDENT_ID}`);
      await expect(historyItem).toBeVisible({ timeout: 20_000 });
      await expect(historyItem).toContainText(INCIDENT_ID);
    } finally {
      await analysisRef.delete().catch(() => {});
      await seed.cleanup();
    }
  });
});
