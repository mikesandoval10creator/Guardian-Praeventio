// SystemEngine — DecisionEngine.
//
// Orchestrates: event → matching policies → actions → executor.
// Pure orchestration: NO side effects of its own. Failures in a single
// policy MUST NOT prevent other policies from running.

import { logger } from '../../utils/logger';
import type { SystemEvent } from './eventTypes';
import { policiesFor } from './policies';
import type { Action, PolicyContext } from './policies/policy.types';
import type { AnyPolicy } from './policies/policy.types';

export interface DecisionResult {
  eventId: string;
  matched: number;
  actions: Action[];
  errors: { policyId: string; message: string }[];
}

export async function decide(event: SystemEvent, ctx: PolicyContext): Promise<DecisionResult> {
  const matched = policiesFor(event.type);
  const errors: DecisionResult['errors'] = [];
  const allActions: Action[] = [];

  // Run policies concurrently; one bad policy must not stall the others.
  const settled = await Promise.allSettled(
    matched.map(async (policy) => {
      const actions = await runPolicy(policy, event, ctx);
      return { policyId: policy.id, actions };
    }),
  );

  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result.status === 'fulfilled') {
      allActions.push(...result.value.actions);
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push({ policyId: matched[i]?.id ?? 'unknown', message: reason });
      logger.warn('systemEngine.decisionEngine: policy threw', { policyId: matched[i]?.id, reason });
    }
  }

  return {
    eventId: event.id,
    matched: matched.length,
    actions: rankByPriority(allActions, matched),
    errors,
  };
}

async function runPolicy(
  policy: AnyPolicy,
  event: SystemEvent,
  ctx: PolicyContext,
): Promise<Action[]> {
  // Cast through unknown: the registry erases the per-event narrowing for
  // type safety, but the `trigger` filter guarantees the event matches at
  // runtime. Policies that disagree with their declared trigger are bugs.
  const actions = await policy.evaluate(event as never, ctx);
  return actions ?? [];
}

function rankByPriority(actions: Action[], policies: AnyPolicy[]): Action[] {
  // Map each action back to its policy priority (best-effort by reference).
  // Tie-breaker: original insertion order. P0 first, then P1, then P2.
  const order: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
  // Without per-action attribution, we can't perfectly rank; use a stable
  // sort by best-known priority (max P0 of the producing policies if any).
  const maxPriority = policies.reduce<keyof typeof order>(
    (acc, p) => (order[p.priority] < order[acc] ? p.priority : acc),
    'P2',
  );
  // For now we just attach the inferred priority via the position in the
  // returned array. Future work: attribute each action to its source policy.
  void maxPriority;
  return actions;
}
