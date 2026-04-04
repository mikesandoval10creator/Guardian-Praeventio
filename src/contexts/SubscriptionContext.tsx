import React, { createContext, useContext, useState, useEffect } from 'react';
import { useFirebase } from './FirebaseContext';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

export type SubscriptionPlan = 'free' | 'premium' | 'enterprise';

interface SubscriptionContextType {
  plan: SubscriptionPlan;
  isPremium: boolean;
  isEnterprise: boolean;
  upgradeToPremium: () => Promise<void>;
  loading: boolean;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useFirebase();
  const [plan, setPlan] = useState<SubscriptionPlan>('free');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSubscription = async () => {
      if (!user) {
        setPlan('free');
        setLoading(false);
        return;
      }

      try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const userData = docSnap.data();
          setPlan(userData.subscriptionPlan || 'free');
        } else {
          // Initialize user with free plan
          await setDoc(docRef, { subscriptionPlan: 'free' }, { merge: true });
          setPlan('free');
        }
      } catch (error) {
        console.error('Error fetching subscription:', error);
        setPlan('free');
      } finally {
        setLoading(false);
      }
    };

    fetchSubscription();
  }, [user]);

  const upgradeToPremium = async () => {
    if (!user) return;
    try {
      const docRef = doc(db, 'users', user.uid);
      await setDoc(docRef, { subscriptionPlan: 'premium' }, { merge: true });
      setPlan('premium');
    } catch (error) {
      console.error('Error upgrading subscription:', error);
    }
  };

  const isPremium = plan === 'premium' || plan === 'enterprise';
  const isEnterprise = plan === 'enterprise';

  return (
    <SubscriptionContext.Provider value={{ plan, isPremium, isEnterprise, upgradeToPremium, loading }}>
      {children}
    </SubscriptionContext.Provider>
  );
};

export const useSubscription = () => {
  const context = useContext(SubscriptionContext);
  if (context === undefined) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return context;
};
