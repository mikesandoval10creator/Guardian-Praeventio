import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, db, User, onAuthStateChanged, doc, getDoc, setDoc, collection, getDocs } from '../services/firebase';
import { risks } from '../data/risks';
import { NodeType } from '../types';

interface FirebaseContextType {
  user: User | null;
  loading: boolean;
  isAdmin: boolean;
  isAuthReady: boolean;
  userRole: string;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userRole, setUserRole] = useState<string>('client');
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
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
              role: 'worker', // Default role matching firestore rules
              createdAt: new Date().toISOString(),
            };
            if (currentUser.photoURL) {
              newUserData.photoURL = currentUser.photoURL;
            }
            await setDoc(userDocRef, newUserData);
            setUserRole('worker');
          } else {
            const userData = userDoc.data();
            setIsAdmin(userData.role === 'admin');
            setUserRole(userData.role || 'worker');
          }

          // Seed initial nodes if collection is empty
          const nodesSnapshot = await getDocs(collection(db, 'nodes'));
          if (nodesSnapshot.empty) {
            console.log('Seeding initial nodes...');
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
          console.error("Error during auth state change handling:", error);
          // Fallback to safe defaults if Firestore fails
          setIsAdmin(false);
          setUserRole('worker');
        }
      } else {
        setIsAdmin(false);
        setUserRole('worker');
      }
      
      setLoading(false);
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  return (
    <FirebaseContext.Provider value={{ user, loading, isAdmin, isAuthReady, userRole }}>
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
