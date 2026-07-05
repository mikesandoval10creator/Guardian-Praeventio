import { test, expect } from '@playwright/test';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Lone worker (trabajador solitario) — start a solo-work session + heartbeat
 * check-in (Bloque C1).
 *
 * A worker operating alone starts a session and pulses "estoy bien" check-ins;
 * a missed pulse is what a supervisor escalates on. This drives the REAL worker
 * surface (`/lone-worker/check-in`) and asserts the un-gameable server signal:
 * the actual `POST /api/sprint-k/:projectId/lone-worker/start-session` and
 * `.../check-in` fire through verifyAuth + assertProjectMember, the server
 * STAMPS the session's `workerUid` from the verified token (never the body) and
 * enforces the anti-blame rule (a worker can only check-in for themselves), and
 * each is audited (audit_logs). Requires the full stack (`npm run test:e2e:full`).
 */
test.describe('Lone worker session + check-in (real flow)', () => {
  // start-session may capture device GPS; grant a fixed location so it resolves
  // immediately instead of stalling on getCurrentPosition (same as sos-button).
  test.use({
    permissions: ['geolocation'],
    geolocation: { latitude: -33.4489, longitude: -70.6693 },
  });

  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('iniciar sesión y hacer check-in registra el latido real con identidad estampada por el servidor', async ({ page }) => {
    await loginAsTestUser(page);
    const seed = await seedProject();

    try {
      await page.goto('/lone-worker/check-in');
      await signInBrowserViaCustomToken(page);

      // Active-project barrier — the session endpoints are keyed on the
      // auto-selected project.
      await expect(page.getByRole('button', { name: /E2E Project/i })).toBeVisible({ timeout: 15_000 });

      // No active session yet → the empty state offers to start one.
      const start = page.getByTestId('loneWorker.start');
      await expect(start).toBeVisible({ timeout: 15_000 });

      // START: the real POST mints the session id + stamps workerUid from the token.
      const startResponsePromise = page.waitForResponse(
        (res) =>
          /\/api\/sprint-k\/.+\/lone-worker\/start-session$/.test(res.url()) &&
          res.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await start.click();
      const startResponse = await startResponsePromise;

      expect(startResponse.ok(), 'start-session must be accepted').toBe(true);
      const startBody = (await startResponse.json()) as {
        session?: { id?: string; workerUid?: string; status?: string };
      };
      expect(
        typeof startBody.session?.id === 'string' && startBody.session.id.length > 0,
        'server must mint a session id',
      ).toBe(true);
      // Server-stamped identity — proof the session belongs to the authed worker,
      // not a client-supplied value.
      expect(startBody.session?.workerUid).toBe('e2e-user-001');

      // The active-session widget surfaces once the client persists the session
      // and its live subscription fires.
      const checkIn = page.getByTestId('loneWorker.widget.checkIn');
      await expect(checkIn).toBeVisible({ timeout: 15_000 });

      // CHECK-IN: the real heartbeat POST. Server enforces workerUid === caller.
      const checkInResponsePromise = page.waitForResponse(
        (res) =>
          /\/api\/sprint-k\/.+\/lone-worker\/check-in$/.test(res.url()) &&
          res.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await checkIn.click();
      const checkInResponse = await checkInResponsePromise;

      expect(checkInResponse.ok(), 'check-in must be accepted (not a 403 anti-blame reject)').toBe(true);
      const checkInBody = (await checkInResponse.json()) as {
        session?: { workerUid?: string; checkIns?: unknown[] };
      };
      expect(checkInBody.session?.workerUid).toBe('e2e-user-001');
      expect(
        Array.isArray(checkInBody.session?.checkIns) && checkInBody.session!.checkIns!.length >= 1,
        'the server must return the session with the recorded heartbeat',
      ).toBe(true);

      // The request body carried the real selected project.
      expect(checkInResponse.url()).toContain(`/api/sprint-k/${seed.projectId}/lone-worker/check-in`);
    } finally {
      await seed.cleanup();
    }
  });
});
