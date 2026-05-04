import type { Page } from '@playwright/test';

/**
 * Auth fixtures stub para los specs E2E de Sprint 19+.
 *
 * Estrategia: en E2E mockeamos Firebase Auth poblando localStorage
 * con un user fixture, sin pasar por el flujo real (Google sign-in,
 * WebAuthn). El backend del E2E (server.ts levantado via webServer)
 * acepta tokens fake firmados con `process.env.E2E_TEST_SECRET`.
 *
 * Esto es DIFERENTE al flujo de producción y SOLO se usa cuando
 * `process.env.NODE_ENV === 'test'` o `E2E_MODE === '1'`.
 *
 * Documentar en docs/testing/playwright.md cómo el server side
 * acepta tokens fake (con guard estricto para que NO funcionen
 * en prod).
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
 * Inyecta un fake auth token + user data en localStorage antes de
 * cargar la página, simulando un usuario logueado.
 *
 * Sprint 19+ implementación:
 *   1. Backend gemini.ts y otros routes deben aceptar header
 *      `Authorization: E2E ${E2E_TEST_SECRET}` solo cuando
 *      process.env.E2E_MODE === '1'.
 *   2. Generar fake token firmado en frontend mock que el handler
 *      acepta gracias al guard.
 */
export async function loginAsTestUser(page: Page, overrides: Partial<TestUser> = {}): Promise<TestUser> {
  const user = { ...DEFAULT_TEST_USER, ...overrides };
  await page.addInitScript((userData: TestUser) => {
    localStorage.setItem('gp.e2e.user', JSON.stringify(userData));
    localStorage.setItem('gp.e2e.token', 'e2e-fake-token-' + userData.uid);
  }, user);
  return user;
}
