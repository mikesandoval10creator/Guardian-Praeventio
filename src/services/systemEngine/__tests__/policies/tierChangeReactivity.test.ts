import { describe, expect, it } from 'vitest';

import { tierChangeReactivityPolicy } from '../../policies/tierChangeReactivity';
import type { EventOfType } from '../../eventTypes';
import type { Action, PolicyContext } from '../../policies/policy.types';

const ctx: PolicyContext = {
  tenantId: 'tA',
  isFeatureEnabled: () => true,
  hasActiveEmergency: () => false,
};

const mkEvent = (fromTier: string, toTier: string): EventOfType<'tier_changed'> => ({
  id: 'evt',
  tenantId: 'tA',
  ts: 1,
  idempotencyKey: 'k',
  type: 'tier_changed',
  payload: { userId: 'u1', fromTier, toTier, source: 'webhook' },
});

const findAction = <K extends Action['kind']>(actions: Action[], kind: K) =>
  actions.find((a) => a.kind === kind) as Extract<Action, { kind: K }> | undefined;

describe('tierChangeReactivity policy', () => {
  it('emits invalidate + refresh + notify + audit on upgrade', async () => {
    const actions = await tierChangeReactivityPolicy.evaluate(mkEvent('free', 'oro'), ctx);
    expect(actions).toHaveLength(4);
    expect(findAction(actions, 'invalidate_context')?.contextName).toBe('subscription');
    expect(findAction(actions, 'refresh_feature_flags')?.userId).toBe('u1');
    expect(findAction(actions, 'notify_user')?.severity).toBe('success');
    expect(findAction(actions, 'audit')?.action).toBe('systemEngine.tier_change_reactivity.upgrade');
  });

  it('flags downgrade with severity=warning', async () => {
    const actions = await tierChangeReactivityPolicy.evaluate(mkEvent('titanio', 'free'), ctx);
    expect(findAction(actions, 'notify_user')?.severity).toBe('warning');
    expect(findAction(actions, 'audit')?.action).toBe('systemEngine.tier_change_reactivity.downgrade');
  });

  it('handles same-rank sidestep', async () => {
    const actions = await tierChangeReactivityPolicy.evaluate(mkEvent('oro', 'oro'), ctx);
    expect(findAction(actions, 'audit')?.action).toBe('systemEngine.tier_change_reactivity.sidestep');
  });
});
