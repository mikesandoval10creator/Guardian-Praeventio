import type { Page } from '@playwright/test';
import { loginAsTestUser, signInBrowserViaCustomToken, type TestUser } from './auth';

/**
 * Sprint E2E-99 — helper reutilizable de navegación autenticada.
 *
 * Combina loginAsTestUser (header fixture + custom token) + page.goto +
 * signInBrowserViaCustomToken en una sola llamada, para no repetir el
 * patrón en cada spec.
 */
export interface NavigateOptions {
  userOverrides?: Partial<TestUser>;
  waitForSelector?: string;
  timeout?: number;
}

export async function navigateAuthenticated(
  page: Page,
  path: string,
  options: NavigateOptions = {},
): Promise<TestUser> {
  const user = await loginAsTestUser(page, options.userOverrides ?? {});
  await page.goto(path);
  await signInBrowserViaCustomToken(page);
  if (options.waitForSelector) {
    await page.waitForSelector(options.waitForSelector, {
      state: 'visible',
      timeout: options.timeout ?? 15_000,
    });
  }
  return user;
}
