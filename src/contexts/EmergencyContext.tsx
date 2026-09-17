import React, { createContext, useContext, useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { auth } from '../services/firebase';
import { logger } from '../utils/logger';
import { captureEmergencyError } from '../lib/sentry';
import { enqueueOutbound as meshEnqueueOutbound } from '../services/emergency/meshFallback';
import { randomId } from '../utils/randomId';
import {
  submitEmergencyDelivery,
  subscribeEmergencyDelivery,
  type EmergencyDeliveryStatus,
} from '../services/emergency/emergencyDeliveryOutbox';

interface EmergencyContextType {
  isEmergencyActive: boolean;
  emergencyType: string | null;
  /**
   * Epoch ms when the CURRENT emergency was activated, or null when inactive.
   * Stable for the lifetime of one logical emergency — observers (e.g. the
   * SystemEngine adapter) key their idempotency on this instead of an emit-time
   * clock so a remount or a quick toggle can't spawn duplicate SOS events.
   */
  emergencyStartTime: number | null;
  emergencyDeliveryStatus: EmergencyDeliveryStatus | null;
  triggerEmergency: (type: string, projectId?: string) => Promise<void>;
  resolveEmergency: () => void;
}

const EmergencyContext = createContext<EmergencyContextType | undefined>(undefined);

export function EmergencyProvider({ children }: { children: React.ReactNode }) {
  const [isEmergencyActive, setIsEmergencyActive] = useState(false);
  const [emergencyType, setEmergencyType] = useState<string | null>(null);
  const [emergencyStartTime, setEmergencyStartTime] = useState<number | null>(null);
  const [emergencyDeliveryStatus, setEmergencyDeliveryStatus] = useState<EmergencyDeliveryStatus | null>(null);
  // Tracks the durable activation packet so resolution can be ordered after it.
  const activeEventRef = useRef<{ projectId: string; clientEventId: string } | null>(null);
  const deliveryUnsubscribeRef = useRef<(() => void) | null>(null);
  const deliveryOperationRef = useRef<string | null>(null);

  const triggerEmergency = useCallback(async (type: string, projectId?: string) => {
    // The local alarm is immediate; persistence/FCM must never delay the worker's
    // life-safety interaction.
    setEmergencyType(type);
    setIsEmergencyActive(true);
    const previousSubscription: unknown = deliveryUnsubscribeRef.current;
    deliveryUnsubscribeRef.current = null;
    if (typeof previousSubscription === 'function') previousSubscription();
    activeEventRef.current = null;
    deliveryOperationRef.current = null;
    const startedAt = Date.now();
    setEmergencyStartTime(startedAt);

    if (!projectId) {
      setEmergencyDeliveryStatus(null);
      return;
    }

    const clientEventId = `activation-${startedAt}-${randomId()}`;
    const pendingStatus: EmergencyDeliveryStatus = {
      clientEventId,
      operation: 'activation',
      projectId,
      status: 'pending',
      queued: true,
    };
    activeEventRef.current = { projectId, clientEventId };
    deliveryOperationRef.current = clientEventId;
    setEmergencyDeliveryStatus(pendingStatus);

    try {
      const user = auth.currentUser;
      const attempt = await submitEmergencyDelivery({
        operation: 'activation',
        projectId,
        emergencyType: type,
        occurredAt: new Date(startedAt).toISOString(),
      }, { clientEventId });
      if (deliveryOperationRef.current !== clientEventId) return;
      if (attempt.queued) {
        activeEventRef.current = { projectId, clientEventId: attempt.clientEventId };
      } else {
        activeEventRef.current = null;
      }
      setEmergencyDeliveryStatus(attempt);
      const previousSubscription: unknown = deliveryUnsubscribeRef.current;
      deliveryUnsubscribeRef.current = null;
      if (typeof previousSubscription === 'function') previousSubscription();
      deliveryUnsubscribeRef.current = subscribeEmergencyDelivery(
        attempt.clientEventId,
        setEmergencyDeliveryStatus,
      );

      // If the authoritative HTTP path is unreachable, preserve the existing
      // BLE/WiFi-Direct relay path. A server-side 4xx/5xx is not mislabelled as
      // offline and is surfaced as failed/pending by the outbox.
      if (attempt.failureKind === 'network') {
        const uid = user?.uid ?? 'anonymous';
        try {
          const meshRes = await meshEnqueueOutbound({
            projectId,
            emergencyType: type,
            uid,
            triggeredAtMs: startedAt,
          });
          if (meshRes.enqueued) {
            logger.info('EmergencyContext: SOS encolado en mesh (offline fallback)', {
              packetId: meshRes.packetId,
              type,
              projectId,
            });
          } else {
            logger.warn('EmergencyContext: mesh fallback no enqueued', {
              reason: meshRes.reason,
              type,
              projectId,
            });
          }
        } catch (err) {
          logger.error('EmergencyContext: mesh fallback threw', { err });
          captureEmergencyError(err, { trigger: type, projectId, path: 'mesh_fallback' });
        }
      }
    } catch (err) {
      if (deliveryOperationRef.current !== clientEventId) return;
      const failed: EmergencyDeliveryStatus = {
        ...pendingStatus,
        status: 'failed',
        queued: true,
        failureKind: 'unknown',
        error: err instanceof Error ? err.message : String(err),
      };
      setEmergencyDeliveryStatus(failed);
      logger.error('EmergencyContext: emergency delivery enqueue failed', { err });
      captureEmergencyError(err, { trigger: type, projectId });
    }
  }, []);

  const resolveEmergency = useCallback(() => {
    setIsEmergencyActive(false);
    setEmergencyType(null);
    setEmergencyStartTime(null);

    const ref = activeEventRef.current;
    activeEventRef.current = null;
    if (typeof deliveryUnsubscribeRef.current === 'function') {
      deliveryUnsubscribeRef.current();
    }
    deliveryUnsubscribeRef.current = null;
    deliveryOperationRef.current = null;
    if (!ref) {
      console.warn('[Emergency] resolveEmergency called with no queued activation');
      return;
    }

    const resolutionClientEventId = `resolution-${ref.clientEventId}`;
    deliveryOperationRef.current = resolutionClientEventId;
    void submitEmergencyDelivery({
      operation: 'resolution',
      projectId: ref.projectId,
      eventId: ref.clientEventId,
      occurredAt: new Date().toISOString(),
    }, { clientEventId: resolutionClientEventId }).then((attempt) => {
      if (deliveryOperationRef.current !== resolutionClientEventId) return;
      setEmergencyDeliveryStatus(attempt);
      const previousSubscription: unknown = deliveryUnsubscribeRef.current;
      deliveryUnsubscribeRef.current = null;
      if (typeof previousSubscription === 'function') previousSubscription();
      deliveryUnsubscribeRef.current = subscribeEmergencyDelivery(
        attempt.clientEventId,
        setEmergencyDeliveryStatus,
      );
    }).catch((err) => {
      if (deliveryOperationRef.current !== resolutionClientEventId) return;
      logger.error('EmergencyContext: emergency resolution enqueue failed', { err });
      captureEmergencyError(err, { trigger: 'resolution', projectId: ref.projectId });
    });
  }, []);

  useEffect(() => () => {
    if (typeof deliveryUnsubscribeRef.current === 'function') {
      deliveryUnsubscribeRef.current();
    }
  }, []);

  // Plan 2026-05-23 perf — memoize value. triggerEmergency + resolveEmergency
  // ahora son useCallback (refs estables). Consumers: AppModeContext (mode
  // auto-switching), EmergencyOverlay (root mount), Sidebar (survival mode
  // botón), FallDetectionMonitor, ManDownDetector, varios sensores. Sin
  // esta memoización, cada render del Provider invalidaba toda la cadena
  // de monitoreo de emergencia.
  const contextValue = useMemo(
    () => ({
      isEmergencyActive,
      emergencyType,
      emergencyStartTime,
      emergencyDeliveryStatus,
      triggerEmergency,
      resolveEmergency,
    }),
    [isEmergencyActive, emergencyType, emergencyStartTime, emergencyDeliveryStatus, triggerEmergency, resolveEmergency],
  );

  return (
    <EmergencyContext.Provider value={contextValue}>
      {children}
    </EmergencyContext.Provider>
  );
}

export function useEmergency() {
  const context = useContext(EmergencyContext);
  if (context === undefined) {
    throw new Error('useEmergency must be used within an EmergencyProvider');
  }
  return context;
}
