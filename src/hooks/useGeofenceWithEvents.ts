// SystemEngine — Geofence wrapper hook.
//
// `useGeofence` itself is a hot, low-level hook used in safety-critical
// paths; we don't want to add a Firebase dependency to it. Instead, this
// wrapper hook composes `useGeofence` with an `emit` call so consumers
// that opt-in get bus events for free.
//
// Drop-in replacement for `useGeofence(zones, onZoneEntry)` when the
// caller has a tenantId + projectId in scope.

import { useCallback, useRef } from 'react';

import {
  useGeofence,
  type GeofencePosition,
  type GeofenceZone,
} from './useGeofence';
import { buildEnvelope, emit } from '../services/systemEngine/eventLog';
import { logger } from '../utils/logger';

export interface UseGeofenceWithEventsOptions {
  tenantId: string;
  projectId: string;
  workerId: string;
}

export function useGeofenceWithEvents(
  zones: GeofenceZone[],
  opts: UseGeofenceWithEventsOptions,
  onZoneEntry?: (zones: GeofenceZone[]) => void,
) {
  const onEntryRef = useRef(onZoneEntry);
  onEntryRef.current = onZoneEntry;
  const insideRef = useRef<Set<string>>(new Set());

  const wrapped = useCallback(
    (activeZones: GeofenceZone[], position?: GeofencePosition) => {
      const activeIds = new Set(activeZones.map((zone) => zone.id));
      const previouslyInside = insideRef.current;
      const newlyEntered = activeZones.filter(zone => !previouslyInside.has(zone.id));

      // Detect new entries (not previously inside).
      for (const zone of newlyEntered) {
        emitGeofenceCrossed(zone, 'enter', opts, position).catch((err) =>
          logger.warn('useGeofenceWithEvents: enter emit failed', { err: String(err) }),
        );
      }

      // Detect exits (previously inside but no longer).
      for (const previousId of previouslyInside) {
        if (activeIds.has(previousId)) continue;
        const previousZone = zones.find((z) => z.id === previousId);
        if (previousZone) {
          emitGeofenceCrossed(previousZone, 'exit', opts, position).catch((err) =>
            logger.warn('useGeofenceWithEvents: exit emit failed', { err: String(err) }),
          );
        }
      }

      insideRef.current = new Set(activeIds);
      if (newlyEntered.length > 0) onEntryRef.current?.(newlyEntered);
    },
    [opts, zones],
  );

  return useGeofence(zones, wrapped);
}

async function emitGeofenceCrossed(
  zone: GeofenceZone,
  direction: 'enter' | 'exit',
  opts: UseGeofenceWithEventsOptions,
  position?: GeofencePosition,
): Promise<void> {
  await emit({
    ...buildEnvelope({
      tenantId: opts.tenantId,
      projectId: opts.projectId,
      actorUid: opts.workerId,
      idempotencyKey: `geo:${opts.workerId}:${zone.id}:${direction}:${Math.floor(Date.now() / 5000)}`,
    }),
    type: 'geofence_crossed',
    payload: {
      workerId: opts.workerId,
      projectId: opts.projectId,
      zoneId: zone.id,
      zoneName: zone.name,
      zoneType: zone.type,
      direction,
      ...(position ? { lat: position.lat, lng: position.lng } : {}),
    },
  });
}
