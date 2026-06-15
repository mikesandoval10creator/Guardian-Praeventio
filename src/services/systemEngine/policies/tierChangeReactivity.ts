// SystemEngine — Policy: tier_changed → reactive feature-flag refresh.
//
// Closes the orphan flow detected by the cross-module integration agent:
// when a Webpay/MercadoPago/RTDN webhook upgrades a user's tier and writes
// to Firestore, no React context invalidation reaches the running app
// session. Users would see stale tier-gated UI until the next cold reload.
//
// This policy translates the tier_changed event into:
//   1. invalidate_context('subscription') — forces SubscriptionContext to
//      refetch.
//   2. refresh_feature_flags(userId) — re-evaluates feature gates.
//   3. notify_user — explicit user-facing acknowledgement of the upgrade
//      or downgrade.
//   4. audit log (denied/ok semantics depending on the source).

import type { Policy } from './policy.types';
// Use the canonical PLAN_RANK via planRank() — NOT a local copy. A duplicated
// rank table here silently drifts when the canonical ranks change (e.g. adding
// an intermediate tier renumbers everything). planRank() also normalizes legacy
// aliases + fails closed to rank 0 for unknown plans.
import { planRank } from '../../pricing/subscriptionPlan.js';

function direction(from: string, to: string): 'upgrade' | 'downgrade' | 'sidestep' {
  const f = planRank(from);
  const t = planRank(to);
  if (t > f) return 'upgrade';
  if (t < f) return 'downgrade';
  return 'sidestep';
}

export const tierChangeReactivityPolicy: Policy<'tier_changed'> = {
  id: 'tier_change_reactivity',
  description: 'Invalidate subscription context and refresh feature flags after tier change',
  priority: 'P1',
  trigger: ['tier_changed'],
  evaluate: (event) => {
    const { userId, fromTier, toTier, source } = event.payload;
    const dir = direction(fromTier, toTier);

    const message =
      dir === 'upgrade'
        ? `Tu plan se actualizó a ${toTier}. Las nuevas funciones ya están disponibles.`
        : dir === 'downgrade'
        ? `Tu plan cambió a ${toTier}. Algunas funciones pueden quedar deshabilitadas.`
        : `Tu plan se sincronizó como ${toTier}.`;

    return [
      { kind: 'invalidate_context', contextName: 'subscription' },
      { kind: 'refresh_feature_flags', userId },
      {
        kind: 'notify_user',
        userId,
        title: dir === 'upgrade' ? '🎉 Plan actualizado' : 'Plan actualizado',
        message,
        severity: dir === 'downgrade' ? 'warning' : 'success',
      },
      {
        kind: 'audit',
        action: `systemEngine.tier_change_reactivity.${dir}`,
        resourceId: userId,
        metadata: { fromTier, toTier, source },
      },
    ];
  },
};
