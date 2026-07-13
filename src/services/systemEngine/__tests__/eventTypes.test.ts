import { describe, expect, it } from 'vitest';

import {
  ALL_EVENT_TYPES,
  SystemEventSchema,
  isSystemEvent,
} from '../eventTypes';

describe('SystemEvent schema', () => {
  it('accepts a well-formed fall_detected event', () => {
    const ev = {
      id: 'event-1',
      tenantId: 'tenant-A',
      projectId: 'project-A',
      actorUid: 'user-1',
      ts: 1_700_000_000_000,
      idempotencyKey: 'idem-1',
      type: 'fall_detected' as const,
      payload: {
        workerId: 'user-1',
        projectId: 'project-A',
        confidence: 0.92,
        accelMagnitude: 28,
      },
    };
    expect(isSystemEvent(ev)).toBe(true);
  });

  it('rejects events with missing required envelope fields', () => {
    const ev = {
      id: 'event-1',
      // tenantId missing on purpose
      ts: Date.now(),
      idempotencyKey: 'idem-1',
      type: 'fall_detected',
      payload: { workerId: 'w', projectId: 'p', confidence: 0.5, accelMagnitude: 10 },
    };
    const parsed = SystemEventSchema.safeParse(ev);
    expect(parsed.success).toBe(false);
  });

  it('rejects events with payload that does not match the discriminator', () => {
    const ev = {
      id: 'event-1',
      tenantId: 'tenant-A',
      ts: Date.now(),
      idempotencyKey: 'idem-1',
      type: 'fall_detected',
      payload: { workerId: 'w', projectId: 'p' },
    };
    const parsed = SystemEventSchema.safeParse(ev);
    expect(parsed.success).toBe(false);
  });

  it('exports a non-empty list of all event types', () => {
    expect(ALL_EVENT_TYPES.length).toBeGreaterThan(0);
    expect(new Set(ALL_EVENT_TYPES).size).toBe(ALL_EVENT_TYPES.length);
  });

  it('accepts a geofence crossing without invented coordinates when no fix exists', () => {
    const parsed = SystemEventSchema.safeParse({
      id: 'event-geofence-no-fix',
      tenantId: 'tenant-A',
      projectId: 'project-A',
      actorUid: 'worker-1',
      ts: Date.now(),
      idempotencyKey: 'geo:worker-1:zone-1:enter:1',
      type: 'geofence_crossed',
      payload: {
        workerId: 'worker-1',
        projectId: 'project-A',
        zoneId: 'zone-1',
        zoneName: 'Zona 1',
        zoneType: 'HAZMAT',
        direction: 'enter',
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('rejects a partial geofence coordinate pair', () => {
    const base = {
      id: 'event-geofence-partial-fix',
      tenantId: 'tenant-A',
      projectId: 'project-A',
      actorUid: 'worker-1',
      ts: Date.now(),
      idempotencyKey: 'geo:worker-1:zone-1:enter:2',
      type: 'geofence_crossed',
      payload: {
        workerId: 'worker-1',
        projectId: 'project-A',
        zoneId: 'zone-1',
        zoneName: 'Zona 1',
        zoneType: 'HAZMAT',
        direction: 'enter',
        lat: -33.4489,
      },
    };

    expect(SystemEventSchema.safeParse(base).success).toBe(false);
  });

  it('accepts every documented event type with a minimal payload', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['sos_triggered', { workerId: 'w', projectId: 'p', emergencyType: 'fall', origin: 'fall_detection' }],
      ['geofence_crossed', { workerId: 'w', projectId: 'p', zoneId: 'z', zoneName: 'Z', zoneType: 'HAZMAT', direction: 'enter', lat: 0, lng: 0 }],
      ['countdown_expired', { workerId: 'w', projectId: 'p', context: 'fall_detection' }],
      ['node_created', { nodeId: 'n', projectId: 'p', nodeType: 'Riesgo' }],
      ['node_linked', { sourceId: 'a', targetId: 'b', projectId: 'p' }],
      ['normative_updated', { normativeId: 'DS594', jurisdiction: 'CL' }],
      ['tier_changed', { userId: 'u', fromTier: 'free', toTier: 'pro', source: 'webhook' }],
      ['entitlement_revoked', { userId: 'u', reason: 'expired' }],
      ['weather_alert', { projectId: 'p', kind: 'wind', value: 80, unit: 'km/h' }],
      ['seismic_event', { magnitude: 5.5, depthKm: 30, lat: 0, lng: 0, timestampMs: Date.now() }],
      ['zettelkasten_health_changed', { projectId: 'p', score: 75, components: 1, cycles: 0, hasEulerianPath: true, hasEulerianCycle: false }],
      ['audit_log_appended', { action: 'auth.login', actorUid: 'u', result: 'ok' }],
    ];
    for (const [type, payload] of cases) {
      const ev = {
        id: 'event-' + type,
        tenantId: 'tenant-A',
        ts: Date.now(),
        idempotencyKey: 'idem-' + type,
        type,
        payload,
      };
      expect(isSystemEvent(ev), `expected ${type} to validate`).toBe(true);
    }
  });
});
