import { afterEach, describe, expect, it, vi } from 'vitest';

import { bindExecutor, execute, unbindExecutor } from '../executor';
import type { Action } from '../policies/policy.types';

vi.mock('../../auditService', () => ({
  logAuditAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../eventLog', () => ({
  emit: vi.fn().mockResolvedValue({ ok: true, eventId: 'mocked' }),
}));

afterEach(() => {
  unbindExecutor();
  vi.clearAllMocks();
});

describe('executor', () => {
  it('routes trigger_emergency to the bound triggerEmergency', async () => {
    const triggerEmergency = vi.fn().mockResolvedValue(undefined);
    bindExecutor({ triggerEmergency });

    await execute([
      {
        kind: 'trigger_emergency',
        emergencyType: 'fall',
        projectId: 'p1',
        reason: 'unit-test',
      } as Action,
    ]);

    expect(triggerEmergency).toHaveBeenCalledWith('fall', 'p1');
  });

  it('routes notify_user to addNotification', async () => {
    const addNotification = vi.fn();
    bindExecutor({ addNotification });

    await execute([
      {
        kind: 'notify_user',
        userId: 'u1',
        title: 'Hi',
        message: 'msg',
        severity: 'warning',
      } as Action,
    ]);

    expect(addNotification).toHaveBeenCalledWith({ title: 'Hi', message: 'msg', type: 'warning' });
  });

  it('routes invalidate_context to the matching invalidator', async () => {
    const invalidateSubscription = vi.fn();
    const invalidateProject = vi.fn();
    bindExecutor({ invalidateSubscription, invalidateProject });

    await execute([
      { kind: 'invalidate_context', contextName: 'subscription' } as Action,
      { kind: 'invalidate_context', contextName: 'project' } as Action,
    ]);

    expect(invalidateSubscription).toHaveBeenCalledTimes(1);
    expect(invalidateProject).toHaveBeenCalledTimes(1);
  });

  it('does not throw when a binding is missing', async () => {
    bindExecutor({});
    await expect(
      execute([
        { kind: 'trigger_emergency', emergencyType: 'sos', projectId: 'p', reason: 'x' } as Action,
      ]),
    ).resolves.toBeUndefined();
  });

  it('isolates a throwing binding from the rest of the dispatch', async () => {
    const triggerEmergency = vi.fn().mockRejectedValue(new Error('boom'));
    const addNotification = vi.fn();
    bindExecutor({ triggerEmergency, addNotification });

    await execute([
      { kind: 'trigger_emergency', emergencyType: 'sos', projectId: 'p', reason: 'x' } as Action,
      { kind: 'notify_user', userId: 'u', title: 't', message: 'm', severity: 'info' } as Action,
    ]);

    expect(triggerEmergency).toHaveBeenCalled();
    expect(addNotification).toHaveBeenCalled();
  });
});
