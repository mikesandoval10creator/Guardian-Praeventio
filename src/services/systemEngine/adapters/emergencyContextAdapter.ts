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
  const { isEmergencyActive, emergencyType } = useEmergency();
  const wasActiveRef = useRef<boolean>(false);

  useEffect(() => {
    if (!tenantId || !user?.uid) return;
    if (isEmergencyActive && !wasActiveRef.current) {
      wasActiveRef.current = true;
      const projectId = selectedProject?.id ?? '';
      const inferredOrigin = inferOrigin(emergencyType);

      void emit({
        ...buildEnvelope({
          tenantId,
          projectId,
          actorUid: user.uid,
          idempotencyKey: `sos:${user.uid}:${emergencyType ?? 'unknown'}:${Date.now()}`,
        }),
        type: 'sos_triggered',
        payload: {
          workerId: user.uid,
          projectId,
          emergencyType: emergencyType ?? 'unknown',
          origin: inferredOrigin,
        },
      }).catch((err) =>
        logger.warn('emergencyContextAdapter: emit failed', { err: String(err) }),
      );
    } else if (!isEmergencyActive && wasActiveRef.current) {
      wasActiveRef.current = false;
    }
  }, [isEmergencyActive, emergencyType, selectedProject?.id, tenantId, user?.uid]);
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
