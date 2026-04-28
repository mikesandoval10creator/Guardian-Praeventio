import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, orderBy, limit, getDocFromServer, serverTimestamp, writeBatch } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, listAll } from 'firebase/storage';
import { getMessaging, getToken, onMessage, isSupported } from 'firebase/messaging';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase SDK
const app = initializeApp(firebaseConfig);

// Initialize Firestore with persistent cache
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({tabManager: persistentMultipleTabManager()})
}, firebaseConfig.firestoreDatabaseId);

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
    const user = auth.currentUser;
    if (!user) return;
    const token = await user.getIdToken();
    await fetch('/api/oauth/unlink', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      credentials: 'include',
    });
  } catch (err) {
    // Logout must succeed even if the server unlink call fails.
    console.warn('[firebase.logOut] notifyServerLogout failed (non-fatal):', err);
  }
}

export const logOut = async () => {
  // Capture uid before signOut clears auth.currentUser, so we can clear the
  // per-uid first-login key for the 8h-shift session expiry hook.
  const uid = auth.currentUser?.uid;
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
      console.error("Please check your Firebase configuration. The client is offline.");
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
  console.error('Firestore Error: ', JSON.stringify(errInfo));
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
