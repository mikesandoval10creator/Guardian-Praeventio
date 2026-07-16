// Praeventio Guard — session-store resolution (fail-closed in production).
//
// In production the Firestore-backed session store is MANDATORY: Cloud Run runs
// multiple instances, and MemoryStore loses the OAuth state between the callback
// and the follow-up request when they land on different pods, and grows
// unbounded. The previous inline logic in server.ts caught a store-construction
// failure and silently fell back to MemoryStore even in prod — this makes that
// path fail-closed and testable.

import type { Store } from 'express-session';

/** Thrown when the mandatory production session store cannot be constructed. */
export class SessionStoreConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionStoreConfigError';
  }
}

export interface ResolveSessionStoreOptions {
  isProduction: boolean;
  /** Whether firebase-admin has an initialized app (credentials present). */
  adminInitialized: boolean;
  /** Constructs the Firestore-backed store. May throw on misconfiguration. */
  makeStore: () => Store;
}

/**
 * Returns the Firestore session store, or `undefined` to signal "use the default
 * MemoryStore" — but ONLY outside production. In production any failure (Admin
 * not initialized, or `makeStore()` throwing) raises `SessionStoreConfigError`,
 * and the caller MUST refuse to boot rather than degrade to MemoryStore.
 */
export function resolveSessionStore(
  opts: ResolveSessionStoreOptions,
): Store | undefined {
  if (opts.adminInitialized) {
    try {
      return opts.makeStore();
    } catch (err) {
      if (opts.isProduction) {
        throw new SessionStoreConfigError(
          'Firestore session store init failed in production — refusing to fall ' +
            `back to MemoryStore: ${(err as Error)?.message ?? String(err)}`,
        );
      }
      return undefined; // dev: MemoryStore is acceptable for a single process.
    }
  }
  if (opts.isProduction) {
    throw new SessionStoreConfigError(
      'Firebase Admin is not initialized — the Firestore session store is ' +
        'mandatory in production (MemoryStore loses OAuth state across Cloud ' +
        'Run instances).',
    );
  }
  return undefined; // dev without credentials: MemoryStore.
}
