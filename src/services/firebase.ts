import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, getDocFromServer, serverTimestamp, writeBatch } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';
import { logger } from '../utils/logger';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);

// Initialize Firestore with persistent cache
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
}, firebaseConfig.firestoreDatabaseId);

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
