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
// Sprint E2E-99 — route-fixes CONSERVADOS (/emergency a nivel raíz; locator tel:
// robusto a[href^="tel:"]) y data-testid (sos-button, sos-toast) ya en el
// componente. PERO la aserción feature-level (el enlace tel: no renderiza en
// /emergency bajo el harness full-stack de CI — requiere ProjectContext que el
// fixture no monta) NO es verificable en CI todavía → re-fixme hasta reconciliar.
test.describe.fixme('SOSButton long-press', () => {
  test('long-press de 3s dispara alerta; tap corto no', async ({ page }) => {
    test.skip(
      process.env.E2E_FULL_STACK !== '1',
      'Requires full E2E stack (preview + Express + Firestore Emulator). Run `npm run test:e2e:full`.',
    );

    await loginAsTestUser(page);
    const seed = await seedProject();

    try {
      await page.goto('/emergency');
      // §2.24 fix (2026-05-22) — wait barrier: signa al user en Firebase
      // Auth real (via Auth Emulator) ANTES de buscar elementos UI que
      // dependen de Firestore queries (firestore.rules:25 require auth).
      await signInBrowserViaCustomToken(page);

      // The SOS control is an icon button whose accessible name is the full
      // aria-label "Botón SOS — mantener presionado 3 segundos" (not a bare
      // "SOS" text node), so match on the label rather than an exact "SOS".
      const sos = page.getByRole('button', { name: /Bot[oó]n SOS/i });
      await expect(sos).toBeVisible();

      // Tap corto NO debe disparar.
      await sos.click({ delay: 200 });
      await expect(page.getByText(/Alerta enviada/i)).not.toBeVisible({ timeout: 1500 });

      // Long-press ≥3s dispara la alerta. Anti-flaky: SIN `waitForTimeout`
      // fijo. El confirm-timer del SOSButton dispara a HOLD_MS (3000ms)
      // MIENTRAS el puntero sigue abajo, así que mantenemos presionado y
      // polleamos el toast directamente (web-first, event-based). El timeout
      // cubre HOLD_MS + el write async de la alerta con holgura de CI; si hay
      // regresión real, falla rápido. El pointer-up va en `finally` para no
      // dejar el botón presionado si la aserción falla.
      const box = await sos.boundingBox();
      if (!box) throw new Error('SOS button has no bounding box');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      try {
        await expect(page.getByText(/Alerta enviada/i)).toBeVisible({ timeout: 10_000 });
      } finally {
        await page.mouse.up();
      }
    } finally {
      await seed.cleanup();
    }
  });

  test('fallback a tel: cuando geolocation está bloqueada', async ({ page, context }) => {
    test.skip(
      process.env.E2E_FULL_STACK !== '1',
      'Requires full E2E stack (preview + Express + Firestore Emulator). Run `npm run test:e2e:full`.',
    );

    // Bloquear permission de geolocation antes de cargar la página.
    await context.clearPermissions();
    await loginAsTestUser(page);
    const seed = await seedProject();

    try {
      await page.goto('/emergency');
      // §2.24 fix (2026-05-22) — wait barrier: signa al user en Firebase
      // Auth real (via Auth Emulator) ANTES de buscar elementos UI que
      // dependen de Firestore queries (firestore.rules:25 require auth).
      await signInBrowserViaCustomToken(page);

      // El nombre accesible de los enlaces de contacto es el número (131, 132…),
      // no el rótulo (SAMU/Bomberos), así que matcheamos por href tel: directo.
      const telLink = page.locator('a[href^="tel:"]').first();
      await expect(telLink).toBeVisible();
      const href = await telLink.getAttribute('href');
      expect(href).toMatch(/^tel:/);
    } finally {
      await seed.cleanup();
    }
  });
});
