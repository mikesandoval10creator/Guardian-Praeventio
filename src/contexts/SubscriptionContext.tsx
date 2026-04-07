import React, { createContext, useContext, useState, useEffect } from 'react';
import { useFirebase } from './FirebaseContext';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useProject } from './ProjectContext';

export type SubscriptionPlan = 'free' | 'comite' | 'departamento' | 'plata' | 'oro' | 'platino' | 'empresarial' | 'corporativo' | 'ilimitado';

interface SubscriptionContextType {
  plan: SubscriptionPlan;
  isPremium: boolean;
  isEnterprise: boolean;
  upgradePlan: (newPlan: SubscriptionPlan) => Promise<void>;
  loading: boolean;
  totalWorkers: number;
  recommendedPlan: SubscriptionPlan;
  requiresUpgrade: boolean;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

const PLAN_LIMITS: Record<SubscriptionPlan, number> = {
  free: 10,
  comite: 25,
  departamento: 100,
  plata: 250,
  oro: 500,
  platino: 1000,
  empresarial: 2500,
  corporativo: 5000,
  ilimitado: Infinity
};

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useFirebase();
  const { projects } = useProject();
  const [plan, setPlan] = useState<SubscriptionPlan>('free');
  const [loading, setLoading] = useState(true);

  // Calculate total workers across all projects
  const totalWorkers = projects.reduce((sum, project) => sum + (project.workersCount || 0), 0);

  // Determine recommended plan based on workers
  let recommendedPlan: SubscriptionPlan = 'free';
  for (const [p, limit] of Object.entries(PLAN_LIMITS)) {
    if (totalWorkers <= limit) {
      recommendedPlan = p as SubscriptionPlan;
      break;
    }
  }

  // Check if current plan limit is exceeded
  const requiresUpgrade = totalWorkers > PLAN_LIMITS[plan];

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

  const upgradePlan = async (newPlan: SubscriptionPlan) => {
    if (!user) return;
    try {
      const docRef = doc(db, 'users', user.uid);
      await setDoc(docRef, { subscriptionPlan: newPlan }, { merge: true });
      setPlan(newPlan);
    } catch (error) {
      console.error('Error upgrading subscription:', error);
    }
  };

  const isPremium = plan !== 'free';
  const isEnterprise = ['empresarial', 'corporativo', 'ilimitado'].includes(plan);

  return (
    <SubscriptionContext.Provider value={{ 
      plan, 
      isPremium, 
      isEnterprise, 
      upgradePlan, 
      loading,
      totalWorkers,
      recommendedPlan,
      requiresUpgrade
    }}>
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
