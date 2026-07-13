import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Protocolo TMERT (Bloque C5) — drive the REAL evaluation UI and assert the
 * SERVER-side recompute + persistence, matriz-iper style:
 *
 *  - The verdict is recomputed by the server (POST /api/sprint-k/:pid/
 *    protocols/tmert) from the raw conditions — the client never supplies the
 *    result. 0 conditions → 'bajo'; 3 factors at risk → 'alto' + mandatory
 *    medical referral (evaluateTmert, pure + mutation-tested).
 *  - Saving POSTs .../protocols/tmert/assessments → 201 with the recomputed
 *    result; the history list re-renders from GET .../protocols/assessments
 *    reading the REAL protocol_assessments doc (write→read round trip), and
 *    the doc's metadata.author is stamped from the verified token.
 *
 * Unique uid per spec (auto-select gotcha, C4): with one seeded project the
 * ProjectContext deterministically selects OURS. Requires the full stack.
 */

const USER = { uid: 'e2e-c5-tmert', email: 'c5-tmert@praeventio.test', displayName: 'C5 Tmert' };

function emulatorDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('protocolo-tmert.spec: FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:e2e:full`.');
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return admin.firestore();
}

test.describe('TMERT — evaluación real con recompute server-side', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('el veredicto del engine se recomputa en el server y la evaluación persiste con identidad estampada', async ({ page }) => {
    await loginAsTestUser(page, USER);
    const seed = await seedProject({ supervisorUid: USER.uid });
    let assessmentId: string | undefined;

    try {
      await page.goto('/tmert');
      await signInBrowserViaCustomToken(page);
      await expect(page.getByTestId('tmert-page')).toBeVisible({ timeout: 15_000 });

      // Baseline: 0 conditions → the server's evaluateTmert says 'bajo'.
      const calcBtn = page.getByTestId('tmert-calculate-btn');
      await expect(calcBtn).toBeEnabled({ timeout: 10_000 });
      const calc1 = page.waitForResponse(
        (r) => /\/protocols\/tmert$/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await calcBtn.click();
      expect((await calc1).ok()).toBe(true);
      await expect(page.getByTestId('tmert-risk-badge')).toContainText(/bajo/i, { timeout: 10_000 });

      // 3 factors at risk (one condition each) → 'alto' + medical referral.
      await page.getByTestId('tmert-cond-repetitividad-A').click();
      await page.getByTestId('tmert-cond-fuerza-B').click();
      await page.getByTestId('tmert-cond-posturaForzada-C').click();
      const calc2 = page.waitForResponse(
        (r) => /\/protocols\/tmert$/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await calcBtn.click();
      expect((await calc2).ok()).toBe(true);
      await expect(page.getByTestId('tmert-risk-badge')).toContainText(/alto/i, { timeout: 10_000 });
      await expect(page.getByTestId('tmert-medical-referral')).toBeVisible({ timeout: 10_000 });

      // Persist: the save POST returns the SERVER-recomputed result.
      await page.getByTestId('tmert-task-input').fill('Ensacado manual línea 2 — E2E');
      const savePromise = page.waitForResponse(
        (r) => /\/protocols\/tmert\/assessments$/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await page.getByTestId('tmert-save-btn').click();
      const save = await savePromise;
      expect(save.status(), 'save must be accepted').toBe(201);
      const body = (await save.json()) as { id?: string; result?: { overallRisk?: string; requiresMedicalEvaluation?: boolean; factorsAtRisk?: unknown[] } };
      assessmentId = body.id;
      expect(typeof assessmentId === 'string' && assessmentId!.length > 0).toBe(true);
      expect(body.result?.overallRisk).toBe('alto');
      expect(body.result?.requiresMedicalEvaluation).toBe(true);
      expect(body.result?.factorsAtRisk?.length).toBe(3);

      // History re-renders from the REAL doc (GET assessments → Firestore).
      await expect(page.getByTestId('tmert-status')).toBeVisible({ timeout: 10_000 });
      const historyItem = page.getByTestId(`tmert-history-item-${assessmentId}`);
      await expect(historyItem).toBeVisible({ timeout: 15_000 });
      await expect(historyItem).toContainText('Ensacado manual línea 2 — E2E');

      // Un-gameable: the persisted doc carries the token-stamped author.
      const doc = await emulatorDb().collection('protocol_assessments').doc(assessmentId!).get();
      expect(doc.exists).toBe(true);
      const data = doc.data() as Record<string, any>;
      expect(data.protocol).toBe('TMERT');
      expect(data.projectId).toBe(seed.projectId);
      expect(data.metadata?.author).toBe(USER.uid); // from the verified token
    } finally {
      if (assessmentId) {
        await emulatorDb().collection('protocol_assessments').doc(assessmentId).delete().catch(() => {});
      }
      await seed.cleanup();
    }
  });
});
