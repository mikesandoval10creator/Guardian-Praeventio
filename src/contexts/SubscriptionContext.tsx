import React, { createContext, useContext, useState, useEffect } from 'react';
import { useFirebase } from './FirebaseContext';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useProject } from './ProjectContext';

export type SubscriptionPlan = 'libre' | 'profesional' | 'empresa' | 'corporativo';

export interface PlanLimits {
  projects: number;
  workersPerProject: number;
  teamPerProject: number;
  totalWorkers: number;
}

interface SubscriptionContextType {
  plan: SubscriptionPlan;
  isPremium: boolean;
  isEnterprise: boolean;
  canAccessExecutiveDashboard: boolean;
  canUseAPI: boolean;
  planLimits: PlanLimits;
  upgradePlan: (newPlan: SubscriptionPlan, purchaseToken?: string) => Promise<void>;
  loading: boolean;
  totalWorkers: number;
  recommendedPlan: SubscriptionPlan;
  requiresUpgrade: boolean;
}

const SubscriptionContext = createContext<SubscriptionContextType | undefined>(undefined);

export const PLAN_LIMITS: Record<SubscriptionPlan, PlanLimits> = {
  libre:       { projects: 1,        workersPerProject: 10,       teamPerProject: 1,        totalWorkers: 10 },
  profesional: { projects: 3,        workersPerProject: 50,       teamPerProject: 5,        totalWorkers: 150 },
  empresa:     { projects: Infinity, workersPerProject: Infinity, teamPerProject: Infinity, totalWorkers: 300 },
  corporativo: { projects: Infinity, workersPerProject: Infinity, teamPerProject: Infinity, totalWorkers: Infinity },
};

const PLAN_ORDER: SubscriptionPlan[] = ['libre', 'profesional', 'empresa', 'corporativo'];

// Map legacy plan names from Firestore to the new 4-plan model
const migratePlan = (stored: string): SubscriptionPlan => {
  const map: Record<string, SubscriptionPlan> = {
    free: 'libre', comite: 'profesional', departamento: 'profesional',
    plata: 'empresa', oro: 'empresa', platino: 'empresa',
    empresarial: 'corporativo', ilimitado: 'corporativo',
    libre: 'libre', profesional: 'profesional', empresa: 'empresa', corporativo: 'corporativo',
  };
  return map[stored] ?? 'libre';
};

export const SubscriptionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useFirebase();
  const { projects } = useProject();
  const [plan, setPlan] = useState<SubscriptionPlan>('libre');
  const [loading, setLoading] = useState(true);

  const totalWorkers = projects.reduce((sum, project) => sum + (project.workersCount || 0), 0);
  const planLimits = PLAN_LIMITS[plan];

  const recommendedPlan: SubscriptionPlan =
    PLAN_ORDER.find(p => totalWorkers <= PLAN_LIMITS[p].totalWorkers) ?? 'corporativo';

  const requiresUpgrade =
    totalWorkers > planLimits.totalWorkers || projects.length > planLimits.projects;

  useEffect(() => {
    const fetchSubscription = async () => {
      if (!user) {
        setPlan('libre');
        setLoading(false);
        return;
      }
      try {
        const docRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const userData = docSnap.data();
          const stored = userData.subscription?.planId || userData.subscriptionPlan || 'libre';
          setPlan(migratePlan(stored));
        } else {
          await setDoc(docRef, {
            subscriptionPlan: 'libre',
            subscription: { planId: 'libre', status: 'active', updatedAt: new Date().toISOString() }
          }, { merge: true });
          setPlan('libre');
        }
      } catch (error) {
        console.error('Error fetching subscription:', error);
        setPlan('libre');
      } finally {
        setLoading(false);
      }
    };
    fetchSubscription();
  }, [user]);

  const upgradePlan = async (newPlan: SubscriptionPlan, purchaseToken?: string) => {
    if (!user) return;
    try {
      const docRef = doc(db, 'users', user.uid);
      const updateData: Record<string, unknown> = {
        subscriptionPlan: newPlan,
        'subscription.planId': newPlan,
        'subscription.status': 'active',
        'subscription.updatedAt': new Date().toISOString(),
      };
      if (purchaseToken) updateData['subscription.purchaseToken'] = purchaseToken;
      await setDoc(docRef, updateData, { merge: true });
      setPlan(newPlan);
    } catch (error) {
      console.error('Error upgrading subscription:', error);
    }
  };

  const isPremium = plan !== 'libre';
  const isEnterprise = plan === 'empresa' || plan === 'corporativo';
  const canAccessExecutiveDashboard = isEnterprise;
  const canUseAPI = plan === 'corporativo';

  return (
    <SubscriptionContext.Provider value={{
      plan,
      isPremium,
      isEnterprise,
      canAccessExecutiveDashboard,
      canUseAPI,
      planLimits,
      upgradePlan,
      loading,
      totalWorkers,
      recommendedPlan,
      requiresUpgrade,
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
