import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { auth, db, User, onAuthStateChanged, doc, getDoc, setDoc, collection, getDocs, testConnection } from '../services/firebase';
import { risks } from '../data/risks';
import { NodeType } from '../types';
import { logger } from '../utils/logger';
import { isE2EMode, getE2EUser } from '../lib/e2eAuth';

interface FirebaseContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isAuthReady: boolean;
  userRole: string;
  userIndustry: string;
  /** Sprint 24 Bucket KK — true once the self-service onboarding wizard
   *  has run for this user. New users land on `/onboarding`; the value
   *  is `null` while we're still loading the user doc to avoid a flash
   *  redirect. */
  onboarded: boolean | null;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

/**
 * §2.19 fix (2026-05-21) — Construye un User shim mínimo desde el fixture
 * E2E para que `useFirebase().user` no sea null en tests Playwright. Solo
 * se invoca cuando `isE2EMode() === true`. Cumple la shape mínima que
 * `App.tsx`/hooks consumen (`uid`, `email`, `displayName`).
 *
 * NO se usa `auth.currentUser?.getIdToken()` en este path — los fetch
 * wrappers ya tienen un fallback a `getE2EAuthHeader()` (ver
 * `src/lib/e2eAuth.ts`) que devuelve el header sintético `E2E <secret>:<uid>`.
 */
function buildE2EUserShim(): User | null {
  const fixture = getE2EUser();
  if (!fixture) return null;
  // Cast a `User` para evitar arrastrar la dependencia de los métodos
  // internos de `firebase.User` (getIdToken, reload, etc.) que React no
  // consume directamente. Si algún consumidor llama getIdToken explícito
  // bajo MODE=test, refactorizar a getE2EAuthHeader().
  return {
    uid: fixture.uid,
    email: fixture.email,
    displayName: fixture.displayName,
    photoURL: null,
    emailVerified: true,
    isAnonymous: false,
    providerData: [],
    metadata: {
      creationTime: undefined,
      lastSignInTime: undefined,
    },
    tenantId: fixture.tenantId || null,
    refreshToken: '',
    providerId: 'e2e-shim',
    delete: async () => undefined,
    getIdToken: async () => 'e2e-shim-token',
    getIdTokenResult: async () => ({
      token: 'e2e-shim-token',
      authTime: new Date().toISOString(),
      issuedAtTime: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 3600_000).toISOString(),
      signInProvider: 'e2e-shim',
      signInSecondFactor: null,
      claims: {},
    }),
    reload: async () => undefined,
    toJSON: () => ({ uid: fixture.uid, email: fixture.email }),
  } as unknown as User;
}

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  // §2.19 fix — lazy init lee fixture en MODE=test para que el primer
  // render ya tenga el user "logged in" y AppRoutes no muestre Landing.
  const [user, setUser] = useState<User | null>(() => buildE2EUserShim());
  const [loading, setLoading] = useState(() => !isE2EMode() || !getE2EUser());
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    const f = getE2EUser();
    return f ? f.roles.includes('admin') || f.roles.includes('gerente') : false;
  });
  const [userRole, setUserRole] = useState<string>(() => {
    const f = getE2EUser();
    return f && f.roles.length > 0 ? f.roles[0] : 'client';
  });
  const [userIndustry, setUserIndustry] = useState<string>('General');
  const [isAuthReady, setIsAuthReady] = useState<boolean>(() => isE2EMode() && !!getE2EUser());
  // En E2E asumimos onboarded=true (tests no exercen el wizard salvo specs
  // explícitos de onboarding, que sobre-escriben con su propio fixture).
  const [onboarded, setOnboarded] = useState<boolean | null>(() => {
    return isE2EMode() && !!getE2EUser() ? true : null;
  });

  useEffect(() => {
    // §2.24 fix (2026-05-21) — actualizado §2.19: NO saltamos el listener
    // en E2E mode. El shim provee state INICIAL (fast first render sin
    // flash de Landing). Cuando `signInWithCustomToken` (en firebase.ts
    // auto-sign-in) firma al user real en Auth Emulator,
    // `onAuthStateChanged` dispara y `setUser(currentUser)` reemplaza
    // el shim con el user real. Esto popula `auth.currentUser` que
    // Firestore queries necesitan para satisfacer firestore.rules.
    //
    // Producción nunca activa el shim (gate isE2EMode + MODE=test).

    // Test connection on mount
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        try {
          // Check if user exists in Firestore, if not create them
          const userDocRef = doc(db, 'users', currentUser.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (!userDoc.exists()) {
            const newUserData: any = {
              uid: currentUser.uid,
              displayName: currentUser.displayName || 'Anonymous',
              email: currentUser.email || '',
              role: 'operario', // Default role matching firestore rules
              industry: 'General',
              createdAt: new Date().toISOString(),
              onboarded: false,
            };
            if (currentUser.photoURL) {
              newUserData.photoURL = currentUser.photoURL;
            }
            await setDoc(userDocRef, newUserData);
            setUserRole('operario');
            setUserIndustry('General');
            setOnboarded(false);
          } else {
            const userData = userDoc.data();
            setIsAdmin(userData.role === 'admin' || userData.role === 'gerente');
            setUserRole(userData.role || 'operario');
            setUserIndustry(userData.industry || 'General');
            setOnboarded(userData.onboarded === true);
          }

          // Seed initial nodes if collection is empty
          const nodesSnapshot = await getDocs(collection(db, 'nodes'));
          if (nodesSnapshot.empty) {
            logger.debug('Seeding initial nodes...');
            for (const risk of risks) {
              const now = new Date().toISOString();
              await setDoc(doc(db, 'nodes', risk.id), {
                id: risk.id,
                type: NodeType.RISK,
                title: risk.title,
                description: risk.description,
                tags: [risk.category, 'Seed'],
                metadata: { color: risk.color, icon: risk.icon },
                connections: [],
                createdAt: now,
                updatedAt: now,
              });
            }
          }
        } catch (error) {
          logger.error("Error during auth state change handling:", error);
          // Fallback to safe defaults if Firestore fails
          setIsAdmin(false);
          setUserRole('worker');
        }
      } else {
        setIsAdmin(false);
        setUserRole('worker');
        setOnboarded(null);
      }
      
      setLoading(false);
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  // Plan 2026-05-23 perf — memoize el value para evitar re-render
  // de cascada: este Provider envuelve casi toda la app (Router root),
  // así que un re-render del Provider invalida ~todos los useContext
  // del codebase. Con useMemo, los consumers solo re-renderizan cuando
  // un campo efectivamente cambia (user firma/cierra, role updates, etc.).
  // Todos los campos del value son state primitives (sin callbacks
  // regenerados) — memoización es 100% segura.
  const contextValue = useMemo(
    () => ({ user, loading, isAdmin, isAuthReady, userRole, userIndustry, onboarded }),
    [user, loading, isAdmin, isAuthReady, userRole, userIndustry, onboarded],
  );

  return (
    <FirebaseContext.Provider value={contextValue}>
      {children}
    </FirebaseContext.Provider>
  );
}

export function useFirebase() {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
}
