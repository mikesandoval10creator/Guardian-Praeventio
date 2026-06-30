import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config para Guardian Praeventio.
 *
 * Tres ejes de cobertura:
 * - Críticos (chromium desktop) — corren en cada PR.
 * - Móvil (chromium emulando Android viewport) — corren en cada PR; cubren Driving + Emergency.
 * - Cross-browser (firefox + webkit) — corren solo en `npm run test:e2e:full` y nightly.
 *
 * Servidor: por default arranca `npm run preview` que sirve el bundle estático
 * en :4173. Para tests que requieren backend, ver `tests/e2e/fixtures/server.ts`
 * que monta el server Express en otro puerto.
 *
 * Auth: tests usan tokens mockeados via `tests/e2e/fixtures/auth.ts`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
    process.env.CI ? ['github'] : ['line'],
  ],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // No "headless: false" — siempre headless en Playwright config (debug usa --headed flag).
    //
    // Locale es-CL (2026-05-30) — sin esto el browser headless hereda el locale
    // del runner (en-US en CI ubuntu), y como `src/i18n/index.ts` detecta por
    // `navigator` (order: ['localStorage','navigator']) con `load:'currentOnly'`,
    // la UI i18n'd renderiza en INGLÉS mientras el copy hardcoded del body queda
    // en español → render mixto que rompe todo locator que asevera copy ES
    // (landing hero/CTA, Settings "Seguridad y Privacidad", etc.). Fijamos el
    // locale del usuario primario (Chile) para que la suite ejercite la UX real
    // del mercado objetivo y los locators de copy español sean válidos.
    locale: 'es-CL',
    extraHTTPHeaders: { 'Accept-Language': 'es-CL,es;q=0.9' },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Tests que arrancan con `desktop-only-` se restringen a este project.
    },
    {
      name: 'mobile-android',
      use: { ...devices['Pixel 7'] },
      // Para Driving + Emergency UI que dependen de viewport móvil.
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      // Solo nightly + full run.
      grep: /@cross-browser/,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      grep: /@cross-browser/,
    },
  ],

  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : process.env.E2E_FULL_STACK === '1'
      ? [
          {
            command: 'npm run preview',
            url: 'http://localhost:4173',
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
          {
            // Express con E2E_MODE=1 — tests que tocan /api/*.
            //
            // 2026-05-18: tsx compila ~35+ routers en cada cold start (no
            // hay build de servidor todavía — Fase 5.3 del plan). En CI la
            // boot real es 60-90s. Subir timeout a 150_000 da headroom sin
            // ocultar regresiones genuinas.
            // §E2E-harness fix (2026-06-27): pin FIRESTORE_EMULATOR_HOST +
            // GOOGLE_CLOUD_PROJECT=demo-test so the Express Firestore client
            // targets the SAME emulator project/namespace the seed writes to
            // (tests/e2e/fixtures/seed.ts). Without these, server.ts inited
            // admin with firebase-applet-config.json's projectId + named DB,
            // a different namespace -> assertProjectMember 403 -> the 4 fixme'd
            // specs. FIREBASE_AUTH_EMULATOR_HOST mirrors the auth fixture.
            command: 'npx cross-env NODE_ENV=test E2E_MODE=1 E2E_TEST_SECRET=e2e-test-secret-do-not-use-in-prod PORT=3000 GOOGLE_CLOUD_PROJECT=demo-test FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npx tsx server.ts',
            url: 'http://localhost:3000/api/health',
            reuseExistingServer: !process.env.CI,
            timeout: 150_000,
          },
          {
            // Firestore + Auth Emulator — tests que escriben docs reales +
            // necesitan auth real para satisfacer firestore.rules.
            //
            // §2.24 fix (2026-05-21) — agregamos `,auth` al --only para que
            // el Auth Emulator corra en :9099. firestore.rules:25 requiere
            // `request.auth != null`; sin Auth Emulator, signInWithCustomToken
            // del fixture E2E falla y los 5 specs §2.21 quedan denied.
            //
            // 2026-05-18: emulator cold start en CI ubuntu-latest mide
            // ~40-80s tras descarga JAR + JVM init (Java 17 + firebase-tools).
            // Bumpeamos 90→150s consistente con Express webServer arriba.
            //
            // playwright-config waits sólo en :8080 (Firestore) porque el Auth
            // Emulator arranca casi simultáneo y el fixture maneja retry.
            command: 'npx firebase emulators:start --only firestore,auth --project demo-test',
            url: 'http://localhost:8080',
            reuseExistingServer: !process.env.CI,
            timeout: 150_000,
          },
        ]
      : {
          // Default (CI básico + dev rápido): solo preview estático en :4173.
          command: 'npm run preview',
          url: 'http://localhost:4173',
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
});
