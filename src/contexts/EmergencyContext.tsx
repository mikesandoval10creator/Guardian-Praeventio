import React, { createContext, useContext, useState, useRef, useCallback, useMemo } from 'react';
import { db, auth, serverTimestamp } from '../services/firebase';
import { collection, addDoc, doc, updateDoc } from 'firebase/firestore';
import { logger } from '../utils/logger';
import { captureEmergencyError } from '../lib/sentry';
import { isOnline } from '../utils/networkStatus';
import { enqueueOutbound as meshEnqueueOutbound } from '../services/emergency/meshFallback';

// Sprint 32 audit W1 — map raw trigger types to the FCM brigade-notify
// enum accepted by POST /api/emergency/notify-brigada (Zod whitelist).
// Anything outside the whitelist degrades to 'other' so the supervisor
// fan-out still happens.
const NOTIFY_BRIGADA_ENUM = new Set(['fall', 'sos', 'medical', 'fire', 'gas', 'collapse', 'other']);
function toBrigadaType(rawType: string): string {
  const t = rawType.toLowerCase();
  return NOTIFY_BRIGADA_ENUM.has(t) ? t : 'other';
}

/**
 * Sprint 32 audit W1 — server-side fan-out trigger. Mirrors the SOS Firestore
 * write into an FCM push to all SUPERVISOR_ROLES of the project, via the
 * canonical `sendToProjectSupervisors` helper. Fire-and-forget so a slow
 * server (or a network blackout) cannot block the local UI mode switch.
 *
 * Why this exists: prior to Sprint 32, every emergency path (fall detection,
 * AppModeContext auto-monitor, EmergencySimulator) wrote to Firestore but
 * never asked the server to push. Supervisors only saw alerts when they
 * happened to be inside the app. The H7 token-store fix was useless without
 * a caller to actually trigger the fan-out.
 */
// Sprint 33 W10 — el resultado distingue tres caminos para que el caller
// decida si gatillar el mesh fallback (ADR 0013). 'network-fail' = device
// offline o fetch rejected (TypeError/NetworkError). 'server-error' = el
// server respondió 5xx → bug del backend, NO offline → mesh fallback NO
// aplica (peers tampoco van a poder llegar al server). 'ok' = todo bien.
type NotifyResult = 'ok' | 'network-fail' | 'server-error';

async function notifyBrigadeServer(
  type: string,
  projectId: string,
): Promise<NotifyResult> {
  // Pre-check rápido: si `navigator.onLine === false` ya sabemos que el
  // fetch va a fallar → cortocircuitamos al mesh fallback sin gastar el
  // round-trip. Caso típico: minero entrando al túnel, alerta inmediata.
  if (!isOnline()) {
    logger.warn('EmergencyContext: device offline — skipping server fan-out', {
      type,
      projectId,
    });
    return 'network-fail';
  }
  try {
    const user = auth.currentUser;
    // Sin auth local NO podemos firmar el server call — pero esto NO es 'ok':
    // el fan-out no ocurrió. Devolvemos 'network-fail' para que el caller
    // dispare el mesh fallback (BLE), donde un peer CON sesión relaya el SOS al
    // server por nosotros (mismo camino que offline). Devolver 'ok' aquí
    // descartaba la alerta en silencio (audit 2026-07-02 §3.1).
    if (!user) return 'network-fail';
    // §2.20 (2026-05-23) — usar apiAuthHeader unified (E2E + Bearer fallback).
    const { apiAuthHeader } = await import('../lib/apiAuth');
    const authHeader = await apiAuthHeader();
    if (!authHeader) return 'network-fail';
    const res = await fetch('/api/emergency/notify-brigada', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {}),
      },
      body: JSON.stringify({
        projectId,
        emergencyType: toBrigadaType(type),
        message: `Activación automática: ${type}`,
      }),
    });
    if (!res.ok) {
      // 5xx no es offline — el server está vivo, su lógica falló. El
      // mesh tampoco va a salvarnos (peers usan el mismo backend). Sigue
      // el camino fail-soft del Firestore doc.
      logger.warn('EmergencyContext: notify-brigada returned non-OK', {
        status: res.status,
      });
      return 'server-error';
    }
    return 'ok';
  } catch (err) {
    // fetch rejected → TypeError "Failed to fetch" (DNS / CORS / red).
    // Tratamos como network-fail incluso si navigator.onLine mintió true.
    logger.warn('EmergencyContext: notify-brigada server call failed', { err });
    return 'network-fail';
  }
}

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
  triggerEmergency: (type: string, projectId?: string) => Promise<void>;
  resolveEmergency: () => void;
}

const EmergencyContext = createContext<EmergencyContextType | undefined>(undefined);

export function EmergencyProvider({ children }: { children: React.ReactNode }) {
  const [isEmergencyActive, setIsEmergencyActive] = useState(false);
  const [emergencyType, setEmergencyType] = useState<string | null>(null);
  const [emergencyStartTime, setEmergencyStartTime] = useState<number | null>(null);
  // Tracks the Firestore doc created by triggerEmergency so resolveEmergency can update it
  const activeEventRef = useRef<{ projectId: string; docId: string } | null>(null);

  // Plan 2026-05-23 perf — useCallback para ref estable. Esta closure
  // solo lee module-level imports (auth, db, serverTimestamp, etc.) y
  // useState setters (estables) + activeEventRef (estable). Empty deps
  // array es correcto: nada del scope React cambia entre renders.
  const triggerEmergency = useCallback(async (type: string, projectId?: string) => {
    setEmergencyType(type);
    setIsEmergencyActive(true);
    // Stamp the activation moment once so observers have a stable emergency key.
    setEmergencyStartTime(Date.now());

    if (!projectId) return;
    try {
      const user = auth.currentUser;
      const docRef = await addDoc(
        collection(db, `projects/${projectId}/emergency_events`),
        {
          type,
          triggeredBy: user?.uid ?? null,
          triggeredByName: user?.displayName ?? null,
          status: 'active',
          createdAt: serverTimestamp(),
        }
      );
      activeEventRef.current = { projectId, docId: docRef.id };
    } catch (err) {
      logger.error('EmergencyContext: failed to persist emergency event', { err });
      captureEmergencyError(err, { trigger: type, projectId: projectId ?? 'unknown' });
      console.error('[Emergency] triggerEmergency Firestore write failed:', err);
    }

    // Sprint 32 audit W1 — fan-out to supervisors via FCM. Independent of the
    // Firestore write success: if the doc write failed (e.g. offline), the
    // server call will still attempt and queue the push. The two failure
    // domains are uncorrelated so we don't gate one on the other.
    //
    // Sprint 33 audit W10 — si el server fan-out falla por RED CAÍDA
    // (no por bug del server), encolamos un SOS packet en el mesh para
    // rebroadcast por BLE/WiFi Direct. Cierra ADR 0013 + Flow Infinito
    // Fase 2 (respuesta adaptativa offline). Caso real: túnel minero
    // LATAM sin señal celular — el peer con red hace el server call por
    // nosotros (transitivo). El packet `type:'sos'` también dispara el
    // XP wire de Sprint 32 B3 en cada peer relayer (medalla "salvaste
    // una vida"). Fire-and-forget — nunca bloquea la UI.
    void notifyBrigadeServer(type, projectId).then(async (result) => {
      if (result === 'ok') {
        logger.info('EmergencyContext: server fan-out OK', { type, projectId });
        return;
      }
      if (result === 'server-error') {
        // Bug del backend, no offline — peers no nos pueden ayudar.
        logger.warn('EmergencyContext: server fan-out failed (5xx), no mesh fallback', {
          type,
          projectId,
        });
        return;
      }
      // result === 'network-fail' → mesh fallback path
      const uid = auth.currentUser?.uid ?? 'anonymous';
      try {
        const meshRes = await meshEnqueueOutbound({
          projectId,
          emergencyType: type,
          uid,
          triggeredAtMs: Date.now(),
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
        // El wrapper no debería tirar (todo errores van por meshRes.reason),
        // pero si lo hace, capturamos sin romper la UI de emergencia.
        logger.error('EmergencyContext: mesh fallback threw', { err });
        captureEmergencyError(err, { trigger: type, projectId, path: 'mesh_fallback' });
      }
    });
  }, []);

  const resolveEmergency = useCallback(() => {
    setIsEmergencyActive(false);
    setEmergencyType(null);
    setEmergencyStartTime(null);

    const ref = activeEventRef.current;
    activeEventRef.current = null;
    if (!ref) {
      console.warn('[Emergency] resolveEmergency called with no active emergency doc');
      setIsEmergencyActive(false);
      return;
    }

    const user = auth.currentUser;
    updateDoc(doc(db, `projects/${ref.projectId}/emergency_events`, ref.docId), {
      status: 'resolved',
      resolvedBy: user?.uid ?? null,
      resolvedByName: user?.displayName ?? null,
      resolvedAt: serverTimestamp(),
    }).catch((err) => logger.error('EmergencyContext: failed to resolve event', { err }));
  }, []);

  // Plan 2026-05-23 perf — memoize value. triggerEmergency + resolveEmergency
  // ahora son useCallback (refs estables). Consumers: AppModeContext (mode
  // auto-switching), EmergencyOverlay (root mount), Sidebar (survival mode
  // botón), FallDetectionMonitor, ManDownDetector, varios sensores. Sin
  // esta memoización, cada render del Provider invalidaba toda la cadena
  // de monitoreo de emergencia.
  const contextValue = useMemo(
    () => ({ isEmergencyActive, emergencyType, emergencyStartTime, triggerEmergency, resolveEmergency }),
    [isEmergencyActive, emergencyType, emergencyStartTime, triggerEmergency, resolveEmergency],
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
