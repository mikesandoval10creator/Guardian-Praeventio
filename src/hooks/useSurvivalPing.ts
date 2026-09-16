import { useEffect, useRef } from 'react';
import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useOnlineStatus } from './useOnlineStatus';
import { useTenantId } from './useTenantId';
import { saveBreadcrumb } from '../utils/offlineStorage';
import { logger } from '../utils/logger';

export const useSurvivalPing = () => {
  const { user } = useFirebase();
  const { selectedProject } = useProject();
  const { tenantId } = useTenantId();
  const isOnline = useOnlineStatus();
  const lastPingRef = useRef<number>(0);

  useEffect(() => {
    // VIDA: the heartbeat runs whenever there is a user — even offline. A
    // tunnel/pit outage is EXACTLY when the local GPS breadcrumb trail matters
    // most for a rescue. We only gate the Firestore write on connectivity and
    // verified tenant/project context; the on-device breadcrumb (IndexedDB/
    // SQLite, no network) is saved on every fix.
    if (!user) return undefined;

    const projectId = selectedProject?.id ?? null;
    const cloudContext = tenantId && projectId ? { tenantId, projectId } : null;

    const writeCloudPing = (payload: Record<string, unknown>) => {
      if (!isOnline) return;
      if (!cloudContext) {
        // Firestore rules require both verified tenantId and projectId on every
        // client write. Preserve the local VIDA breadcrumb rather than issuing
        // a rules-invalid legacy write.
        logger.warn('Survival ping skipped: tenant/project context unavailable');
        return;
      }
      const pingRef = doc(db, `pings/${user.uid}`);
      setDoc(
        pingRef,
        { ...payload, ...cloudContext },
        { merge: true },
      ).catch((err) => {
        logger.warn('Survival ping failed (silent):', err);
      });
    };

    const pingInterval = setInterval(() => {
      const now = Date.now();
      // Ping every 60 seconds
      if (now - lastPingRef.current >= 60000) {
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const { latitude, longitude } = position.coords;
              // Round to 4 decimals for lightweight payload
              const lat = Math.round(latitude * 10000) / 10000;
              const lng = Math.round(longitude * 10000) / 10000;

              writeCloudPing({
                lat,
                lng,
                timestamp: serverTimestamp(),
                status: 'alive',
              });

              // Save local breadcrumb for offline rescue trail — ALWAYS, even
              // offline. This is the device-local trail rescuers replay.
              saveBreadcrumb(user.uid, lat, lng).catch(() => undefined);

              lastPingRef.current = now;
            },
            () => {
              // If location fails, still send a stamped ping when online. The
              // server/rules path accepts a heartbeat without coordinates;
              // an unstamped legacy write would be rejected and is skipped.
              writeCloudPing({
                timestamp: serverTimestamp(),
                status: 'alive',
              });
              lastPingRef.current = now;
            },
            { maximumAge: 60000, timeout: 5000, enableHighAccuracy: false },
          );
        }
      }
    }, 10000); // Check every 10 seconds if we should ping

    return () => clearInterval(pingInterval);
  }, [user, isOnline, selectedProject?.id, tenantId]);
};
