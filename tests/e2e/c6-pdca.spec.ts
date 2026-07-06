import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * C6 — PdcaModule renders a REAL server-side JOIN of two seeded docs: the
 * page's hooks call /api/sprint-k/:pid/pdca/{cycles,non-conformities} which
 * read `tenants/{tid}/projects/{pid}/{pdca_cycles,non_conformities}` with the
 * Admin SDK. The kanban card must appear in the CHECK column (from the cycle's
 * currentStage) carrying the NC's description (joined by nonConformityId) —
 * content only the real reads can produce.
 *
 * Unique uid per spec (auto-select gotcha). Requires the full stack.
 */

const USER = { uid: 'e2e-c6-pdca', email: 'c6-pdca@praeventio.test', displayName: 'C6 Pdca' };
const NC_ID = 'nc-e2e-c6';
const CYCLE_ID = 'pdca-e2e-c6';

function emulatorDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('c6-pdca.spec: FIRESTORE_EMULATOR_HOST is not set.');
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return admin.firestore();
}

test.describe('C6 — PDCA con NC + ciclo sembrados', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('el kanban renderiza el ciclo en su columna real con la NC joineada', async ({ page }) => {
    await loginAsTestUser(page, USER);
    const seed = await seedProject({ supervisorUid: USER.uid });
    const db = emulatorDb();
    const base = `tenants/e2e-tenant/projects/${seed.projectId}`;
    const ncRef = db.doc(`${base}/non_conformities/${NC_ID}`);
    const cycleRef = db.doc(`${base}/pdca_cycles/${CYCLE_ID}`);

    try {
      const nowIso = new Date().toISOString();
      await ncRef.set({
        id: NC_ID,
        category: 'EPP',
        severity: 'major',
        description: 'NC E2E: cascos vencidos en bodega central',
        location: 'Bodega Central',
        detectedAt: nowIso,
        responsibleUid: USER.uid,
        status: 'open',
        createdByUid: USER.uid,
        createdAt: nowIso,
      });
      // Shape mirrors the POST /pdca/cycles handler's stored project.
      await cycleRef.set({
        id: CYCLE_ID,
        currentStage: 'check',
        cycleNumber: 1,
        nonConformityId: NC_ID,
        stages: [],
        startedAt: nowIso,
        createdByUid: USER.uid,
      });

      await page.goto('/pdca');
      await signInBrowserViaCustomToken(page);
      await expect(page.getByTestId('pdca-kanban-board')).toBeVisible({ timeout: 20_000 });

      // The card lands in the CHECK column (cycle.currentStage) and carries
      // the NC description — the server-side join of our two seeded docs.
      const checkColumn = page.getByTestId('pdca-kanban-column-check');
      await expect(checkColumn).toBeVisible({ timeout: 10_000 });
      const card = page.getByTestId(`pdca-card-${CYCLE_ID}`);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(checkColumn.getByTestId(`pdca-card-${CYCLE_ID}`)).toBeVisible();
      await expect(card).toContainText(/cascos vencidos|nc-e2e-c6/i);
    } finally {
      await cycleRef.delete().catch(() => {});
      await ncRef.delete().catch(() => {});
      await seed.cleanup();
    }
  });
});
