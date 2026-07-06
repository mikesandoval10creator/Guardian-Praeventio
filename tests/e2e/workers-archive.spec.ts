import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Workers — archive, not delete (Bloque E1). A worker record is legally
 * retained evidence (personnel records, DS44 / Ley 16.744): the UI ARCHIVES
 * via the audited server route, never a client hard-delete.
 *
 * Drives the REAL Workers UI (row menu → Archivar → confirm) and asserts the
 * un-gameable server signals straight from the Firestore emulator:
 *  - the worker doc STILL EXISTS (never destroyed) with archived:true and
 *    archivedBy stamped from the verified token (not a client value);
 *  - an append-only audit_logs row action 'workers.archive' with the caller's
 *    server-stamped userId.
 *
 * Unique uid per spec (auto-select gotcha). Requires the full stack.
 */

const USER = { uid: 'e2e-e1-workers', email: 'e1-workers@praeventio.test', displayName: 'E1 Workers' };
const WORKER_ID = 'e2e-worker-archive-1';

function emulatorDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('workers-archive.spec: FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:e2e:full`.');
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return admin.firestore();
}

test.describe('Workers — archivar (nunca hard-delete) con audit', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('archivar un trabajador conserva el registro (archived+audit), jamás lo elimina', async ({ page }) => {
    await loginAsTestUser(page, USER);
    const seed = await seedProject({ supervisorUid: USER.uid });
    const db = emulatorDb();
    const workerRef = db.collection('projects').doc(seed.projectId).collection('workers').doc(WORKER_ID);

    try {
      await workerRef.set({ id: WORKER_ID, name: 'Juan Pérez E2E', role: 'operario', createdAt: new Date().toISOString() });

      await page.goto('/workers');
      await signInBrowserViaCustomToken(page);

      // The worker row renders from the real client Firestore read.
      await expect(page.getByText('Juan Pérez E2E')).toBeVisible({ timeout: 20_000 });

      // Row menu → Archivar → confirm.
      await page.getByTestId(`worker-menu-${WORKER_ID}`).click();
      await page.getByTestId(`worker-archive-${WORKER_ID}`).click();

      const archiveResponse = page.waitForResponse(
        (r) => /\/api\/projects\/.+\/workers\/.+\/archive$/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 20_000 },
      );
      // ConfirmDialog's confirm button (its own testid — the row's Archivar
      // action also carries that label, which would violate strict mode).
      await page.getByTestId('confirm-dialog-confirm').click();
      const res = await archiveResponse;
      expect(res.status(), 'archive must be accepted').toBe(200);

      // ── UN-GAMEABLE: the worker doc is RETAINED (never deleted), flagged
      // archived, with identity stamped by the server.
      await expect
        .poll(async () => ((await workerRef.get()).data() as Record<string, any> | undefined)?.archived, {
          intervals: [200, 500, 1000],
          timeout: 8_000,
        })
        .toBe(true);
      const worker = (await workerRef.get()).data() as Record<string, any>;
      expect(worker, 'the worker record must survive — legal retention').toBeTruthy();
      expect(worker.name).toBe('Juan Pérez E2E');
      expect(worker.archivedBy).toBe(USER.uid); // stamped from the token
      expect(worker.archivedAt).toBeTruthy();

      // Append-only audit trail.
      const logs = await db.collection('audit_logs').where('details.workerId', '==', WORKER_ID).get();
      const row = logs.docs.map((d) => d.data() as Record<string, any>).find((r) => r.action === 'workers.archive');
      expect(row, 'a workers.archive audit row must exist').toBeTruthy();
      expect(row!.userId).toBe(USER.uid); // server-stamped, never client
    } finally {
      await workerRef.delete().catch(() => {});
      await seed.cleanup();
    }
  });
});
