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

const PLAN_RANK: Record<string, number> = {
  free: 0, comite: 1, departamento: 2, plata: 3, oro: 4,
  titanio: 5, platino: 6, empresarial: 7, corporativo: 8, ilimitado: 9,
};

function direction(from: string, to: string): 'upgrade' | 'downgrade' | 'sidestep' {
  const f = PLAN_RANK[from] ?? 0;
  const t = PLAN_RANK[to] ?? 0;
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
