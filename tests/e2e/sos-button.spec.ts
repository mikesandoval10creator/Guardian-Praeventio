import { test, expect } from '@playwright/test';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * SOSButton E2E — REAL flow (un-fixme'd 2026-06-21).
 *
 * This drives the ACTUAL app, not a smoke-mount or a 403 gate:
 *   1. Seeds a project with a DECLARED emergency (`isEmergencyActive: true`)
 *      + the test user as a member (so ProjectContext auto-selects it).
 *   2. Navigates to the real `/emergency` route and signs the user into the
 *      Firebase Auth emulator (custom token) so the auth-gated page loads.
 *   3. The page mirrors the declared emergency into AppMode === 'emergency'
 *      (`resolveEmergencyModeTransition`), which is the ONLY condition under
 *      which the global SOSButton (RootLayout) renders. So the button being
 *      visible is itself proof the real ProjectContext + AppMode chain ran.
 *   4. Exercises the REAL 3-second long-press and asserts the REAL behavior:
 *        - a short tap does NOT issue POST /api/emergency/sos;
 *        - a ≥3s long-press DOES issue it, and the Express server (E2E_MODE)
 *          writes a real `tenants/{tid}/emergency_alerts` row through the real
 *          verifyAuth + assertProjectMember chain, responding `{ ok: true,
 *          alertId: <id> }`.
 *
 * Why NOT assert the green "Alerta enviada" toast: the E2E harness has no
 * registered FCM devices and no email service, so the server responds
 * `delivered: false` (zero-reach) — by design (#1 life-safety: never falsely
 * reassure). The component then falls through to the tel: deeplink / zero-reach
 * toast. Asserting the toast would be asserting a lie. The un-gameable signal
 * is the network request firing + the server's `ok/alertId` — the actual SOS
 * being recorded.
 *
 * Requires the full stack. Run via `npm run test:e2e:full`.
 */
test.describe('SOSButton long-press (real flow)', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('long-press de 3s registra la alerta SOS real; tap corto no', async ({ page }) => {
    await loginAsTestUser(page);
    // Declared emergency so the /emergency page flips AppMode → 'emergency',
    // which is the gate that renders the global SOSButton. Seed a project
    // phone so the zero-reach fallback has a real tel: target.
    const seed = await seedProject({ emergencyActive: true, phone: '+56 9 1234 5678' });

    try {
      await page.goto('/emergency');
      // Sign the user into the real Firebase Auth emulator BEFORE touching UI
      // that depends on Firestore (firestore.rules require request.auth != null).
      await signInBrowserViaCustomToken(page);

      // The page first mounted UNauthed (goto preceded sign-in), so
      // ProjectContext never ran its `members array-contains uid` query and
      // Emergency.tsx never read `isEmergencyActive` → AppMode stayed off
      // 'emergency' and the global SOSButton (gated on mode==='emergency')
      // never rendered (CI: getByTestId('sos-button') not found). Reload so the
      // app re-mounts with the Firebase session restored from persistence:
      // authed ProjectContext query → seeded project selected → Emergency
      // mirrors isEmergencyActive → AppMode='emergency' → SOSButton renders.
      await page.reload();
      await signInBrowserViaCustomToken(page);

      // The SOS control is an icon button whose accessible name is the full
      // aria-label "Botón SOS — mantener presionado 3 segundos". Its mere
      // presence proves AppMode flipped to 'emergency' off the seeded project.
      const sos = page.getByTestId('sos-button');
      await expect(sos).toBeVisible({ timeout: 20_000 });

      const box = await sos.boundingBox();
      if (!box) throw new Error('SOS button has no bounding box');
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;

      // 1) SHORT TAP must NOT fire the SOS POST. Hold ~300ms (< HOLD_MS=3000),
      //    then watch for ~1.2s that no /api/emergency/sos request is issued.
      let shortTapFired = false;
      const onShortTap = (req: { url: () => string; method: () => string }): void => {
        if (req.method() === 'POST' && req.url().includes('/api/emergency/sos')) {
          shortTapFired = true;
        }
      };
      page.on('request', onShortTap);
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.waitForTimeout(300);
      await page.mouse.up();
      await page.waitForTimeout(1_200);
      page.off('request', onShortTap);
      expect(
        shortTapFired,
        'a short tap (<3s) must NOT trigger the SOS POST',
      ).toBe(false);

      // 2) LONG-PRESS (≥3s) MUST fire the SOS POST and the server MUST record
      //    a real alert. We arm the response wait BEFORE pressing, hold the
      //    pointer down past HOLD_MS, and assert the server's real answer.
      const sosResponsePromise = page.waitForResponse(
        (res) =>
          res.url().includes('/api/emergency/sos') && res.request().method() === 'POST',
        { timeout: 20_000 },
      );

      await page.mouse.move(cx, cy);
      await page.mouse.down();
      let sosResponse;
      try {
        sosResponse = await sosResponsePromise;
      } finally {
        await page.mouse.up();
      }

      // The SOS POST must have authenticated + passed membership + written the
      // alert row server-side. verifyAuth (E2E header) + assertProjectMember
      // (seeded `members`) make this a real end-to-end write, not a stub.
      expect(sosResponse.status(), 'SOS endpoint must accept the alert').toBe(200);
      const payload = (await sosResponse.json()) as {
        ok?: boolean;
        alertId?: string;
        delivered?: boolean;
      };
      expect(payload.ok, 'server must confirm the SOS was recorded').toBe(true);
      expect(
        typeof payload.alertId === 'string' && payload.alertId.length > 0,
        'server must return the id of the persisted emergency_alerts doc',
      ).toBe(true);

      // The request body must carry the real selected project + the auth uid —
      // proof the live ProjectContext + FirebaseContext fed the button, not a
      // hardcoded fixture value.
      const sentBody = sosResponse.request().postDataJSON() as {
        type?: string;
        projectId?: string;
        uid?: string;
      };
      expect(sentBody.type).toBe('sos');
      expect(sentBody.projectId).toBe(seed.projectId);
      expect(sentBody.uid).toBe('e2e-user-001');
    } finally {
      await seed.cleanup();
    }
  });

  test('contactos de emergencia exponen enlaces tel: reales', async ({ page }) => {
    await loginAsTestUser(page);
    const seed = await seedProject({ emergencyActive: true });

    try {
      await page.goto('/emergency');
      await signInBrowserViaCustomToken(page);

      // Open the real emergency-contacts dialog and assert it renders genuine
      // dialable tel: links (SAMU 131, Bomberos 132, …). This is the human
      // fallback path a worker uses when the data path is degraded.
      await page.getByRole('button', { name: /Contactos de Emergencia/i }).first().click();
      const list = page.getByTestId('emergency-contacts-list');
      await expect(list).toBeVisible({ timeout: 10_000 });

      const samu = list.locator('a[href="tel:131"]');
      await expect(samu).toBeVisible();
      await expect(samu).toHaveText(/131/);

      // At least the canonical Chilean emergency numbers must be present.
      const telLinks = list.locator('a[href^="tel:"]');
      expect(await telLinks.count()).toBeGreaterThanOrEqual(3);
    } finally {
      await seed.cleanup();
    }
  });
});
