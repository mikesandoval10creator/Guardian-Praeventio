// Praeventio Guard — notification deep-link contract tests.
//
// [P1][VIDA] "Tocar una notificacion critica no abre la emergencia".
// The pure resolver maps an FCM `data` map (the shape the server actually
// sends — see src/server/routes/emergency.ts and backgroundTriggers.ts) to
// the in-app path we must navigate to when the worker taps the notification.
// Testing the pure function pins the contract by alert type without dragging
// in the service worker, Capacitor, or a router tree.

import { describe, it, expect } from 'vitest';
import { resolveNotificationDeepLink } from './notificationDeepLink';

describe('resolveNotificationDeepLink', () => {
  it('routes an SOS alert to the emergency dashboard carrying alertId + projectId', () => {
    const { url, projectId } = resolveNotificationDeepLink({
      projectId: 'proj-1',
      alertId: 'alert-9',
      type: 'sos',
      uid: 'user-7',
    });
    expect(projectId).toBe('proj-1');
    // The screen that actually subscribes to emergency_alerts — NOT /emergency.
    expect(url.startsWith('/emergencia-avanzada?')).toBe(true);
    const qs = new URLSearchParams(url.split('?')[1]);
    expect(qs.get('alertId')).toBe('alert-9');
    expect(qs.get('projectId')).toBe('proj-1');
    expect(qs.get('source')).toBe('push');
  });

  it('routes a climate/geofence emergency (emergencyType) to the emergency dashboard', () => {
    const { url } = resolveNotificationDeepLink({
      projectId: 'proj-2',
      emergencyType: 'hazmat_zone',
      timestamp: '2026-07-17T00:00:00.000Z',
    });
    expect(url.startsWith('/emergencia-avanzada?')).toBe(true);
    const qs = new URLSearchParams(url.split('?')[1]);
    expect(qs.get('emergencyType')).toBe('hazmat_zone');
    expect(qs.get('projectId')).toBe('proj-2');
    expect(qs.get('source')).toBe('push');
  });

  it('routes a critical-incident notification (nodeId) to that incident bundle', () => {
    // This is the ACTUAL payload backgroundTriggers.ts:309 emits.
    const { url, projectId } = resolveNotificationDeepLink({
      projectId: 'proj-3',
      nodeId: 'node-42',
    });
    expect(projectId).toBe('proj-3');
    expect(url.startsWith('/incidents/node-42/bundle')).toBe(true);
    const qs = new URLSearchParams(url.split('?')[1] ?? '');
    expect(qs.get('projectId')).toBe('proj-3');
    expect(qs.get('source')).toBe('push');
  });

  it('accepts incidentId as a forward-compatible alias for the incident bundle', () => {
    const { url } = resolveNotificationDeepLink({ projectId: 'p', incidentId: 'inc-42' });
    expect(url.startsWith('/incidents/inc-42/bundle')).toBe(true);
  });

  it('falls back to a safe in-app screen for unknown/soft notifications', () => {
    const { url, projectId } = resolveNotificationDeepLink({
      projectId: 'proj-4',
      someUnknownField: 'x',
    });
    // Unknown type must never crash nor open the wrong emergency.
    expect(url.startsWith('/notifications')).toBe(true);
    expect(projectId).toBe('proj-4');
  });

  it('never throws and returns a safe fallback for missing/empty data', () => {
    for (const bad of [undefined, null, {}, 'nope' as unknown as Record<string, string>]) {
      const { url, projectId } = resolveNotificationDeepLink(
        bad as Record<string, string> | undefined,
      );
      expect(url.startsWith('/notifications')).toBe(true);
      expect(projectId).toBeNull();
    }
  });

  it('only ever produces a relative in-app path (no scheme/host — open-redirect safe)', () => {
    const { url } = resolveNotificationDeepLink({
      projectId: 'p',
      // hostile payload trying to smuggle an absolute URL
      alertId: 'https://evil.example/steal',
      type: 'sos',
    });
    expect(url.startsWith('/emergencia-avanzada')).toBe(true);
    expect(/^https?:\/\//i.test(url)).toBe(false);
    // the hostile value is carried only as an encoded query param
    const qs = new URLSearchParams(url.split('?')[1]);
    expect(qs.get('alertId')).toBe('https://evil.example/steal');
  });
});
