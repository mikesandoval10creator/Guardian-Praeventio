import { describe, it, expect } from 'vitest';
import type { Store } from 'express-session';
import {
  resolveSessionStore,
  SessionStoreConfigError,
} from './resolveSessionStore.js';

const fakeStore = {} as Store;

describe('resolveSessionStore', () => {
  it('returns the Firestore store when admin is initialized and construction succeeds', () => {
    const store = resolveSessionStore({
      isProduction: true,
      adminInitialized: true,
      makeStore: () => fakeStore,
    });
    expect(store).toBe(fakeStore);
  });

  it('FAIL-CLOSED: throws in production when store construction fails (no MemoryStore fallback)', () => {
    expect(() =>
      resolveSessionStore({
        isProduction: true,
        adminInitialized: true,
        makeStore: () => {
          throw new Error('firestore misconfigured');
        },
      }),
    ).toThrow(SessionStoreConfigError);
  });

  it('FAIL-CLOSED: throws in production when admin is not initialized', () => {
    expect(() =>
      resolveSessionStore({
        isProduction: true,
        adminInitialized: false,
        makeStore: () => fakeStore,
      }),
    ).toThrow(SessionStoreConfigError);
  });

  it('dev: falls back to MemoryStore (undefined) when store construction fails', () => {
    const store = resolveSessionStore({
      isProduction: false,
      adminInitialized: true,
      makeStore: () => {
        throw new Error('no credentials');
      },
    });
    expect(store).toBeUndefined();
  });

  it('dev: falls back to MemoryStore (undefined) when admin is not initialized', () => {
    const store = resolveSessionStore({
      isProduction: false,
      adminInitialized: false,
      makeStore: () => fakeStore,
    });
    expect(store).toBeUndefined();
  });
});
