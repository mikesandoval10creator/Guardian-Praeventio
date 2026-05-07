import { afterEach, describe, expect, it, vi } from 'vitest';

import { decide } from '../decisionEngine';
import {
  __resetRegistryForTests,
  registerPolicy,
} from '../policies';
import type { Action, Policy, PolicyContext } from '../policies/policy.types';
import type { EventOfType, SystemEvent } from '../eventTypes';

const mkCtx = (overrides: Partial<PolicyContext> = {}): PolicyContext => ({
  tenantId: 'tenant-A',
  projectId: 'project-A',
  isFeatureEnabled: () => true,
  hasActiveEmergency: () => false,
  ...overrides,
});

const mkFallEvent = (): EventOfType<'fall_detected'> => ({
  id: 'e1',
  tenantId: 'tenant-A',
  projectId: 'project-A',
  actorUid: 'u1',
  ts: 1,
  idempotencyKey: 'k1',
  type: 'fall_detected',
  payload: { workerId: 'u1', projectId: 'project-A', confidence: 0.9, accelMagnitude: 30 },
});

afterEach(() => {
  __resetRegistryForTests();
});

describe('decisionEngine', () => {
  it('runs only policies whose trigger includes the event type', async () => {
    const fallSpy = vi.fn(() => [
      { kind: 'audit', action: 'fall' } as Action,
    ]);
    const sosSpy = vi.fn(() => [{ kind: 'audit', action: 'sos' } as Action]);

    const fallPolicy: Policy<'fall_detected'> = {
      id: 'p.fall',
      description: 'fall',
      priority: 'P0',
      trigger: ['fall_detected'],
      evaluate: fallSpy,
    };
    const sosPolicy: Policy<'sos_triggered'> = {
      id: 'p.sos',
      description: 'sos',
      priority: 'P0',
      trigger: ['sos_triggered'],
      evaluate: sosSpy,
    };
    registerPolicy(fallPolicy);
    registerPolicy(sosPolicy);

    const result = await decide(mkFallEvent() as SystemEvent, mkCtx());
    expect(result.matched).toBe(1);
    expect(fallSpy).toHaveBeenCalledTimes(1);
    expect(sosSpy).not.toHaveBeenCalled();
    expect(result.actions).toHaveLength(1);
    expect((result.actions[0] as { action: string }).action).toBe('fall');
  });

  it('isolates failing policies from succeeding ones', async () => {
    const goodActions = [{ kind: 'audit', action: 'good' } as Action];
    registerPolicy<'fall_detected'>({
      id: 'p.bad',
      description: 'always throws',
      priority: 'P0',
      trigger: ['fall_detected'],
      evaluate: async () => {
        throw new Error('intentional');
      },
    });
    registerPolicy<'fall_detected'>({
      id: 'p.good',
      description: 'returns one action',
      priority: 'P1',
      trigger: ['fall_detected'],
      evaluate: () => goodActions,
    });

    const result = await decide(mkFallEvent() as SystemEvent, mkCtx());
    expect(result.matched).toBe(2);
    expect(result.actions).toEqual(goodActions);
    expect(result.errors.length).toBe(1);
  });

  it('returns 0 matched when no policy is registered', async () => {
    const result = await decide(mkFallEvent() as SystemEvent, mkCtx());
    expect(result.matched).toBe(0);
    expect(result.actions).toHaveLength(0);
  });
});
