import type { Page } from '@playwright/test';

/**
 * Auth fixtures para los specs E2E (Sprint 19+).
 *
 * Estrategia: en E2E mockeamos Firebase Auth poblando localStorage con un
 * user fixture y un token sintético. El backend (`src/server/middleware/
 * verifyAuth.ts`) acepta el header `Authorization: E2E <secret>:<uid>` SOLO
 * cuando `process.env.E2E_MODE === '1'` AND `process.env.NODE_ENV !==
 * 'production'`. El secret lo lee del env del proceso de Playwright (no
 * está expuesto al navegador).
 *
 * Producción jamás activa este flujo: el guard en verifyAuth tira fatal en
 * boot si detecta `NODE_ENV=production && E2E_MODE=1` simultáneamente, y
 * además el frontend solo lee `gp.e2e.auth_header` cuando `import.meta.env
 * .MODE === 'test'` (ver `src/lib/e2eAuth.ts`).
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

  await page.addInitScript(
    (payload: { userData: TestUser; token: string; authHeader: string }) => {
      // Runs in browser context — no Node imports allowed.
      localStorage.setItem('gp.e2e.user', JSON.stringify(payload.userData));
      localStorage.setItem('gp.e2e.token', payload.token);
      localStorage.setItem('gp.e2e.auth_header', payload.authHeader);
    },
    { userData: user, token, authHeader },
  );

  return user;
}
