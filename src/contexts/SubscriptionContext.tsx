import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { useFirebase } from './FirebaseContext';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useProject } from './ProjectContext';
import { logger } from '../utils/logger';
import {
  normalizeSubscriptionPlanId,
  PLAN_RANK,
  type SubscriptionPlan,
} from '../services/pricing/subscriptionPlan';

export type { SubscriptionPlan };

/**
 * Per-feature gating matrix. Replaces the coarse `isPremium` / `isEnterprise`
 * booleans for every code path that needs a tighter gate (e.g. SSO is NOT
 * available on every paid plan, only on titanio+; Vertex fine-tuning is
 * empresarial+; multi-tenant is corporativo+).
 *
 * Free-for-all features (predictable calendar, multi-país pack, ISO 45001
 * fallback, basic emergency button) are intentionally NOT in this matrix —
 * they remain ungated.
 *
 * ⛔ HARD RULE (ADR 0021): only MANAGEMENT/SCALE/CONVENIENCE capabilities belong
 * here. LIFE-SAFETY features (SOS, emergency, ManDown, lone-worker, evacuation,
 * brigade, DEA, incident/hazard reporting, and a worker reading their OWN
 * prevention records) are FREE on every tier — never add them to this matrix.
 * See docs/architecture-decisions/0021-life-safety-features-free-all-tiers.md.
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

// Plan ranking now lives in the canonical, server-shared module
// (`services/pricing/subscriptionPlan`) so the client feature matrix and the
// server `requireTier` middleware compare against the SAME ranks (directive
// #11). `PLAN_RANK` is imported above.

// 7-metal scheme (2026-06-15): Platino absorbed empresarial/corporativo, so the
// enterprise features (analytics, branding, vertex, API, multi-tenant) all land
// at Platino; Diamante (top) inherits everything.
const RANK_ORO = PLAN_RANK.oro;
const RANK_TITANIO = PLAN_RANK.titanio;
const RANK_PLATINO = PLAN_RANK.platino;

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
    canUseAdvancedAnalytics: rank >= RANK_PLATINO,
    canUseCustomBranding: rank >= RANK_PLATINO,
    canUseVertexFineTune: rank >= RANK_PLATINO,
    canUseAPIAccess: rank >= RANK_PLATINO,
    canUseMultiTenant: rank >= RANK_PLATINO,
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
  free: 3,
  cobre: 72,
  plata: 99,
  oro: 499,
  titanio: 1999,
  platino: 9999,
  diamante: Infinity,
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
          // Use the new subscription object OR fallback to old field for compatibility.
          // Billing rails may write canonical pricing tier ids; normalize before gating.
          const rawPlan = userData.subscription?.planId || userData.subscriptionPlan || 'free';
          const activePlan = normalizeSubscriptionPlanId(rawPlan) ?? 'free';
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
        logger.error('Error fetching subscription:', error);
        setPlan('free');
      } finally {
        setLoading(false);
      }
    };

    fetchSubscription();
  }, [user]);

  // Round 22 — audit fix CRITICAL #1 (DT-01): NO escribir directo via cliente.
  // El audit detectó que cualquier user autenticado podía auto-asignarse
  // Ilimitado sin pagar. El endpoint /api/subscription/upgrade verifica
  // la existencia de un invoice paid con tierId==planId antes de actualizar.
  // Webpay y MP IPN actualizan el plan automáticamente al confirmar pago
  // (billing.ts AUTHORIZED branch + mercadoPagoIpn.ts approved branch).
  // Este método queda como fallback para refresh post-payment desde la UI.
  // Plan 2026-05-23 perf — useCallback para que upgradePlan tenga ref
  // estable; sin esto, el useMemo del contextValue (más abajo) se
  // invalidaría en cada render del Provider y la memoización sería inútil.
  const upgradePlan = useCallback(
    async (newPlan: SubscriptionPlan) => {
      if (!user) throw new Error('not_authenticated');

      // §2.20 (2026-05-23) — apiAuthHeader unified (E2E + Bearer fallback).
      const { apiAuthHeaderOrThrow } = await import('../lib/apiAuth');
      const authHeader = await apiAuthHeaderOrThrow();
      const res = await fetch('/api/subscription/upgrade', {
        method: 'POST',
        headers: {
          ...(authHeader ? { 'Authorization': authHeader } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ planId: newPlan }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const msg = errData?.error ?? `upgrade_failed_${res.status}`;
        console.error('Error upgrading subscription:', msg);
        throw new Error(msg);
      }

      // Optimistic update local state — backend ya validó el pago
      setPlan(newPlan);
    },
    [user],
  );

  const isPremium = plan !== 'free';
  const isEnterprise = ['empresarial', 'corporativo', 'ilimitado'].includes(plan);
  const features = useMemo(() => getFeaturesForPlan(plan), [plan]);
  // Legacy boolean kept for backward compatibility, now backed by the
  // tighter feature flag (oro+ instead of any-paid).
  const canAccessExecutiveDashboard = features.canUseExecutiveDashboard;

  // Plan 2026-05-23 perf — memoize el value. Sidebar.tsx + ProjectSelector
  // + varias pages consumen useSubscription(); sin esta memoización un
  // render del Provider re-renderizaba TODA la cascada aunque el plan
  // no cambiara. `upgradePlan` ya está en useCallback arriba; `features`
  // está en useMemo (línea 198). Los demás son state primitives.
  const contextValue = useMemo(
    () => ({
      plan,
      isPremium,
      isEnterprise,
      canAccessExecutiveDashboard,
      features,
      upgradePlan,
      loading,
      totalWorkers,
      recommendedPlan,
      requiresUpgrade,
    }),
    [
      plan,
      isPremium,
      isEnterprise,
      canAccessExecutiveDashboard,
      features,
      upgradePlan,
      loading,
      totalWorkers,
      recommendedPlan,
      requiresUpgrade,
    ],
  );

  return (
    <SubscriptionContext.Provider value={contextValue}>
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
