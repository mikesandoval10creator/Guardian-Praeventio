import { test, expect } from '@playwright/test';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * SOSButton E2E (Sprint 14 → Sprint 19 unskip):
 *   3-second long-press → write a la collection emergency_alerts +
 *   FCM notify supervisores. NO debe disparar con tap corto.
 *
 * Requiere el stack completo. Activar con `npm run test:e2e:full`.
 */
// FIXME (2026-05-30, layer 2): the auth/project ROOT CAUSE is fixed in this PR
// — firebase.ts uses projectId 'demo-test' under MODE=test so the custom-token
// audience matches, signInWithCustomToken succeeds, ProjectContext loads the
// seeded project and the /emergency route now RENDERS (no more "no active
// project"). The SOS button locator is fixed too (it is an icon button labelled
// "Botón SOS — …", matched below). What remains is feature-level verification
// against the live render: the long-press "Alerta enviada" toast and the tel:
// fallback (which expects a seeded emergency contact number). Now
// LOCALLY-ITERABLE — `JAVA_HOME=<Temurin-21> E2E_FULL_STACK=1 … playwright test`
// boots the emulator (Java 21 + firebase-tools 15). Un-fixme as each assertion
// is reconciled with the feature.
//
// DIAGNOSIS (2026-06-02, ran locally 3× w/ Temurin-21 emulator + test-mode dist
// that does carry the demo-test projectId fix): the authenticated app SHELL does
// not fully render in headless for this project-scoped route. After granting
// geolocation + a position (which clears the "Geocerca desactivada" gate) and
// with auth working, the page snapshot collapses to a single `button > img` and
// `getByRole('button', { name: /Activar modo emergencia/i })` (the ModeSwitcher
// dock that toggles emergency mode — RootLayout.tsx:417) never mounts → the
// mode-gated SOSButton can't appear. The WebServer logs `[EnvironmentBackend]
// Error updating context: fetch failed`; the shell may be blocked on an
// environment/weather context fetch that fails with no outbound network. The
// geolocation-grant + emergency-mode-entry steps coded below ARE the correct
// reconciliation — the remaining blocker is app-side (the shell should degrade
// gracefully when the environment fetch fails). test 2 (tel:) additionally needs
// the rewrite noted on it.
test.describe.fixme('SOSButton long-press', () => {
  test('long-press de 3s dispara alerta; tap corto no', async ({ page }) => {
    test.skip(
      process.env.E2E_FULL_STACK !== '1',
      'Requires full E2E stack (preview + Express + Firestore Emulator). Run `npm run test:e2e:full`.',
    );

    await loginAsTestUser(page);
    const seed = await seedProject();

    try {
      // The emergency page gates behind a geolocation-permission check
      // (renders "Geocerca desactivada — Concede permiso de ubicación" until
      // granted), which suppresses the RootLayout shell incl. the floating
      // ModeSwitcher dock. Grant geolocation + a position BEFORE navigating
      // so the shell (and thus the mode switcher + SOS trigger) renders.
      await page.context().grantPermissions(['geolocation']);
      await page.context().setGeolocation({ latitude: -33.45, longitude: -70.66 });
      await page.goto(`/projects/${seed.projectId}/emergency`);
      // §2.24 fix (2026-05-22) — wait barrier: signa al user en Firebase
      // Auth real (via Auth Emulator) ANTES de buscar elementos UI que
      // dependen de Firestore queries (firestore.rules:25 require auth).
      await signInBrowserViaCustomToken(page);

      // SOSButton renders ONLY in emergency mode — RootLayout gates it on
      // `useAppMode().mode === 'emergency'` (it is not tied to the /emergency
      // route). Activate emergency mode via the floating ModeSwitcher dock
      // (RootLayout.tsx:417 — `fixed bottom-4 right-4`, always visible
      // post-login) so the SOS trigger mounts.
      await page
        .getByRole('button', { name: /Activar modo emergencia/i })
        .click();

      // The SOS control is an icon button whose accessible name is the full
      // aria-label "Botón SOS — mantener presionado 3 segundos" (not a bare
      // "SOS" text node), so match on the label rather than an exact "SOS".
      const sos = page.getByRole('button', { name: /Bot[oó]n SOS/i });
      await expect(sos).toBeVisible();

      // Tap corto NO debe disparar.
      await sos.click({ delay: 200 });
      await expect(page.getByText(/Alerta enviada/i)).not.toBeVisible({ timeout: 1500 });

      // Long-press 3s SÍ dispara. Sprint 33 audit P0 — replaced the bare
      // `waitForTimeout(3200)` (event-based wait per audit recommendation).
      // The SOSButton's HOLD_MS is 3000ms; CI runners can stall the React
      // re-render past that, so we hold a bit beyond and then poll for
      // the toast directly rather than racing on a fixed sleep. Total
      // timeout caps at 10s so an actual regression still fails fast.
      const box = await sos.boundingBox();
      if (!box) throw new Error('SOS button has no bounding box');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // Hold deterministically past HOLD_MS (3000ms) + RAF slack. We use a
      // single waitForTimeout here (NOT a poll) because SOSButton's fire
      // logic only triggers AFTER HOLD_MS has elapsed — polling earlier
      // would observe nothing. 3500ms gives 500ms of CI jitter slack.
      await page.waitForTimeout(3500);
      await page.mouse.up();

      // Now poll for the toast (event-based). expect.toBeVisible already
      // polls under the hood with the default Playwright interval.
      await expect(page.getByText(/Alerta enviada/i)).toBeVisible({ timeout: 7_000 });
    } finally {
      await seed.cleanup();
    }
  });

  // FIXME (2026-06-02, premise drift verified locally w/ Temurin-21 emulator):
  // this test expects a visible <a> labelled "Llamar emergencia" with an
  // href="tel:…" when geolocation is blocked. The REAL SOSButton tel: fallback
  // (SOSButton.tsx:146-149) is a `window.location.href = tel:…` NAVIGATION that
  // fires on FETCH FAILURE of POST /api/emergency/sos — not on geo-block, and
  // not as a rendered link. No "Llamar emergencia" tel: anchor exists in the
  // emergency tree (the only tel: <a> is Driving.tsx:299). To un-fixme:
  // (1) seed `phone` in seedProject, (2) route.fulfill POST /api/emergency/sos
  // with 500 to force the fallback, (3) assert the tel: navigation (page.url()
  // / waitForRequest) instead of querying for a link element.
  test.fixme('fallback a tel: cuando geolocation está bloqueada', async ({ page, context }) => {
    test.skip(
      process.env.E2E_FULL_STACK !== '1',
      'Requires full E2E stack (preview + Express + Firestore Emulator). Run `npm run test:e2e:full`.',
    );

    // Bloquear permission de geolocation antes de cargar la página.
    await context.clearPermissions();
    await loginAsTestUser(page);
    const seed = await seedProject();

    try {
      await page.goto(`/projects/${seed.projectId}/emergency`);
      // §2.24 fix (2026-05-22) — wait barrier: signa al user en Firebase
      // Auth real (via Auth Emulator) ANTES de buscar elementos UI que
      // dependen de Firestore queries (firestore.rules:25 require auth).
      await signInBrowserViaCustomToken(page);

      const telLink = page.getByRole('link', { name: /Llamar emergencia/i });
      await expect(telLink).toBeVisible();
      const href = await telLink.getAttribute('href');
      expect(href).toMatch(/^tel:/);
    } finally {
      await seed.cleanup();
    }
  });
});
