// SystemEngine — Policy: geofence_crossed → SOS escalation.
//
// Closes the orphan flow detected by the cross-module integration agent:
// useGeofence today fires onZoneEntry callbacks, plays an alarm tone, and
// vibrates — but it never escalates a HAZMAT/RESTRICTED entry to a real
// SOS event with brigade fan-out. Workers can step into a danger zone, get
// a local toast, and supervisors are never notified.
//
// This policy fires only on `direction='enter'` into HAZMAT or RESTRICTED
// zones. DANGER zones produce a softer notification but no full SOS.
// Already-active emergencies short-circuit the cascade.

import type { Policy } from './policy.types';

export const geofenceToSosPolicy: Policy<'geofence_crossed'> = {
  id: 'geofence_to_sos',
  description: 'Escalate restricted/hazmat zone entries to a SOS emergency',
  priority: 'P0',
  trigger: ['geofence_crossed'],
  evaluate: (event, ctx) => {
    const { workerId, projectId, zoneId, zoneName, zoneType, direction } = event.payload;

    if (direction !== 'enter') return [];

    if (ctx.hasActiveEmergency()) {
      return [
        {
          kind: 'audit',
          action: 'systemEngine.geofence_to_sos.skipped_active_emergency',
          resourceId: zoneId,
          metadata: { workerId, projectId, zoneType },
        },
      ];
    }

    if (zoneType === 'HAZMAT' || zoneType === 'RESTRICTED') {
      return [
        {
          kind: 'trigger_emergency',
          emergencyType: zoneType === 'HAZMAT' ? 'hazmat_zone' : 'unauthorized_zone',
          projectId,
          reason: `Worker entered ${zoneType} zone "${zoneName}"`,
        },
        {
          kind: 'audit',
          action: 'systemEngine.geofence_to_sos.escalated',
          resourceId: zoneId,
          metadata: { workerId, projectId, zoneType, zoneName },
        },
      ];
    }

    // DANGER zones: soft notification only.
    return [
      {
        kind: 'notify_user',
        userId: workerId,
        title: 'Zona de peligro',
        message: `Has ingresado a "${zoneName}". Procede con precaución y respeta el protocolo.`,
        severity: 'warning',
      },
      {
        kind: 'audit',
        action: 'systemEngine.geofence_to_sos.danger_warning',
        resourceId: zoneId,
        metadata: { workerId, projectId, zoneName },
      },
    ];
  },
};
