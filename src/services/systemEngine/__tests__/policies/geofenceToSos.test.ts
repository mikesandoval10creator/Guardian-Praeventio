import { describe, expect, it } from 'vitest';

import { geofenceToSosPolicy } from '../../policies/geofenceToSos';
import type { EventOfType } from '../../eventTypes';
import type { PolicyContext } from '../../policies/policy.types';

const mkEvent = (
  overrides: Partial<EventOfType<'geofence_crossed'>['payload']> = {},
): EventOfType<'geofence_crossed'> => ({
  id: 'evt',
  tenantId: 'tA',
  projectId: 'pA',
  ts: 1,
  idempotencyKey: 'k',
  type: 'geofence_crossed',
  payload: {
    workerId: 'w1',
    projectId: 'pA',
    zoneId: 'z1',
    zoneName: 'Bodega ácidos',
    zoneType: 'HAZMAT',
    direction: 'enter',
    lat: 0,
    lng: 0,
    ...overrides,
  },
});

const ctx: PolicyContext = {
  tenantId: 'tA',
  projectId: 'pA',
  isFeatureEnabled: () => true,
  hasActiveEmergency: () => false,
};

describe('geofenceToSos policy', () => {
  it('escalates HAZMAT enter to a SOS', async () => {
    const actions = await geofenceToSosPolicy.evaluate(mkEvent(), ctx);
    expect(actions.find((a) => a.kind === 'trigger_emergency')).toBeDefined();
    expect(actions.find((a) => a.kind === 'notify_contacts')).toBeDefined();
  });

  it('escalates RESTRICTED enter to a SOS with unauthorized_zone type', async () => {
    const actions = await geofenceToSosPolicy.evaluate(mkEvent({ zoneType: 'RESTRICTED' }), ctx);
    const trigger = actions.find((a) => a.kind === 'trigger_emergency');
    expect(trigger).toBeDefined();
    if (trigger?.kind === 'trigger_emergency') {
      expect(trigger.emergencyType).toBe('unauthorized_zone');
    }
  });

  it('only warns on DANGER zones (no SOS)', async () => {
    const actions = await geofenceToSosPolicy.evaluate(mkEvent({ zoneType: 'DANGER' }), ctx);
    expect(actions.find((a) => a.kind === 'trigger_emergency')).toBeUndefined();
    expect(actions.find((a) => a.kind === 'notify_user')).toBeDefined();
  });

  it('skips on direction=exit', async () => {
    const actions = await geofenceToSosPolicy.evaluate(mkEvent({ direction: 'exit' }), ctx);
    expect(actions).toHaveLength(0);
  });

  it('audits the skip when an emergency is already active', async () => {
    const skipCtx: PolicyContext = { ...ctx, hasActiveEmergency: () => true };
    const actions = await geofenceToSosPolicy.evaluate(mkEvent(), skipCtx);
    expect(actions.find((a) => a.kind === 'trigger_emergency')).toBeUndefined();
    expect(actions.find((a) => a.kind === 'audit')).toBeDefined();
  });
});
