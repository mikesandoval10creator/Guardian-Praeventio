import type { Page } from '@playwright/test';

/**
 * Auth fixtures para los specs E2E (Sprint 19+, evolved Sprint K §2.24).
 *
 * Estrategia (post §2.24, 2026-05-21):
 *
 *   1. **Server-side auth** (Express `/api/*` endpoints): el backend
 *      `src/server/middleware/verifyAuth.ts` acepta `Authorization: E2E
 *      <secret>:<uid>` cuando `process.env.E2E_MODE === '1'` AND
 *      `process.env.NODE_ENV !== 'production'`. El header se popula en
 *      localStorage (`gp.e2e.auth_header`) via page.addInitScript.
 *
 *   2. **Client-side auth** (Firestore client SDK queries): para que
 *      `firestore.rules:25 (request.auth != null + email_verified == true)`
 *      pase, el browser TIENE que firmar al user real en Firebase Auth
 *      client SDK. Conseguimos esto vía:
 *        a. firebase-admin (Node side, fixture) mintea un custom token
 *           con claims `{email_verified: true}` contra el Auth Emulator
 *           (detectado por env var `FIREBASE_AUTH_EMULATOR_HOST`).
 *        b. En el browser, page.evaluate llama `signInWithCustomToken
 *           (auth, customToken)` — la app se conecta al Auth Emulator
 *           vía `connectAuthEmulator()` en src/services/firebase.ts
 *           (gated por `import.meta.env.MODE === 'test'`).
 *        c. `auth.currentUser` se popula, `onAuthStateChanged` listener
 *           dispara, los queries Firestore pasan rules.
 *
 * Producción jamás activa este flujo:
 *   - verifyAuth tira fatal si `NODE_ENV=production && E2E_MODE=1`
 *     (gate en boot, ver src/server/middleware/verifyAuth.ts:49).
 *   - El frontend solo lee `gp.e2e.auth_header` cuando
 *     `import.meta.env.MODE === 'test'` (ver `src/lib/e2eAuth.ts`).
 *   - connectAuthEmulator() en firebase.ts también gated por MODE=test.
 *   - `--mode test` solo se aplica con `vite build --mode test` en el
 *     workflow E2E job (e2e.yml job e2e-full-stack), nunca en deploy.yml
 *     productivo.
 *
 * Llaves en localStorage (escritas via page.addInitScript):
 *   - `gp.e2e.user`         → JSON serializado de `TestUser`
 *   - `gp.e2e.token`        → string `<secret>:<uid>` (sin prefijo "E2E ")
 *   - `gp.e2e.auth_header`  → string `E2E <secret>:<uid>` (header listo)
 */

export interface TestUser {
  uid: string;
  email: string;
  displayName: string;
  roles: string[];
  projectIds: string[];
  tenantId: string;
}

export const DEFAULT_TEST_USER: TestUser = {
  uid: 'e2e-user-001',
  email: 'e2e@praeventio.test',
  displayName: 'E2E Test User',
  roles: ['supervisor'],
  projectIds: ['e2e-project-alpha'],
  tenantId: 'e2e-tenant',
};

/**
 * Format a secret/uid pair into the wire-format auth header string the
 * backend's E2E_MODE branch expects: `E2E <secret>:<uid>`.
 *
 * Pure function, exported separately so tests can assert the header shape
 * without spinning up a Playwright Page.
 */
export function buildE2EAuthHeader(secret: string, uid: string): string {
  return `E2E ${secret}:${uid}`;
}

/**
 * Inject a fake auth token + user fixture into localStorage before the page
 * loads. Use BEFORE `page.goto(...)`.
 *
 * Reads `process.env.E2E_TEST_SECRET` to build the token. If unset, throws
 * — the caller (typically a Playwright fixture or test setup) is expected
 * to set the env in the global config.
 *
 * §2.24 (2026-05-21): además del fixture localStorage (server-side header),
 * minteamos un custom token via firebase-admin (Auth Emulator REST API
 * auto-detected por FIREBASE_AUTH_EMULATOR_HOST). El token incluye claim
 * `email_verified: true` para que firestore.rules:25 lo acepte. El browser
 * llama `signInWithCustomToken` después de `page.goto` mediante
 * `signInBrowserViaCustomToken` helper (ver abajo).
 */
export async function loginAsTestUser(
  page: Page,
  overrides: Partial<TestUser> = {},
): Promise<TestUser> {
  const user: TestUser = { ...DEFAULT_TEST_USER, ...overrides };
  const e2eSecret = process.env.E2E_TEST_SECRET;
  if (!e2eSecret) {
    throw new Error(
      'E2E_TEST_SECRET env var not set — required for E2E auth fixture. ' +
        'Set it in your shell or in playwright.config.ts webServer env.',
    );
  }
  const token = `${e2eSecret}:${user.uid}`;
  const authHeader = buildE2EAuthHeader(e2eSecret, user.uid);

  // §2.24 — mintea custom token via firebase-admin (Auth Emulator).
  // Lazy import para no romper specs que NO usan Auth Emulator (smoke).
  let customToken: string | null = null;
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    try {
      customToken = await mintCustomTokenViaEmulator(user);
    } catch (err) {
      // Si firebase-admin no está disponible o el emulator no responde,
      // logueamos warning pero NO bloqueamos — el spec puede correr con
      // solo el server-side header (cubre /api/* endpoints).
      // eslint-disable-next-line no-console
      console.warn('[loginAsTestUser] custom token mint failed (firestore.rules queries may deny):', err);
    }
  }

  await page.addInitScript(
    (payload: {
      userData: TestUser;
      token: string;
      authHeader: string;
      customToken: string | null;
    }) => {
      // Runs in browser context — no Node imports allowed.
      localStorage.setItem('gp.e2e.user', JSON.stringify(payload.userData));
      localStorage.setItem('gp.e2e.token', payload.token);
      localStorage.setItem('gp.e2e.auth_header', payload.authHeader);
      // §2.24 — el custom token queda en localStorage para que un init
      // script del bundle (cuando la app monte) pueda invocar signIn
      // WithCustomToken. Como alternativa, el spec llama
      // signInBrowserViaCustomToken(page) explícito post-goto.
      if (payload.customToken) {
        localStorage.setItem('gp.e2e.custom_token', payload.customToken);
      }
    },
    { userData: user, token, authHeader, customToken },
  );

  return user;
}

/**
 * §2.24 (2026-05-21) — Mintea custom token via firebase-admin contra el
 * Auth Emulator. firebase-admin auto-detecta FIREBASE_AUTH_EMULATOR_HOST
 * (set en e2e.yml + playwright.config.ts). Incluye claim
 * `email_verified: true` para satisfacer firestore.rules:29.
 *
 * Lazy import: firebase-admin solo se carga si E2E_FULL_STACK runs (no
 * lo cargamos en smoke tests que solo usan localStorage header).
 */
async function mintCustomTokenViaEmulator(user: TestUser): Promise<string> {
  // §2.24 fix (2026-05-22, post-CI #461) — dynamic ESM import. Playwright
  // tests corren bajo ESM (`type: module` via tsx loader), entonces
  // `require()` NO está definido. `import()` resuelve a la default export
  // de firebase-admin con CJS-interop.
  const adminModule = await import('firebase-admin');
  // firebase-admin exporta default O namespace (depende de cómo Node lo
  // resuelve). Soportamos ambos shapes.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin: any =
    (adminModule as unknown as { default?: unknown }).default ?? adminModule;
  if (!admin.apps?.length) {
    admin.initializeApp({
      projectId: process.env.GOOGLE_CLOUD_PROJECT ?? 'demo-test',
    });
  }
  return admin.auth().createCustomToken(user.uid, {
    email_verified: true,
    email: user.email,
    displayName: user.displayName,
    role: user.roles[0] ?? 'supervisor',
    tenantId: user.tenantId,
  });
}

/**
 * §2.24 (2026-05-21) — Helper que el SPEC llama POST-goto para que el
 * browser firme al user en el Firebase Auth client SDK. Hace que
 * `auth.currentUser` se popule y los queries Firestore pasen rules.
 *
 * El custom token ya quedó en `localStorage.gp.e2e.custom_token` por
 * `loginAsTestUser`. Esta función lo lee, llama signInWithCustomToken,
 * y espera a que `auth.currentUser` no sea null (hasta 5s timeout).
 *
 * Patrón de uso en spec:
 *
 * ```ts
 * await loginAsTestUser(page);
 * await page.goto('/dashboard');
 * await signInBrowserViaCustomToken(page);  // <- nuevo
 * await expect(page.getByText('Mi proyecto')).toBeVisible();
 * ```
 *
 * Idempotente: si auth.currentUser ya está set (re-uso de page), no
 * llama signIn de nuevo.
 */
export async function signInBrowserViaCustomToken(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const customToken = window.localStorage.getItem('gp.e2e.custom_token');
    if (!customToken) {
      // Spec corrió sin Auth Emulator — silent skip, los specs que sólo
      // tocan UI sin Firestore queries pasan igual via el shim §2.19.
      return;
    }
    // Dynamic import para no agrandar el bundle main con firebase/auth.
    const { getAuth, signInWithCustomToken } = await import('firebase/auth');
    const auth = getAuth();
    if (auth.currentUser) return; // ya firmado
    await signInWithCustomToken(auth, customToken);
    // Wait hasta 5s para que onAuthStateChanged dispare.
    const deadline = Date.now() + 5000;
    while (!auth.currentUser && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
  });
}
