import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, signInWithCustomToken, onAuthStateChanged, connectAuthEmulator, User } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, getDocFromServer, serverTimestamp, writeBatch } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';
import { logger } from '../utils/logger';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);

// §2.25 (2026-05-21) — Override databaseId a default cuando MODE=test.
// firebase-applet-config.json apunta a un databaseId no-default
// `ai-studio-d2437df8-...` (Firebase AI Studio scratch DB). PERO el
// fixture E2E `tests/e2e/fixtures/seed.ts` usa firebase-admin sin
// especificar databaseId → escribe al default `(default)`. Sin override,
// el cliente queries `ai-studio-...` (vacío en emulator) mientras la
// seed queda en default → ProjectContext nunca encuentra el proyecto
// seedeado → 5 specs §2.21 ven UI sin proyecto.
//
// Production usa el databaseId real porque allí existe (creado en
// Firebase AI Studio). Test/E2E usa default que es lo que el emulator
// provee por defecto.
let firestoreDbId: string | undefined = firebaseConfig.firestoreDatabaseId;
try {
  if (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test') {
    firestoreDbId = undefined; // emulator default DB
  }
} catch {
  // import.meta.env not available — usa el config real (production).
}

// Initialize Firestore with persistent cache
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
}, firestoreDbId);

// §2.22 fix (2026-05-21) — En MODE=test (Vite preview con `--mode test`)
// conectamos el client SDK al Firestore Emulator local (puerto 8080) para
// que las queries del frontend (ProjectContext, hooks, pages) vean el
// mismo data set que el fixture `seedProject()` siembra via firebase-admin.
//
// Sin esto: seedProject escribía al emulator pero ProjectContext leía de
// production → resultado: selectedProject null y la UI de los 5 specs E2E
// (sos-button, fall-detection, offline-resilience, process-lifecycle)
// no encontraba sus elementos.
//
// Producción nunca entra acá (gate `import.meta.env.MODE === 'test'`,
// solo activado por `vite --mode test`).
try {
  if (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test') {
    // connectFirestoreEmulator tira si el host ya está bound; lo
    // envolvemos en try/catch para soportar HMR (re-import del módulo
    // durante hot reload no debe romper la página).
    try {
      connectFirestoreEmulator(db, 'localhost', 8080);
      logger.debug('[firebase] Firestore client connected to emulator localhost:8080 (MODE=test)');
    } catch (err) {
      // Already connected — safe to ignore. Other errors are warning-worthy
      // but not fatal (the queries will simply fail with auth/network if
      // emulator is down).
      logger.debug('[firebase] connectFirestoreEmulator skipped (already connected or no emulator)', { err });
    }
  }
} catch {
  // import.meta.env access may throw in some sandbox environments — safe
  // to ignore. Production path doesn't depend on this.
}

export const auth = getAuth(app);

// §2.24 fix (2026-05-21) — Conectar Auth Emulator en MODE=test.
// Razón: firestore.rules requiere `request.auth != null` + `email_verified`.
// Sin Auth Emulator, el shim §2.19 (que solo setea React state) NO logra que
// `auth.currentUser` se popule → Firestore client queries fallan denied →
// los 5 specs §2.21 (sos-button, fall-detection, offline-resilience,
// process-lifecycle) no encuentran proyectos seedeados.
//
// Aprobado por usuario 2026-05-21: "auth emulador si es necesario para que
// la logica de negocio funcione".
//
// Producción NUNCA entra (gate `import.meta.env.MODE === 'test'` — Vite
// preview con --mode test, único forma de bakear MODE=test en el bundle).
// Backend `verifyAuth.ts:49` tiene gate redundante fatal si NODE_ENV=
// production && E2E_MODE=1 (defense in depth).
//
// El fixture `tests/e2e/fixtures/auth.ts:loginAsTestUser` después de
// page.addInitScript mintará un custom token vía firebase-admin (Auth
// Emulator REST API auto-detectado por FIREBASE_AUTH_EMULATOR_HOST) +
// signInWithCustomToken en el browser → auth.currentUser se popula →
// request.auth no es null → firestore.rules permite queries.
try {
  if (typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test') {
    try {
      connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      logger.debug('[firebase] Auth client connected to emulator localhost:9099 (MODE=test)');
    } catch (err) {
      // Already connected — safe to ignore (HMR re-import).
      logger.debug('[firebase] connectAuthEmulator skipped (already connected or no emulator)', { err });
    }

    // §2.24 (2026-05-21) — Auto sign-in con custom token cuando el
    // fixture E2E lo dejó en localStorage. Esto popula `auth.currentUser`
    // sin que el spec tenga que invocar explícito `signInBrowserViaCustom
    // Token`. Transparent for existing specs. Race-safe: si el sign-in
    // tarda, `onAuthStateChanged` listener (en FirebaseContext) capta
    // el cambio y re-renderiza los componentes que dependen de user.
    //
    // Producción jamás entra (gate MODE=test).
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const customToken = window.localStorage.getItem('gp.e2e.custom_token');
        if (customToken && !auth.currentUser) {
          // Fire-and-forget — los listeners actualizarán state cuando
          // auth.currentUser se popule. NO await aquí porque queremos
          // que el módulo termine de cargar (no bloqueamos boot).
          signInWithCustomToken(auth, customToken).then(
            (cred) => {
              logger.debug('[firebase] auto signIn ok (MODE=test custom token)', {
                uid: cred.user?.uid,
              });
            },
            (err) => {
              logger.warn('[firebase] auto signIn with custom token failed', { err });
            },
          );
        }
      }
    } catch (err) {
      logger.debug('[firebase] custom token auto-sign-in skipped', { err });
    }
  }
} catch {
  // import.meta.env not available — production path, never enter.
}

export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

export const getMessagingInstance = async () => {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    const supported = await isSupported();
    if (supported) {
      return getMessaging(app);
    }
  }
  return null;
};

// Auth helper functions
export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);

/**
 * Notifies the server that the user is logging out so it can revoke server-side
 * OAuth tokens (Google Calendar / Google Fit / Drive) before the Firebase session
 * is torn down. Errors are swallowed — Firebase signOut MUST still proceed even if
 * the unlink call fails (e.g. offline, server down, network blocked).
 *
 * EXPECTED ENDPOINT (server.ts): POST /api/oauth/unlink — verifyAuth + revokeTokens(uid, 'google') + revokeTokens(uid, 'google-drive')
 */
async function notifyServerLogout(): Promise<void> {
  try {
    // §2.20 (2026-05-21) — usa apiAuthHeader() que prefiere
    // E2E header sobre Bearer cuando MODE=test. Antes este call-site
    // hardcodeaba `Bearer ${token}` y fallaba en E2E full-stack
    // (backend verifyAuth.ts:67 espera `E2E ...` en E2E_MODE).
    const { apiAuthHeader } = await import('../lib/apiAuth');
    const authHeader = await apiAuthHeader();
    if (!authHeader) return;
    await fetch('/api/oauth/unlink', {
      method: 'POST',
      headers: { Authorization: authHeader },
      credentials: 'include',
    });
  } catch (err) {
    // Logout must succeed even if the server unlink call fails.
    logger.warn('[firebase.logOut] notifyServerLogout failed (non-fatal)', { err });
  }
}

export const logOut = async () => {
  // Capture uid before signOut clears auth.currentUser, so we can clear the
  // per-uid first-login key for the 8h-shift session expiry hook.
  const uid = auth.currentUser?.uid;
  try {
    const { analytics } = await import('./analytics');
    analytics.track('auth.user.signed_out', { signout_reason: 'user_initiated' });
  } catch { /* analytics must never break sign-out flow */ }
  await notifyServerLogout();
  try {
    if (uid) localStorage.removeItem('praeventio_first_login_' + uid);
  } catch {}
  return signOut(auth);
};

// Firestore connection test
export async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      logger.error("Please check your Firebase configuration. The client is offline.");
    }
  }
}

// Operation types for error handling
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  logger.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  onAuthStateChanged,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
  listAll,
  getToken,
  onMessage
};

export type { User };
