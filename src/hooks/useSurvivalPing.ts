import { useEffect, useRef } from 'react';
import { useFirebase } from '../contexts/FirebaseContext';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useOnlineStatus } from './useOnlineStatus';
import { saveBreadcrumb } from '../utils/offlineStorage';

export const useSurvivalPing = () => {
  const { user } = useFirebase();
  const isOnline = useOnlineStatus();
  const lastPingRef = useRef<number>(0);

  useEffect(() => {
    if (!user || !isOnline) return;

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

              // Use setDoc with merge to keep it as a single lightweight update
              const pingRef = doc(db, `pings/${user.uid}`);
              setDoc(pingRef, {
                lat,
                lng,
                timestamp: serverTimestamp(),
                status: 'alive'
              }, { merge: true }).catch(err => {
                console.warn("Survival ping failed (silent):", err);
              });

              // Save local breadcrumb for offline rescue trail
              saveBreadcrumb(user.uid, lat, lng).catch(() => {});

              lastPingRef.current = now;
            },
            () => {
              // If location fails, still send a ping without coords
              const pingRef = doc(db, `pings/${user.uid}`);
              setDoc(pingRef, {
                timestamp: serverTimestamp(),
                status: 'alive'
              }, { merge: true }).catch(() => {});
              lastPingRef.current = now;
            },
            { maximumAge: 60000, timeout: 5000, enableHighAccuracy: false }
          );
        }
      }
    }, 10000); // Check every 10 seconds if we should ping

    return () => clearInterval(pingInterval);
  }, [user, isOnline]);
};
