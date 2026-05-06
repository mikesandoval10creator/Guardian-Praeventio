// SystemEngine — Subscription context adapter.
//
// Observes the live SubscriptionContext for plan transitions and emits
// `tier_changed` events to the bus so policies (tierChangeReactivity) can
// react. Mounted from SystemEngineProvider; the consumer Context API is
// not modified.
//
// Why a hook adapter vs. modifying the context: keeps the context's public
// API single-purpose (state container) and lets downstream apps opt out of
// the bus by simply not mounting SystemEngineProvider.

import { useEffect, useRef } from 'react';

import { useFirebase } from '../../../contexts/FirebaseContext';
import { useSubscription } from '../../../contexts/SubscriptionContext';
import { buildEnvelope, emit } from '../eventLog';
import { logger } from '../../../utils/logger';

export interface SubscriptionAdapterOptions {
  tenantId: string;
}

export function useSubscriptionContextAdapter({ tenantId }: SubscriptionAdapterOptions): void {
  const { user } = useFirebase();
  const sub = useSubscription();
  const previousPlan = useRef<string | null>(null);

  useEffect(() => {
    if (!tenantId || !sub?.plan) return;
    if (previousPlan.current === null) {
      previousPlan.current = sub.plan;
      return;
    }
    if (previousPlan.current === sub.plan) return;

    const fromTier = previousPlan.current;
    const toTier = sub.plan;
    previousPlan.current = sub.plan;

    void emit({
      ...buildEnvelope({
        tenantId,
        actorUid: user?.uid,
        idempotencyKey: `tier_changed:${user?.uid ?? 'anon'}:${fromTier}->${toTier}:${Date.now()}`,
      }),
      type: 'tier_changed',
      payload: {
        userId: user?.uid ?? '',
        fromTier,
        toTier,
        source: 'webhook',
      },
    }).catch((err) =>
      logger.warn('subscriptionContextAdapter: emit failed', { err: String(err) }),
    );
  }, [sub?.plan, tenantId, user?.uid]);
}
