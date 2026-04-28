import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useFirebase } from './FirebaseContext';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useProject } from './ProjectContext';

export type SubscriptionPlan =
  | 'free'
  | 'comite'
  | 'departamento'
  | 'plata'
  | 'oro'
  | 'titanio'
  | 'platino'
  | 'empresarial'
  | 'corporativo'
  | 'ilimitado';

/**
 * Per-feature gating matrix. Replaces the coarse `isPremium` / `isEnterprise`
 * booleans for every code path that needs a tighter gate (e.g. SSO is NOT
 * available on every paid plan, only on titanio+; Vertex fine-tuning is
 * empresarial+; multi-tenant is corporativo+).
 *
 * Free-for-all features (predictable calendar, multi-país pack, ISO 45001
 * fallback, basic emergency button) are intentionally NOT in this matrix —
 * they remain ungated.
 */
export interface SubscriptionFeatures {
  canUseSSO: boolean;
  canUseVertexFineTune: boolean;
  canUseMultiTenant: boolean;
  canUseExecutiveDashboard: boolean;
  canUseGoogleWorkspaceAddon: boolean;
  canUseAdvancedAnalytics: boolean;
  canUseAPIAccess: boolean;
  canUseCustomBranding: boolean;
}

// Plan ranking, from lowest (free) to highest (ilimitado). The legacy
// `'platino'` id is mapped to the modern Diamante slot via TIER_TO_LEGACY_PLAN
// in Pricing.tsx, so it ranks between titanio and empresarial here.
const PLAN_RANK: Record<SubscriptionPlan, number> = {
  free: 0,
  comite: 1,
  departamento: 2,
  plata: 3,
  oro: 4,
  titanio: 5,
  platino: 6, // legacy alias for diamante
  empresarial: 7,
  corporativo: 8,
  ilimitado: 9,
};

const RANK_ORO = PLAN_RANK.oro;
const RANK_TITANIO = PLAN_RANK.titanio;
const RANK_DIAMANTE = PLAN_RANK.platino; // diamante in modern naming
const RANK_EMPRESARIAL = PLAN_RANK.empresarial;
const RANK_CORPORATIVO = PLAN_RANK.corporativo;

/**
 * Pure feature-flag resolver for a given plan. Always returns a fresh object
 * so callers cannot mutate a shared singleton.
 */
export function getFeaturesForPlan(plan: SubscriptionPlan): SubscriptionFeatures {
  const rank = PLAN_RANK[plan] ?? 0;
  return {
    canUseExecutiveDashboard: rank >= RANK_ORO,
    canUseSSO: rank >= RANK_TITANIO,
    canUseGoogleWorkspaceAddon: rank >= RANK_TITANIO,
    canUseAdvancedAnalytics: rank >= RANK_DIAMANTE,
    canUseCustomBranding: rank >= RANK_DIAMANTE,
    canUseVertexFineTune: rank >= RANK_EMPRESARIAL,
    canUseAPIAccess: rank >= RANK_EMPRESARIAL,
    canUseMultiTenant: rank >= RANK_CORPORATIVO,
  };
}

interface SubscriptionContextType {
  plan: SubscriptionPlan;
  isPremium: boolean;
  isEnterprise: boolean;
  canAccessExecutiveDashboard: boolean;
  features: SubscriptionFeatures;
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
  titanio: 750,
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
          // Use the new subscription object OR fallback to old field for compatibility
          const rawPlan = userData.subscription?.planId || userData.subscriptionPlan || 'free';
          // Normalize legacy plan names written by old billing code
          const PLAN_MIGRATION: Record<string, SubscriptionPlan> = {
            premium: 'departamento',
            basic: 'comite',
          };
          const activePlan: SubscriptionPlan = PLAN_MIGRATION[rawPlan] ?? (rawPlan as SubscriptionPlan) ?? 'free';
          setPlan(activePlan);
        } else {
          await setDoc(docRef, {
            subscriptionPlan: 'free',
            subscription: {
              planId: 'free',
              status: 'active',
              updatedAt: new Date().toISOString()
            }
          }, { merge: true });
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

  const upgradePlan = async (newPlan: SubscriptionPlan, purchaseToken?: string) => {
    if (!user) return;
    try {
      const docRef = doc(db, 'users', user.uid);

      const updateData: any = {
        subscriptionPlan: newPlan,
        'subscription.planId': newPlan,
        'subscription.status': 'active',
        'subscription.updatedAt': new Date().toISOString()
      };

      if (purchaseToken) {
        updateData['subscription.purchaseToken'] = purchaseToken;
      }

      await setDoc(docRef, updateData, { merge: true });
      setPlan(newPlan);
    } catch (error) {
      console.error('Error upgrading subscription:', error);
    }
  };

  const isPremium = plan !== 'free';
  const isEnterprise = ['empresarial', 'corporativo', 'ilimitado'].includes(plan);
  const features = useMemo(() => getFeaturesForPlan(plan), [plan]);
  // Legacy boolean kept for backward compatibility, now backed by the
  // tighter feature flag (oro+ instead of any-paid).
  const canAccessExecutiveDashboard = features.canUseExecutiveDashboard;

  return (
    <SubscriptionContext.Provider value={{
      plan,
      isPremium,
      isEnterprise,
      canAccessExecutiveDashboard,
      features,
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
