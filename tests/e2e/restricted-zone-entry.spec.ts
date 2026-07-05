import { test, expect } from '@playwright/test';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject, seedRestrictedZone } from './fixtures/seed';

/**
 * Restricted-zone informed entry — the founder NO-BLOCKING invariant (Bloque C1).
 *
 * The most load-bearing safety semantic of the restricted-zones module: a worker
 * who indicates they are entering a hazardous zone WITHOUT meeting its EPP /
 * training requirements is NEVER blocked, but the entry is ALWAYS recorded (so a
 * supervisor can follow up). Blocking physical access would push workers to enter
 * unrecorded; recording-without-blocking is the product's honesty contract.
 *
 * This drives the REAL worker surface (`/zone-entry` → `ZoneEntryView` →
 * `ZoneEntryGate`) and asserts the UN-GAMEABLE server signal: the actual
 * `POST /api/zones/entry-event` fires and the Express server (E2E_MODE) writes a
 * real `tenants/{tid}/projects/{pid}/zone_entry_events` row through verifyAuth +
 * assertProjectMember, returning `{ success, eventId, evaluation, recorded: true }`
 * with `evaluation.allowed === false` — proof the entry was recorded despite the
 * worker not meeting requirements. Requires the full stack (`npm run test:e2e:full`).
 */
test.describe('Restricted-zone informed entry (no-blocking invariant)', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('ingreso sin cumplir requisitos NO se bloquea y SÍ queda registrado en el servidor', async ({ page }) => {
    await loginAsTestUser(page);
    const seed = await seedProject();
    // A hot-work zone whose EPP + training the worker will NOT confirm, so the
    // informed-entry engine evaluates `allowed: false`.
    const zone = await seedRestrictedZone(seed.projectId);

    try {
      await page.goto('/zone-entry');
      // Real Firebase Auth (firestore.rules require request.auth != null for the
      // by-site read that lists the seeded zone).
      await signInBrowserViaCustomToken(page);

      // Active-project barrier: ZoneEntryView renders "Selecciona un proyecto"
      // until ProjectContext auto-selects the seeded project (query members
      // array-contains uid). The by-site fetch is keyed on that projectId.
      await expect(page.getByRole('button', { name: /E2E Project/i })).toBeVisible({ timeout: 15_000 });

      // The seeded zone must surface in the worker's zone list.
      const prepare = page.getByTestId(`zone-prepare-${zone.zoneId}`);
      await expect(prepare).toBeVisible({ timeout: 15_000 });
      await prepare.click();

      // Self-attestation panel opens. We DELIBERATELY confirm nothing — the
      // worker does not hold the required EPP/training. `Continuar` gates on the
      // real work-permits fetch resolving (empty for a fresh project), not on the
      // requirements being met.
      await expect(page.getByTestId('zone-prepare-panel')).toBeVisible({ timeout: 10_000 });
      const cont = page.getByTestId('zone-continue');
      await expect(cont).toBeEnabled({ timeout: 15_000 });
      await cont.click();

      // The informed-entry gate opens. Per founder directive the acknowledge
      // action is ALWAYS enabled, even with pending requirements — assert that.
      const ack = page.getByTestId('zone-gate-ack');
      await expect(ack).toBeVisible({ timeout: 10_000 });
      await expect(ack, 'the informed-entry gate must NEVER disable entry').toBeEnabled();

      // Arm the entry-event POST wait BEFORE acknowledging, then confirm entry.
      const entryResponsePromise = page.waitForResponse(
        (res) =>
          res.url().includes('/api/zones/entry-event') && res.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await ack.click();
      const entryResponse = await entryResponsePromise;

      // The un-gameable signal: the server RECORDED the entry (real Firestore
      // write) even though the engine judged it not-allowed — the no-blocking
      // invariant, end to end.
      expect(entryResponse.status(), 'entry-event must return 200 even when not allowed').toBe(200);
      const payload = (await entryResponse.json()) as {
        success?: boolean;
        recorded?: boolean;
        eventId?: string;
        evaluation?: { allowed?: boolean; missing?: string[] };
      };
      expect(payload.success).toBe(true);
      expect(payload.recorded, 'the entry must be persisted regardless of allowed').toBe(true);
      expect(
        typeof payload.eventId === 'string' && payload.eventId.length > 0,
        'server must return the id of the persisted zone_entry_events doc',
      ).toBe(true);
      expect(
        payload.evaluation?.allowed,
        'worker did not meet requirements → server re-evaluation must be allowed:false',
      ).toBe(false);
      expect((payload.evaluation?.missing ?? []).length).toBeGreaterThan(0);

      // The request body must carry the real selected project + the auth uid
      // (server enforces workerUid === caller uid), not a hardcoded fixture.
      const sentBody = entryResponse.request().postDataJSON() as {
        projectId?: string;
        workerUid?: string;
        zoneId?: string;
      };
      expect(sentBody.projectId).toBe(seed.projectId);
      expect(sentBody.workerUid).toBe('e2e-user-001');
      expect(sentBody.zoneId).toBe(zone.zoneId);

      // The worker-facing confirmation that the entry was recorded.
      await expect(page.getByTestId('zone-entry-log-ok')).toBeVisible({ timeout: 10_000 });
    } finally {
      await zone.cleanup();
      await seed.cleanup();
    }
  });
});
