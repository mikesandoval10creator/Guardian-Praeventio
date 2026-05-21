// Praeventio Guard — §2.20 fix tests (2026-05-21).
//
// Vitest unit tests para el helper unificado `apiAuthHeader()` que
// resuelve el hallazgo del audit §2.19: los 20+ callers existentes
// llamaban `user.getIdToken()` + `Bearer ${token}` sin checkear el
// header E2E primero. Este test verifica que `apiAuthHeader()`:
//
//   1. Prefiere E2E header cuando MODE=test + fixture presente.
//   2. Cae a `Bearer ${idToken}` cuando hay user autenticado.
//   3. Devuelve null sin user y sin fixture.
//   4. Maneja `getIdToken()` failures (network down, token expired).
//   5. `detectAuthSource()` reporta el origen correcto.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  apiAuthHeader,
  apiAuthHeaderOrThrow,
  apiAuthHeaders,
  detectAuthSource,
} from './apiAuth';

interface FakeStore {
  store: Map<string, string>;
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
  clear: () => void;
}

function fakeStorage(): FakeStore {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
}

// Mock Firebase auth — el módulo `../services/firebase` exporta `auth`
// que es el objeto firebase/auth Auth singleton. Lo reemplazamos con un
// stub controlable.
vi.mock('../services/firebase', () => ({
  auth: {
    currentUser: null as unknown as { getIdToken: () => Promise<string> } | null,
  },
}));

vi.mock('../utils/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Re-import del mock para mutar currentUser entre tests.
import { auth as mockAuth } from '../services/firebase';

const previousLocalStorage = (globalThis as unknown as {
  localStorage?: FakeStore;
}).localStorage;

beforeEach(() => {
  const fake = fakeStorage();
  (globalThis as unknown as { localStorage: FakeStore }).localStorage = fake;
  // Reset auth state
  (mockAuth as unknown as { currentUser: null | unknown }).currentUser = null;
});

afterEach(() => {
  (globalThis as unknown as { localStorage?: FakeStore }).localStorage =
    previousLocalStorage;
});

describe('apiAuthHeader', () => {
  it('returns E2E header when MODE=test + fixture present', async () => {
    (globalThis as unknown as { localStorage: FakeStore }).localStorage.setItem(
      'gp.e2e.auth_header',
      'E2E secret123:e2e-user-001',
    );
    const header = await apiAuthHeader();
    expect(header).toBe('E2E secret123:e2e-user-001');
  });

  it('falls back to Bearer when user is logged in (no E2E fixture)', async () => {
    (mockAuth as unknown as { currentUser: unknown }).currentUser = {
      getIdToken: async () => 'firebase-id-token-abc',
    };
    const header = await apiAuthHeader();
    expect(header).toBe('Bearer firebase-id-token-abc');
  });

  it('prefers E2E header over Bearer when both are present', async () => {
    // Edge case: tests might leave both states present. The E2E branch
    // wins because the backend expects `E2E ...` in MODE=test and the
    // Bearer token would 401.
    (globalThis as unknown as { localStorage: FakeStore }).localStorage.setItem(
      'gp.e2e.auth_header',
      'E2E secret:uid',
    );
    (mockAuth as unknown as { currentUser: unknown }).currentUser = {
      getIdToken: async () => 'firebase-token',
    };
    const header = await apiAuthHeader();
    expect(header).toBe('E2E secret:uid');
  });

  it('returns null when no user and no E2E fixture', async () => {
    const header = await apiAuthHeader();
    expect(header).toBeNull();
  });

  it('returns null when getIdToken throws (network down / expired)', async () => {
    (mockAuth as unknown as { currentUser: unknown }).currentUser = {
      getIdToken: async () => {
        throw new Error('network unreachable');
      },
    };
    const header = await apiAuthHeader();
    expect(header).toBeNull();
  });
});

describe('apiAuthHeaderOrThrow', () => {
  it('returns header when available', async () => {
    (mockAuth as unknown as { currentUser: unknown }).currentUser = {
      getIdToken: async () => 'tok',
    };
    await expect(apiAuthHeaderOrThrow()).resolves.toBe('Bearer tok');
  });

  it('throws when no auth available', async () => {
    await expect(apiAuthHeaderOrThrow()).rejects.toThrow(/no auth available/i);
  });
});

describe('apiAuthHeaders (object form)', () => {
  it('returns { Authorization: ... } when authed', async () => {
    (mockAuth as unknown as { currentUser: unknown }).currentUser = {
      getIdToken: async () => 'tok',
    };
    const headers = await apiAuthHeaders();
    expect(headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('returns empty object when no auth (spread-safe)', async () => {
    const headers = await apiAuthHeaders();
    expect(headers).toEqual({});
  });
});

describe('detectAuthSource', () => {
  it('returns "e2e" with fixture', () => {
    (globalThis as unknown as { localStorage: FakeStore }).localStorage.setItem(
      'gp.e2e.auth_header',
      'E2E secret:uid',
    );
    expect(detectAuthSource()).toBe('e2e');
  });

  it('returns "bearer" with logged-in user', () => {
    (mockAuth as unknown as { currentUser: unknown }).currentUser = {
      getIdToken: async () => 'tok',
    };
    expect(detectAuthSource()).toBe('bearer');
  });

  it('returns "anonymous" with neither', () => {
    expect(detectAuthSource()).toBe('anonymous');
  });
});
