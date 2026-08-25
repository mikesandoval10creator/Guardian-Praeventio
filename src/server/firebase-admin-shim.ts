// Firebase-admin v13 → v14 compatibility shim
//
// [Daniel 2026-08-25] Plan A — drop-in shim so the migration from v13 to
// v14 does NOT require touching all 254 files that use the top-level
// `admin.firestore`, `admin.auth`, `admin.messaging`, etc. APIs.
//
// In v14, the top-level `firebase-admin` exports ONLY the App lifecycle
// (initializeApp, getApp, getApps, deleteApp). The data-plane APIs moved
// to subpaths (`firebase-admin/firestore`, `firebase-admin/auth`,
// `firebase-admin/messaging`, `firebase-admin/storage`) and require a
// module-level instance (`getFirestore()`, `getAuth()`, etc.).
//
// This shim wraps v14's modular APIs and exposes them under the legacy
// v13 property names. Existing call sites continue to work unchanged:
//
//   import { admin } from '../firebase-admin-shim';
//   const db = admin.firestore();
//   const auth = admin.auth();
//   const msg = admin.messaging();
//
// The shim is lazy: it caches one module-instance per App and reuses it
// across calls, matching v13 semantics.
//
// Migrate call sites off this shim gradually (separate PRs).

import * as adminApp from 'firebase-admin/app';
import {
  getFirestore,
  type Firestore,
  FieldValue,
} from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { getStorage, type Storage } from 'firebase-admin/storage';

// Re-export common subpath symbols under the legacy `admin.firestore.X`
// namespace pattern that v13 callers relied on.
export { FieldValue };

let _firestoreCache: { value: Firestore & { FieldValue: typeof FieldValue } } | undefined;
let _authCache: { value: Auth } | undefined;
let _messagingCache: { value: Messaging } | undefined;
let _storageCache: { value: Storage } | undefined;

function getDefaultApp(): adminApp.App {
  const apps = adminApp.getApps();
  if (apps.length === 0) {
    // v13 callers did `if (!admin.apps.length) admin.initializeApp();`
    // before any data-plane call. If we reach here without an app, the
    // caller never initialized — initialize lazily so the shim is safe
    // even if invoked before explicit initialization.
    return adminApp.initializeApp();
  }
  return apps[0]!;
}

function wrapFirestore(base: Firestore): Firestore & { FieldValue: typeof FieldValue } {
  return new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === 'FieldValue') return FieldValue;
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as Firestore & { FieldValue: typeof FieldValue };
}

function makeFirestoreAccessor() {
  const fn = ((app?: adminApp.App) => {
    if (app) return wrapFirestore(getFirestore(app));
    if (!_firestoreCache) {
      _firestoreCache = { value: wrapFirestore(getFirestore(getDefaultApp())) };
    }
    return _firestoreCache.value;
  }) as ((app?: adminApp.App) => Firestore & { FieldValue: typeof FieldValue }) & {
    FieldValue: typeof FieldValue;
  };
  // Expose `FieldValue` as a property on the function itself so legacy
  // call sites like `admin.firestore.FieldValue.serverTimestamp()` work
  // at runtime (not just at the type level). This is the v13 pattern.
  Object.defineProperty(fn, 'FieldValue', { value: FieldValue, enumerable: true });
  return fn;
}

export const admin = {
  // App lifecycle (delegates straight through — v14 has these too).
  initializeApp: (...args: Parameters<typeof adminApp.initializeApp>) =>
    adminApp.initializeApp(...args),
  getApp: (...args: Parameters<typeof adminApp.getApp>) =>
    adminApp.getApp(...args),
  getApps: () => adminApp.getApps(),
  deleteApp: (...args: Parameters<typeof adminApp.deleteApp>) =>
    adminApp.deleteApp(...args),
  // `admin.app()` (no args) returns the default app, matching v13.
  app: (name?: string) => (name ? adminApp.getApp(name) : adminApp.getApp()),
  // `apps` is exposed as a getter so it always reflects the current set of
  // initialized apps, not a snapshot from module-load time. Legacy call
  // sites do `if (!admin.apps.length) admin.initializeApp();` and expect
  // the array to be live.
  get apps(): adminApp.App[] {
    return adminApp.getApps();
  },

  // Credentials (re-exported as namespace for `admin.credential.cert(...)`).
  credential: {
    cert: adminApp.cert,
    applicationDefault: adminApp.applicationDefault,
    refreshToken: adminApp.refreshToken,
  },

  // Data plane — lazy, cached. `firestore()` returns a Firestore
  // proxy that exposes `FieldValue` (and other helpers) so legacy
  // call sites like `admin.firestore.FieldValue.serverTimestamp()`
  // and `admin.firestore().FieldValue.serverTimestamp()` both
  // keep working without changes.
  firestore: makeFirestoreAccessor(),
  auth(app?: adminApp.App): Auth {
    if (app) return getAuth(app);
    if (!_authCache) {
      _authCache = { value: getAuth(getDefaultApp()) };
    }
    return _authCache.value;
  },
  messaging(app?: adminApp.App): Messaging {
    if (app) return getMessaging(app);
    if (!_messagingCache) {
      _messagingCache = { value: getMessaging(getDefaultApp()) };
    }
    return _messagingCache.value;
  },
  storage(app?: adminApp.App): Storage {
    if (app) return getStorage(app);
    if (!_storageCache) {
      _storageCache = { value: getStorage(getDefaultApp()) };
    }
    return _storageCache.value;
  },
};

export default admin;