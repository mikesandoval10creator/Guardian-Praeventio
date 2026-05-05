import React, { createContext, useContext, useState, useRef } from 'react';
import { db, auth, serverTimestamp } from '../services/firebase';
import { collection, addDoc, doc, updateDoc } from 'firebase/firestore';
import { logger } from '../utils/logger';
import { captureEmergencyError } from '../lib/sentry';

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
async function notifyBrigadeServer(
  type: string,
  projectId: string,
): Promise<void> {
  try {
    const user = auth.currentUser;
    if (!user) return;
    const idToken = await user.getIdToken();
    await fetch('/api/emergency/notify-brigada', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        projectId,
        emergencyType: toBrigadaType(type),
        message: `Activación automática: ${type}`,
      }),
    });
  } catch (err) {
    logger.warn('EmergencyContext: notify-brigada server call failed', { err });
    // Fail-soft: the Firestore doc is the authoritative artifact.
  }
}

interface EmergencyContextType {
  isEmergencyActive: boolean;
  emergencyType: string | null;
  triggerEmergency: (type: string, projectId?: string) => Promise<void>;
  resolveEmergency: () => void;
}

const EmergencyContext = createContext<EmergencyContextType | undefined>(undefined);

export function EmergencyProvider({ children }: { children: React.ReactNode }) {
  const [isEmergencyActive, setIsEmergencyActive] = useState(false);
  const [emergencyType, setEmergencyType] = useState<string | null>(null);
  // Tracks the Firestore doc created by triggerEmergency so resolveEmergency can update it
  const activeEventRef = useRef<{ projectId: string; docId: string } | null>(null);

  const triggerEmergency = async (type: string, projectId?: string) => {
    setEmergencyType(type);
    setIsEmergencyActive(true);

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
    void notifyBrigadeServer(type, projectId);
  };

  const resolveEmergency = () => {
    setIsEmergencyActive(false);
    setEmergencyType(null);

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
  };

  return (
    <EmergencyContext.Provider value={{ isEmergencyActive, emergencyType, triggerEmergency, resolveEmergency }}>
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
