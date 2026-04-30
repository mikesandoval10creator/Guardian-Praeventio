import React, { createContext, useContext, useState, useRef } from 'react';
import { db, auth, serverTimestamp } from '../services/firebase';
import { collection, addDoc, doc, updateDoc } from 'firebase/firestore';
import { logger } from '../utils/logger';

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
    }
  };

  const resolveEmergency = () => {
    setIsEmergencyActive(false);
    setEmergencyType(null);

    const ref = activeEventRef.current;
    activeEventRef.current = null;
    if (!ref) return;

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
