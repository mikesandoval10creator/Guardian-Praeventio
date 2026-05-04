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
            command: 'npx cross-env NODE_ENV=test E2E_MODE=1 E2E_TEST_SECRET=e2e-test-secret-do-not-use-in-prod PORT=3000 npx tsx server.ts',
            url: 'http://localhost:3000/health',
            reuseExistingServer: !process.env.CI,
            timeout: 90_000,
          },
          {
            // Firestore Emulator — tests que escriben docs reales.
            command: 'npx firebase emulators:start --only firestore --project demo-test',
            url: 'http://localhost:8080',
            reuseExistingServer: !process.env.CI,
            timeout: 90_000,
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
