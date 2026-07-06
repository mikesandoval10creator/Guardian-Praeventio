import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * CEAL-SM (Bloque C5) — the highest-compliance-value protocol: the responder
 * answers the REAL 54-item questionnaire and the spec asserts the two legal
 * invariants no client fixture can fake, straight from the emulator:
 *
 *  1. ANONYMITY BY CONSTRUCTION: the persisted response doc's id is the
 *     peppered HMAC hash (32-hex, ≠ uid) and the FULL serialized doc contains
 *     neither the uid nor the email. The already-responded state after reload
 *     only renders if the server re-derives the same hash and finds the doc —
 *     a real write→derive→read round trip.
 *  2. K-GATE: with 1 response (< anonymity threshold) the campaigns page shows
 *     'ceal-results-suppressed' and NO aggregate badge — the server refuses to
 *     emit aggregates below the threshold.
 *
 * Campaign is SEEDED via Admin SDK (creation via UI needs a manage role the
 * E2E fixture doesn't carry — respond is member-open, manage is role-gated).
 * Unique uid per spec (auto-select gotcha). Requires the full stack.
 */

const USER = { uid: 'e2e-c5-ceal', email: 'c5-ceal@praeventio.test', displayName: 'C5 Ceal' };

function emulatorDb(): admin.firestore.Firestore {
  if (!admin.apps.length) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) {
      throw new Error('ceal-sm-responder.spec: FIRESTORE_EMULATOR_HOST is not set. Run via `npm run test:e2e:full`.');
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT) process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
    admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  }
  return admin.firestore();
}

/** Seed an OPEN campaign with the exact StoredCealCampaign shape (cealSm.ts). */
async function seedCealCampaign(projectId: string): Promise<{ campaignId: string; cleanup: () => Promise<void> }> {
  const db = emulatorDb();
  const now = Date.now();
  const ref = await db.collection('ceal_sm_campaigns').add({
    projectId,
    title: 'Campaña CEAL E2E',
    status: 'open',
    openAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
    closeAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
    totalWorkers: 25,
    createdAt: new Date(now).toISOString(),
    createdBy: 'e2e-seed',
  });
  return {
    campaignId: ref.id,
    cleanup: async () => {
      const responses = await ref.collection('responses').get();
      await Promise.all(responses.docs.map((d) => d.ref.delete()));
      await ref.delete();
    },
  };
}

test.describe('CEAL-SM — respuesta anónima por construcción + k-gate', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('responder el cuestionario persiste SIN identidad y los agregados quedan suprimidos bajo el umbral', async ({ page }) => {
    await loginAsTestUser(page, USER);
    const seed = await seedProject({ supervisorUid: USER.uid });
    const campaign = await seedCealCampaign(seed.projectId);

    try {
      await page.goto('/ceal-sm/responder');
      await signInBrowserViaCustomToken(page);
      await expect(page.getByTestId('ceal-responder-page')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('ceal-anonymity-notice')).toBeVisible({ timeout: 10_000 });

      // Pick the seeded campaign → the real 54-item questionnaire.
      const pick = page.getByTestId(`ceal-pick-${campaign.campaignId}`);
      await expect(pick).toBeVisible({ timeout: 15_000 });
      await pick.click();
      await expect(page.getByTestId('ceal-questionnaire')).toBeVisible({ timeout: 10_000 });

      // Answer every item: first option of each ceal-item-* block.
      const items = page.locator('[data-testid^="ceal-item-"]');
      const count = await items.count();
      expect(count, 'the CEAL-SM questionnaire must render its full item set').toBeGreaterThanOrEqual(50);
      for (let i = 0; i < count; i++) {
        await items.nth(i).locator('[data-testid^="ceal-opt-"]').first().click();
      }
      await expect(page.getByTestId('ceal-progress')).toContainText(`${count} de ${count}`);

      // Submit → the REAL respond POST (member-open; anonymous-by-construction).
      const respondPromise = page.waitForResponse(
        (r) => r.url().includes(`/ceal-sm/campaigns/${campaign.campaignId}/respond`) && r.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await page.getByTestId('ceal-submit-btn').click();
      const respond = await respondPromise;
      expect(respond.status(), 'respond must be accepted').toBe(201);
      await expect(page.getByTestId('ceal-submitted')).toBeVisible({ timeout: 10_000 });

      // ── Invariante 1: anonimato por construcción, contra el doc REAL.
      const db = emulatorDb();
      const responses = await db
        .collection('ceal_sm_campaigns')
        .doc(campaign.campaignId)
        .collection('responses')
        .get();
      expect(responses.size, 'exactly one persisted response').toBe(1);
      const doc = responses.docs[0];
      expect(doc.id).toMatch(/^[0-9a-f]{32}$/); // peppered HMAC, not a uid
      expect(doc.id).not.toBe(USER.uid);
      const serialized = JSON.stringify({ id: doc.id, ...doc.data() });
      expect(serialized).not.toContain(USER.uid);
      expect(serialized).not.toContain('e2e@praeventio.test');
      expect(serialized).not.toContain(USER.email);

      // Round trip: after reload the server re-derives the hash and reports
      // 'already responded' — only possible if the doc truly persisted.
      await page.reload();
      await signInBrowserViaCustomToken(page);
      await expect(page.getByTestId(`ceal-responded-${campaign.campaignId}`)).toBeVisible({ timeout: 15_000 });

      // ── Invariante 2: k-gate — 1 respuesta < umbral → agregados suprimidos.
      await page.goto('/ceal-sm');
      await expect(page.getByTestId(`ceal-campaign-item-${campaign.campaignId}`)).toBeVisible({ timeout: 15_000 });
      await page.getByTestId(`ceal-campaign-item-${campaign.campaignId}`).click();
      await expect(page.getByTestId('ceal-results-suppressed')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('ceal-center-badge')).toHaveCount(0); // NO aggregate leaks below k
    } finally {
      await campaign.cleanup();
      await seed.cleanup();
    }
  });
});
