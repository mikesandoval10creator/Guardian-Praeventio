import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Protocolo PREXOR (Bloque C5) — drive the REAL noise-dose UI and assert the
 * SERVER-side recompute + persistence:
 *
 *  - 8h @ 85 dB(A) is EXACTLY 100% dose (the D.S. 594 criterion level); bumping
 *    the level to 90 dB(A) yields 100·2^((90−85)/3) ≈ 317.5% — real Q=3dB
 *    exchange-rate math no mock can guess. The server recomputes on every
 *    calculate (POST /api/sprint-k/:pid/protocols/prexor); the client never
 *    supplies the dose.
 *  - Saving POSTs .../protocols/prexor/assessments → 201 with the recomputed
 *    result; the history row renders from the REAL protocol_assessments doc
 *    and metadata.author is stamped from the verified token.
 *
 * Unique uid per spec (auto-select gotcha, C4). Requires the full stack.
 */

const USER = { uid: 'e2e-c5-prexor', email: 'c5-prexor@praeventio.test', displayName: 'C5 Prexor' };

function emulatorDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('protocolo-prexor.spec: FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:e2e:full`.');
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return admin.firestore();
}

test.describe('PREXOR — dosis de ruido real con recompute server-side', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('la dosis D.S. 594 se recomputa en el server (Q=3dB) y la evaluación persiste', async ({ page }) => {
    await loginAsTestUser(page, USER);
    const seed = await seedProject({ supervisorUid: USER.uid });
    let assessmentId: string | undefined;

    try {
      await page.goto('/prexor');
      await signInBrowserViaCustomToken(page);
      await expect(page.getByTestId('prexor-page')).toBeVisible({ timeout: 15_000 });

      // Ensure the first measurement row is the canonical 8h @ 85 dB(A).
      await page.getByTestId('prexor-duration-input-0').fill('8');
      await page.getByTestId('prexor-level-input-0').fill('85');
      const calcBtn = page.getByTestId('prexor-calculate-btn');
      const calc1 = page.waitForResponse(
        (r) => /\/protocols\/prexor$/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await calcBtn.click();
      const calc1Res = await calc1;
      expect(calc1Res.ok()).toBe(true);
      const dose1 = ((await calc1Res.json()) as { result?: { dosePercent?: number } }).result?.dosePercent;
      expect(dose1, '8h @ 85dB must be exactly 100% dose').toBe(100);

      // 90 dB(A) → 317.48% (Q=3dB), over the legal limit → 'alto'.
      await page.getByTestId('prexor-level-input-0').fill('90');
      const calc2 = page.waitForResponse(
        (r) => /\/protocols\/prexor$/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await calcBtn.click();
      const calc2Res = await calc2;
      expect(calc2Res.ok()).toBe(true);
      const result2 = ((await calc2Res.json()) as { result?: { dosePercent?: number; riskLevel?: string; exceedsLegalLimit?: boolean } }).result;
      expect(result2?.dosePercent).toBeGreaterThan(317);
      expect(result2?.dosePercent).toBeLessThan(318);
      expect(result2?.exceedsLegalLimit).toBe(true);
      await expect(page.getByTestId('prexor-risk-badge')).toContainText(/alto/i, { timeout: 10_000 });
      await expect(page.getByTestId('prexor-legal-limit')).toContainText(/supera/i, { timeout: 10_000 });

      // Persist + read back through the real history.
      await page.getByTestId('prexor-task-input').fill('Perforación E2E');
      const savePromise = page.waitForResponse(
        (r) => /\/protocols\/prexor\/assessments$/.test(r.url()) && r.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await page.getByTestId('prexor-save-btn').click();
      const save = await savePromise;
      expect(save.status(), 'save must be accepted').toBe(201);
      const body = (await save.json()) as { id?: string; result?: { dosePercent?: number; riskLevel?: string } };
      assessmentId = body.id;
      expect(typeof assessmentId === 'string' && assessmentId!.length > 0).toBe(true);
      expect(body.result?.dosePercent).toBeGreaterThan(317);
      expect(body.result?.riskLevel).toBe('alto');

      await expect(page.getByTestId('prexor-status')).toBeVisible({ timeout: 10_000 });
      const historyItem = page.getByTestId(`prexor-history-item-${assessmentId}`);
      await expect(historyItem).toBeVisible({ timeout: 15_000 });
      await expect(historyItem).toContainText('Perforación E2E');

      // Un-gameable: the persisted doc, token-stamped author.
      const doc = await emulatorDb().collection('protocol_assessments').doc(assessmentId!).get();
      expect(doc.exists).toBe(true);
      const data = doc.data() as Record<string, any>;
      expect(data.protocol).toBe('PREXOR');
      expect(data.projectId).toBe(seed.projectId);
      expect(data.metadata?.author).toBe(USER.uid);
    } finally {
      if (assessmentId) {
        await emulatorDb().collection('protocol_assessments').doc(assessmentId).delete().catch(() => {});
      }
      await seed.cleanup();
    }
  });
});
