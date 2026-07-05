import { test, expect } from '@playwright/test';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Emergency brigade — designate a brigadista (Bloque C1).
 *
 * A prepared emergency response needs a real, auditable roster: who is trained
 * for which role. This drives the REAL admin surface (`/emergency-brigade` →
 * `AddMemberModal`) and asserts the un-gameable server signal — the actual
 * `POST /api/sprint-k/:projectId/emergency-brigade/members` fires and the Express
 * server (E2E_MODE) writes a real `tenants/{tid}/projects/{pid}/emergency_brigade`
 * member doc through verifyAuth + assertProjectMember + the BRIGADE_WRITE_ROLES
 * gate (the E2E fixture user is a supervisor), returning 201 `{ ok, id }`, and
 * the roster flips from empty to populated after the refetch.
 *
 * Requires the full stack. Run via `npm run test:e2e:full`.
 */
test.describe('Emergency brigade roster (real write)', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('designar un brigadista registra el miembro en el servidor y puebla el roster', async ({ page }) => {
    await loginAsTestUser(page);
    const seed = await seedProject();

    try {
      await page.goto('/emergency-brigade');
      await signInBrowserViaCustomToken(page);

      // Active-project barrier: the brigade snapshot fetch is keyed on the
      // auto-selected project (query members array-contains uid).
      await expect(page.getByRole('button', { name: /E2E Project/i })).toBeVisible({ timeout: 15_000 });

      // A fresh project has an EMPTY brigade → the empty-state CTA shows. (Fall
      // back to the header button if a default roster ever renders.)
      const openAdd = page
        .getByTestId('emergency-brigade-empty-add-member')
        .or(page.getByTestId('emergency-brigade-add-member-btn'));
      await expect(openAdd.first()).toBeVisible({ timeout: 15_000 });
      await openAdd.first().click();

      // Designate the (only) project member as a brigadista. The server enforces
      // `workerIsProjectMember`, so the seeded member is the honest choice; role
      // defaults to brigade_chief and trainedAt to today.
      await expect(page.getByTestId('brigade-add-member-modal')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('brigade-add-member-uid').fill('e2e-user-001');

      // Arm the members POST wait BEFORE submitting, then submit.
      const memberResponsePromise = page.waitForResponse(
        (res) =>
          /\/api\/sprint-k\/.+\/emergency-brigade\/members$/.test(res.url()) &&
          res.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await page.getByTestId('brigade-add-member-submit').click();
      const memberResponse = await memberResponsePromise;

      // The un-gameable signal: the server PERSISTED the brigade member (real
      // Firestore write + audit) through the role gate, returning 201 + the id.
      expect(memberResponse.status(), 'member add must be accepted (201)').toBe(201);
      const payload = (await memberResponse.json()) as { ok?: boolean; id?: string };
      expect(payload.ok, 'server must confirm the member was recorded').toBe(true);
      expect(
        typeof payload.id === 'string' && payload.id.length > 0,
        'server must return the id of the persisted emergency_brigade member doc',
      ).toBe(true);

      // The request went to the real selected project, and the added worker is
      // the seeded project member (server enforces `worker_not_in_project`).
      expect(memberResponse.url()).toContain(`/api/sprint-k/${seed.projectId}/emergency-brigade/members`);
      const sentBody = memberResponse.request().postDataJSON() as {
        workerUid?: string;
        role?: string;
      };
      expect(sentBody.workerUid).toBe('e2e-user-001');

      // The roster round-trips: after the refetch the members section renders,
      // i.e. the brigade flipped from empty to populated off the real write.
      await expect(page.getByTestId('emergency-brigade-members-section')).toBeVisible({ timeout: 15_000 });
    } finally {
      await seed.cleanup();
    }
  });
});
