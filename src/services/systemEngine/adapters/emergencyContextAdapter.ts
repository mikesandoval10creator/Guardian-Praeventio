// SystemEngine — Emergency context adapter.
//
// Observes EmergencyContext for transitions of `isEmergencyActive` and
// emits `sos_triggered` to the bus. Does NOT modify the context — the
// adapter is a passive observer mounted from SystemEngineProvider.

import { useEffect, useRef } from 'react';

import { useEmergency } from '../../../contexts/EmergencyContext';
import { useFirebase } from '../../../contexts/FirebaseContext';
import { useProject } from '../../../contexts/ProjectContext';
import { buildEnvelope, emit } from '../eventLog';
import { logger } from '../../../utils/logger';

export interface EmergencyAdapterOptions {
  tenantId: string;
}

export function useEmergencyContextAdapter({ tenantId }: EmergencyAdapterOptions): void {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const { isEmergencyActive, emergencyType, emergencyStartTime } = useEmergency();
  const wasActiveRef = useRef<boolean>(false);

  useEffect(() => {
    if (!tenantId || !user?.uid) return;
    if (isEmergencyActive && !wasActiveRef.current) {
      wasActiveRef.current = true;
      const projectId = selectedProject?.id ?? '';
      const inferredOrigin = inferOrigin(emergencyType);

      // Idempotency key is tied to the emergency ACTIVATION (emergencyStartTime),
      // not the emit-time clock. A `Date.now()` here made every call unique, so
      // the eventLog's 1h idempotency ring never deduped — a remount, a
      // StrictMode double-invoke, or a quick active→inactive→active toggle
      // emitted DUPLICATE sos_triggered events for the SAME emergency. Keying on
      // the activation timestamp makes this SOS observability event idempotent.
      const emergencyKey = emergencyStartTime ?? 'unknown';

      // Awaited (via IIFE — effects can't be async): emit() returns { ok: false }
      // WITHOUT throwing for validation/queue failures, so the old `.catch`-only
      // path silently dropped those. A dropped SOS audit event is a compliance
      // gap, so surface both the rejected and the not-ok cases.
      void (async () => {
        try {
          const result = await emit({
            ...buildEnvelope({
              tenantId,
              projectId,
              actorUid: user.uid,
              idempotencyKey: `sos:${user.uid}:${emergencyType ?? 'unknown'}:${emergencyKey}`,
            }),
            type: 'sos_triggered',
            payload: {
              workerId: user.uid,
              projectId,
              emergencyType: emergencyType ?? 'unknown',
              origin: inferredOrigin,
            },
          });
          if (!result.ok) {
            logger.error('emergencyContextAdapter: sos_triggered emit not ok', {
              error: result.error,
            });
          }
        } catch (err) {
          logger.error('emergencyContextAdapter: sos_triggered emit threw', {
            err: String(err),
          });
        }
      })();
    } else if (!isEmergencyActive && wasActiveRef.current) {
      wasActiveRef.current = false;
    }
  }, [isEmergencyActive, emergencyType, emergencyStartTime, selectedProject?.id, tenantId, user?.uid]);
}

function inferOrigin(type: string | null): 'user_button' | 'fall_detection' | 'mandown' | 'geofence' | 'iot' | 'other' {
  if (!type) return 'other';
  const t = type.toLowerCase();
  if (t.includes('fall')) return 'fall_detection';
  if (t.includes('mandown') || t === 'man_down') return 'mandown';
  if (t.includes('zone') || t.includes('geofence') || t.includes('hazmat') || t.includes('unauthorized')) return 'geofence';
  if (t.includes('iot') || t.includes('telemetry')) return 'iot';
  if (t === 'sos' || t === 'panic') return 'user_button';
  return 'other';
}
