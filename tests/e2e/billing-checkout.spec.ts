import { test, expect } from '@playwright/test';
import admin from 'firebase-admin';
import { loginAsTestUser, signInBrowserViaCustomToken } from './fixtures/auth';
import { seedProject } from './fixtures/seed';

/**
 * Billing checkout (Bloque C2) — Pricing → select a tier → pay with Webpay →
 * `POST /api/billing/checkout` creates a REAL invoice.
 *
 * Drives the REAL pricing UI and asserts the UN-GAMEABLE server signal: the
 * actual POST fires through verifyAuth + idempotencyKey, the server WRITES
 * `invoices/{id}` to Firestore stamping `createdBy`/`createdByEmail` from the
 * verified token — the browser NEVER sends 'e2e@praeventio.test' (it lives only
 * in the verifyAuth E2E branch), so a hollow handler that 200s without the write
 * cannot fabricate it — and audits the event (`audit_logs` action
 * 'billing.checkout'). Under the E2E harness the Webpay adapter is unconfigured,
 * so the server falls back to status 'pending-config' with no external redirect;
 * the invoice write already happened BEFORE the adapter call, so this is the
 * correct core path and needs no payment provider. Requires the full stack
 * (`npm run test:e2e:full`).
 */
test.describe('Billing checkout — create invoice (real flow)', () => {
  test.skip(
    process.env.E2E_FULL_STACK !== '1',
    'Requires full E2E stack (preview + Express + Firestore/Auth emulator). Run `npm run test:e2e:full`.',
  );

  test('elegir un plan y pagar con Webpay crea una invoice real con identidad estampada por el servidor', async ({ page }) => {
    await loginAsTestUser(page);
    // seedProject() initializes firebase-admin against the emulator, so
    // admin.firestore() below reads the same store the server writes to.
    const seed = await seedProject();

    try {
      // Force Chile so the Webpay/Khipu method chooser renders. CL is the
      // default, but ?country=CL is explicit for CI locale-independence.
      await page.goto('/pricing?country=CL');
      await signInBrowserViaCustomToken(page);

      // Select a mid, non-free, non-premium tier → opens the method chooser.
      // Gate on the ENABLED button before clicking (a disabled button click is a
      // silent no-op) so the flow is deterministic on the slow CI runner.
      const selectOro = page.getByTestId('tier-select-oro');
      await expect(selectOro).toBeVisible({ timeout: 15_000 });
      await expect(selectOro).toBeEnabled({ timeout: 15_000 });
      await selectOro.click();

      // Method chooser modal → pay with Webpay → the REAL checkout POST.
      const webpay = page.getByTestId('checkout-method-webpay');
      await expect(webpay).toBeVisible({ timeout: 10_000 });

      const checkoutResponsePromise = page.waitForResponse(
        (res) =>
          res.url().includes('/api/billing/checkout') &&
          res.request().method() === 'POST',
        { timeout: 20_000 },
      );
      await webpay.click();
      const checkoutResponse = await checkoutResponsePromise;

      const checkoutStatus = checkoutResponse.status();
      const rawBody = await checkoutResponse.text();
      expect(checkoutResponse.ok(), `checkout must be 200 — got ${checkoutStatus}: ${rawBody}`).toBe(true);
      const body = JSON.parse(rawBody) as {
        invoiceId?: string;
        status?: string;
        invoice?: { totals?: { total?: number } };
      };
      const invoiceId = body.invoiceId;
      expect(
        typeof invoiceId === 'string' && invoiceId.length > 0,
        'server must return an invoiceId',
      ).toBe(true);
      // Adapter unconfigured under E2E → server returns 'pending-config'. The
      // invoice write happened before the adapter branch, so this is expected.
      expect(body.status).toBe('pending-config');
      expect(body.invoice?.totals?.total ?? 0).toBeGreaterThan(0);

      // ── UN-GAMEABLE server signal: read the invoice straight from the
      // Firestore emulator. These fields are server-stamped and
      // client-unwritable (firestore.rules default-deny), so a browser / E2E
      // context can never fabricate them.
      const db = admin.firestore();
      const invRef = db.collection('invoices').doc(invoiceId!);
      // Absorb the emulator write latency between the 200 and the doc landing.
      await expect
        .poll(async () => (await invRef.get()).exists, {
          intervals: [200, 500, 1000],
          timeout: 8_000,
        })
        .toBe(true);
      const inv = (await invRef.get()).data() as Record<string, any>;
      expect(inv.status).toBe('pending-payment');
      expect(inv.createdBy).toBe('e2e-user-001'); // server-stamped from the token
      expect(inv.createdByEmail).toBe('e2e@praeventio.test'); // impossible to spoof from the client
      expect(inv.createdAt, 'createdAt must be a serverTimestamp').toBeTruthy();

      // Append-only compliance trail (firestore.rules: create-only). Query the
      // single nested field (no composite index needed in the emulator) and
      // filter the action in JS.
      const logs = await db
        .collection('audit_logs')
        .where('details.invoiceId', '==', invoiceId)
        .get();
      const checkoutLog = logs.docs
        .map((d) => d.data() as Record<string, any>)
        .find((d) => d.action === 'billing.checkout');
      expect(checkoutLog, 'a billing.checkout audit row must exist for this invoice').toBeTruthy();
      expect(checkoutLog!.module).toBe('billing');
      expect(checkoutLog!.userId).toBe('e2e-user-001'); // server-stamped, never client
    } finally {
      await seed.cleanup();
    }
  });
});
