// Praeventio Guard — Sprint 19 / F-B01.
//
// Vitest unit tests for the `loginAsTestUser` Playwright fixture. We
// validate the side-effect contract (localStorage init script payload)
// without booting a real browser — by capturing what `page.addInitScript`
// would have queued and re-running it in a synthetic localStorage shim.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loginAsTestUser,
  DEFAULT_TEST_USER,
  buildE2EAuthHeader,
} from '../../tests/e2e/fixtures/auth.js';
import type { Page } from '@playwright/test';

interface FakeLocalStorage {
  store: Map<string, string>;
  setItem: (key: string, value: string) => void;
  getItem: (key: string) => string | null;
}

interface FakeWindow {
  localStorage: FakeLocalStorage;
}

function createFakeStorage(): FakeLocalStorage {
  const store = new Map<string, string>();
  return {
    store,
    setItem(key, value) {
      store.set(key, value);
    },
    getItem(key) {
      return store.get(key) ?? null;
    },
  };
}

/**
 * Build a synthetic Page that captures init scripts and replays them
 * against a fake `globalThis.localStorage`. Enough surface area to verify
 * the login fixture without spawning Chromium.
 */
function createFakePage(): { page: Page; storage: FakeLocalStorage; replay: () => Promise<void> } {
  const storage = createFakeStorage();
  const queued: Array<{
    fn: (arg: unknown) => unknown | Promise<unknown>;
    arg: unknown;
  }> = [];
  const page = {
    async addInitScript(
      fn: (arg: unknown) => unknown | Promise<unknown>,
      arg: unknown,
    ) {
      queued.push({ fn, arg });
    },
  } as unknown as Page;
  const replay = async () => {
    const previousLocalStorage = (globalThis as unknown as { localStorage?: FakeLocalStorage }).localStorage;
    (globalThis as unknown as FakeWindow).localStorage = storage;
    try {
      for (const item of queued) {
        await item.fn(item.arg);
      }
    } finally {
      (globalThis as unknown as { localStorage?: FakeLocalStorage }).localStorage = previousLocalStorage;
    }
  };
  return { page, storage, replay };
}

describe('loginAsTestUser', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.E2E_TEST_SECRET = 'test-secret-do-not-use-in-prod';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns the default test user when no overrides are passed', async () => {
    const { page } = createFakePage();
    const user = await loginAsTestUser(page);
    expect(user.uid).toBe(DEFAULT_TEST_USER.uid);
    expect(user.email).toBe(DEFAULT_TEST_USER.email);
  });

  it('writes user JSON, raw token, and full auth header to localStorage', async () => {
    const { page, storage, replay } = createFakePage();
    await loginAsTestUser(page);
    await replay();

    const userRaw = storage.getItem('gp.e2e.user');
    expect(userRaw).toBeTruthy();
    expect(JSON.parse(userRaw!).uid).toBe('e2e-user-001');

    const token = storage.getItem('gp.e2e.token');
    expect(token).toBe('test-secret-do-not-use-in-prod:e2e-user-001');

    const header = storage.getItem('gp.e2e.auth_header');
    expect(header).toBe('E2E test-secret-do-not-use-in-prod:e2e-user-001');
  });

  it('honours overrides (custom uid round-trips into token)', async () => {
    const { page, storage, replay } = createFakePage();
    await loginAsTestUser(page, { uid: 'custom-uid-42' });
    await replay();
    const token = storage.getItem('gp.e2e.token');
    expect(token).toBe('test-secret-do-not-use-in-prod:custom-uid-42');
    const header = storage.getItem('gp.e2e.auth_header');
    expect(header).toBe('E2E test-secret-do-not-use-in-prod:custom-uid-42');
  });

  it('throws if E2E_TEST_SECRET is missing from process.env', async () => {
    delete process.env.E2E_TEST_SECRET;
    const { page } = createFakePage();
    await expect(loginAsTestUser(page)).rejects.toThrow(/E2E_TEST_SECRET/);
  });
});

describe('buildE2EAuthHeader', () => {
  it('formats secret and uid into "E2E <secret>:<uid>"', () => {
    expect(buildE2EAuthHeader('shh', 'u-1')).toBe('E2E shh:u-1');
  });
});
