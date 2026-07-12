import { describe, it, expect } from 'vitest';
import {
  getFeaturesForPlan,
  resolveEffectiveSubscriptionPlan,
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

  it('cobre plan: all features locked (below oro threshold)', () => {
    expect(getFeaturesForPlan('cobre')).toEqual(ALL_FALSE);
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

  it('platino plan: enterprise band — every flag enabled (absorbs empresarial/corporativo)', () => {
    const features = getFeaturesForPlan('platino');
    (Object.keys(features) as Array<keyof SubscriptionFeatures>).forEach((k) => {
      expect(features[k], `expected ${k} to be true on platino`).toBe(true);
    });
  });

  it('diamante plan: the jewel — every flag enabled (top tier inherits all)', () => {
    const features = getFeaturesForPlan('diamante');
    (Object.keys(features) as Array<keyof SubscriptionFeatures>).forEach((k) => {
      expect(features[k], `expected ${k} to be true on diamante`).toBe(true);
    });
  });

  it('returns a fresh object (no shared reference) so callers cannot mutate the matrix', () => {
    const a = getFeaturesForPlan('oro');
    const b = getFeaturesForPlan('oro');
    expect(a).not.toBe(b);
    a.canUseExecutiveDashboard = false;
    expect(getFeaturesForPlan('oro').canUseExecutiveDashboard).toBe(true);
  });

  it('handles every SubscriptionPlan id without throwing', () => {
    const allPlans: SubscriptionPlan[] = [
      'free',
      'cobre',
      'plata',
      'oro',
      'titanio',
      'platino',
      'diamante',
    ];
    for (const p of allPlans) {
      expect(() => getFeaturesForPlan(p)).not.toThrow();
    }
  });
});

describe('resolveEffectiveSubscriptionPlan', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');

  it('uses the shared lifecycle policy for an active paid subscription', () => {
    expect(
      resolveEffectiveSubscriptionPlan(
        { subscription: { planId: 'oro', status: 'active', paymentMethod: 'webpay' } },
        now,
      ),
    ).toBe('oro');
  });

  it.each(['expired', 'revoked'])('downgrades a %s subscription to free', (status) => {
    expect(
      resolveEffectiveSubscriptionPlan(
        { subscription: { planId: 'diamante', status, paymentMethod: 'webpay' } },
        now,
      ),
    ).toBe('free');
  });

  it('does not trust the legacy top-level plan mirror', () => {
    expect(resolveEffectiveSubscriptionPlan({ subscriptionPlan: 'diamante' }, now)).toBe('free');
  });
});
