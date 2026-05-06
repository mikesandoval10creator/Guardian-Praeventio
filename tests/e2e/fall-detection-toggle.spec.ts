import { test, expect } from '@playwright/test';
import { loginAsTestUser } from './fixtures/auth';

/**
 * FallDetection opt-in (Sprint 17b → Sprint 19 unskip):
 *   Default OFF en localStorage / IndexedDB. Toggle en Settings.
 *   Sin activación, el monitor no arranca. La preferencia persiste
 *   tras reload (idb-keyval).
 */
test.describe('FallDetection toggle preference', () => {
  test('toggle activa la detección y persiste tras reload', async ({ page }) => {
    test.skip(
      process.env.E2E_FULL_STACK !== '1',
      'Requires full E2E stack (preview + Express + Firestore Emulator). Run `npm run test:e2e:full`.',
    );

    // Sprint 34 — robustness pass per audit P0 §1.4 (continue-on-error
    // removed). Replaces implicit auto-waits with explicit `waitFor`
    // anchored on role+name so el spec falla rápido y claro si el
    // collapsable de Settings no expande, en vez de quedar flaky.
    await loginAsTestUser(page);
    await page.goto('/settings');

    // Sprint 36 — locator robusto post-Sprint 34 E7 refactor.
    // El sidebar ahora usa IDs estables (`activeSection: SettingsSectionId`)
    // y el toggle en JSX está marcado como `<button role="switch">`. El
    // spec previo usaba `getByRole('button', { name: ... })`, lo cual no
    // resuelve elementos con `role="switch"` explícito (Playwright
    // respeta el role override). Cambiamos a `getByRole('switch')` que
    // matchea el ARIA real del componente. El name se mantiene como
    // regex i18n-tolerante por si el aria-label en algún momento
    // cambia de cadena (el español default sigue siendo el mismo, pero
    // así sobrevivimos cualquier ajuste menor de wording).
    const securitySection = page.getByRole('button', { name: /Seguridad y Privacidad/i }).first();
    await securitySection.waitFor({ state: 'visible', timeout: 10_000 });
    await securitySection.click();

    const fallSwitch = page.getByRole('switch', { name: /detecci[oó]n de ca[ií]da/i });
    await fallSwitch.waitFor({ state: 'visible', timeout: 10_000 });
    // aria-checked es la fuente de verdad del estado (no el aria-label).
    await expect(fallSwitch).toHaveAttribute('aria-checked', 'false');

    await fallSwitch.click();

    // El switch flip dispara un write a idb-keyval; expect.poll es más
    // robusto que un solo expect contra el race condition del aria-busy.
    await expect.poll(
      async () => fallSwitch.getAttribute('aria-checked'),
      { timeout: 8_000, intervals: [200, 400, 800] },
    ).toBe('true');

    // Reload — la preferencia debe sobrevivir gracias a idb-keyval.
    await page.reload();
    const securitySection2 = page.getByRole('button', { name: /Seguridad y Privacidad/i }).first();
    await securitySection2.waitFor({ state: 'visible', timeout: 10_000 });
    await securitySection2.click();
    const fallSwitchReloaded = page.getByRole('switch', { name: /detecci[oó]n de ca[ií]da/i });
    await expect(fallSwitchReloaded).toBeVisible({ timeout: 10_000 });
    await expect(fallSwitchReloaded).toHaveAttribute('aria-checked', 'true');
  });
});
