import { describe, it, expect } from 'vitest';
import {
  getFeaturesForPlan,
  type SubscriptionPlan,
  type SubscriptionFeatures,
} from './SubscriptionContext';

/**
 * Feature gate matrix (R4 / Round 14):
 * - canUseSSO              → titanio+
 * - canUseGoogleWorkspaceAddon → titanio+
 * - canUseAdvancedAnalytics→ diamante+
 * - canUseCustomBranding   → diamante+
 * - canUseExecutiveDashboard → oro+ (tightened from old "any premium")
 * - canUseVertexFineTune   → empresarial+
 * - canUseAPIAccess        → empresarial+
 * - canUseMultiTenant      → corporativo+
 *
 * These tests double as living documentation of the gating rules.
 */

const ALL_FALSE: SubscriptionFeatures = {
  canUseSSO: false,
  canUseVertexFineTune: false,
  canUseMultiTenant: false,
  canUseExecutiveDashboard: false,
  canUseGoogleWorkspaceAddon: false,
  canUseAdvancedAnalytics: false,
  canUseAPIAccess: false,
  canUseCustomBranding: false,
};

describe('getFeaturesForPlan', () => {
  it('free plan: all features locked', () => {
    expect(getFeaturesForPlan('free')).toEqual(ALL_FALSE);
  });

  it('comite plan: all features locked (paid baseline still below oro)', () => {
    expect(getFeaturesForPlan('comite')).toEqual(ALL_FALSE);
  });

  it('departamento plan: all features locked (paid baseline still below oro)', () => {
    expect(getFeaturesForPlan('departamento')).toEqual(ALL_FALSE);
  });

  it('plata plan: all features locked (still below oro threshold)', () => {
    expect(getFeaturesForPlan('plata')).toEqual(ALL_FALSE);
  });

  it('oro plan: only executive dashboard unlocked', () => {
    expect(getFeaturesForPlan('oro')).toEqual({
      ...ALL_FALSE,
      canUseExecutiveDashboard: true,
    });
  });

  it('titanio plan: SSO + Workspace add-on + executive dashboard', () => {
    expect(getFeaturesForPlan('titanio')).toEqual({
      ...ALL_FALSE,
      canUseSSO: true,
      canUseGoogleWorkspaceAddon: true,
      canUseExecutiveDashboard: true,
    });
  });

  it('platino (legacy diamante slot) plan: adds advanced analytics + custom branding', () => {
    // 'platino' is the legacy id mapped to the diamante tier in Pricing.tsx.
    expect(getFeaturesForPlan('platino')).toEqual({
      canUseSSO: true,
      canUseGoogleWorkspaceAddon: true,
      canUseExecutiveDashboard: true,
      canUseAdvancedAnalytics: true,
      canUseCustomBranding: true,
      canUseVertexFineTune: false,
      canUseAPIAccess: false,
      canUseMultiTenant: false,
    });
  });

  it('empresarial plan: adds Vertex fine-tune + API access', () => {
    expect(getFeaturesForPlan('empresarial')).toEqual({
      canUseSSO: true,
      canUseGoogleWorkspaceAddon: true,
      canUseExecutiveDashboard: true,
      canUseAdvancedAnalytics: true,
      canUseCustomBranding: true,
      canUseVertexFineTune: true,
      canUseAPIAccess: true,
      canUseMultiTenant: false,
    });
  });

  it('corporativo plan: every flag enabled (multi-tenant unlocks here)', () => {
    expect(getFeaturesForPlan('corporativo')).toEqual({
      canUseSSO: true,
      canUseGoogleWorkspaceAddon: true,
      canUseExecutiveDashboard: true,
      canUseAdvancedAnalytics: true,
      canUseCustomBranding: true,
      canUseVertexFineTune: true,
      canUseAPIAccess: true,
      canUseMultiTenant: true,
    });
  });

  it('ilimitado plan: every flag enabled (top tier inherits all)', () => {
    const features = getFeaturesForPlan('ilimitado');
    // Every flag should be true
    (Object.keys(features) as Array<keyof SubscriptionFeatures>).forEach((k) => {
      expect(features[k], `expected ${k} to be true on ilimitado`).toBe(true);
    });
  });

  it('returns a fresh object (no shared reference) so callers cannot mutate the matrix', () => {
    const a = getFeaturesForPlan('oro');
    const b = getFeaturesForPlan('oro');
    expect(a).not.toBe(b);
    a.canUseExecutiveDashboard = false;
    expect(getFeaturesForPlan('oro').canUseExecutiveDashboard).toBe(true);
  });

  it('handles every legacy SubscriptionPlan id without throwing', () => {
    const allPlans: SubscriptionPlan[] = [
      'free',
      'comite',
      'departamento',
      'plata',
      'oro',
      'titanio',
      'platino',
      'empresarial',
      'corporativo',
      'ilimitado',
    ];
    for (const p of allPlans) {
      expect(() => getFeaturesForPlan(p)).not.toThrow();
    }
  });
});
