import { useEffect, useRef, useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';
import { Geolocation } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';
import { logger } from '../utils/logger';
// §16.2.1 sensorBus wiring: every accepted fix is mirrored to the central bus
// so correlation rules (man-down → "send the rescue pair to the last GPS")
// have a fresh last-known location. Reuses the existing watch callback only.
import { publishSensorEvent } from '../services/sensorBus/publishSensorEvent';

interface TrackedPosition {
  coords: {
    latitude: number;
    longitude: number;
    accuracy: number;
  };
}

export const useGeolocationTracking = () => {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const [isTracking, setIsTracking] = useState(false);
  const [lastLocation, setLastLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [hasArt22, setHasArt22] = useState(false);
  // Lifecycle facts live in refs: changing them must not restart the effect.
  const watchIdRef = useRef<string | number | null>(null);
  const watchStartRef = useRef<Promise<string | number | null> | null>(null);
  const watchStartEpochRef = useRef<number | null>(null);
  const lifecycleEpochRef = useRef(0);
  const userUid = user?.uid ?? null;
  const userEmail = user?.email ?? null;
  const projectId = selectedProject?.id ?? null;
  const shiftStartValue = selectedProject?.shiftStart;
  const shiftEndValue = selectedProject?.shiftEnd;
  const trackCommute = selectedProject?.trackCommute === true;

  useEffect(() => {
    if (!userUid || !projectId) return;

    const checkWorkerStatus = async () => {
      try {
        const workersRef = collection(db, `projects/${projectId}/workers`);
        const q = query(workersRef, where('email', '==', userEmail));
        const snapshot = await getDocs(q);

        if (!snapshot.empty) {
          const workerData = snapshot.docs[0].data();
          setHasArt22(workerData.hasArt22 === true);
        } else {
          setHasArt22(false);
        }
      } catch (error) {
        logger.error('Error checking worker status:', error);
      }
    };

    checkWorkerStatus();
  }, [userUid, userEmail, projectId]);

  useEffect(() => {
    if (!userUid || !projectId) {
      lifecycleEpochRef.current += 1;
      setIsTracking(false);
      return undefined;
    }

    let disposed = false;

    const checkTrackingSchedule = () => {
      if (hasArt22) return true;

      const now = new Date();
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const currentTime = currentHours + currentMinutes / 60;

      const parseTime = (timeStr?: string) => {
        if (!timeStr) return null;
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours + minutes / 60;
      };

      const shiftStart = parseTime(shiftStartValue);
      const shiftEnd = parseTime(shiftEndValue);

      if (shiftStart === null || shiftEnd === null) {
        // If no schedule is defined, default to not tracking unless alwaysTrack is true
        return false;
      }

      const buffer = trackCommute ? 1 : 0; // 1 hour buffer

      const start = shiftStart - buffer;
      const end = shiftEnd + buffer;

      // Handle overnight shifts
      if (end < start) {
        return currentTime >= start || currentTime <= end;
      }

      return currentTime >= start && currentTime <= end;
    };

    const handlePosition = async (position: TrackedPosition | null) => {
      if (!position || !position.coords) return;
      const { latitude, longitude, accuracy } = position.coords;

      // Redondear a 4 decimales (aprox 11 metros de precisión) para optimizar cálculos
      const roundedLat = Math.round(latitude * 10000) / 10000;
      const roundedLng = Math.round(longitude * 10000) / 10000;

      setLastLocation({ lat: roundedLat, lng: roundedLng });

      // §16.2.1: publish GPS-alive evidence to the sensor bus regardless of
      // accuracy — even a coarse fix is a usable last-known location for a
      // rescue, while the Firestore record below stays gated at <50 m.
      publishSensorEvent({
        kind: 'gps',
        severity: 'info',
        workerUid: userUid,
        projectId,
        value: accuracy,
        unit: 'm',
        meta: { lat: roundedLat, lng: roundedLng },
      });

      // Solo guardar si la precisión es razonable (< 50 metros)
      if (accuracy < 50) {
        try {
          await addDoc(collection(db, `projects/${projectId}/locations`), {
            userId: userUid,
            projectId,
            latitude: roundedLat,
            longitude: roundedLng,
            accuracy,
            timestamp: serverTimestamp(),
          });
        } catch (error) {
          logger.error('Error saving location:', error);
        }
      }
    };

    const clearWatcher = async (watchId: string | number) => {
      if (Capacitor.isNativePlatform() && typeof watchId === 'string') {
        await Geolocation.clearWatch({ id: watchId });
      } else if (typeof watchId === 'number') {
        navigator.geolocation.clearWatch(watchId);
      }
    };

    const acquireWatcher = async (): Promise<string | number | null> => {
      if (Capacitor.isNativePlatform()) {
        try {
          const permissions = await Geolocation.checkPermissions();
          if (permissions.location !== 'granted') {
            const request = await Geolocation.requestPermissions();
            if (request.location !== 'granted') {
              logger.warn('Geolocation permissions denied.');
              return null;
            }
          }

          return await Geolocation.watchPosition(
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
            (position, err) => {
              if (err) {
                logger.error('Native Geolocation error:', err);
                return;
              }
              handlePosition(position);
            }
          );
        } catch (error) {
          logger.error("Error starting native geolocation:", error);
          return null;
        }
      }

      if (!navigator.geolocation) {
        logger.warn('Geolocation is not supported by this browser.');
        return null;
      }

      try {
        return navigator.geolocation.watchPosition(
          handlePosition,
          (error) => {
            logger.error('Web Geolocation error:', error);
            setIsTracking(false);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      } catch (error) {
        logger.error('Error starting web geolocation:', error);
        return null;
      }
    };

    const startTracking = async (): Promise<void> => {
      if (watchIdRef.current !== null) {
        setIsTracking(true);
        return;
      }

      if (watchStartRef.current) {
        const pendingEpoch = watchStartEpochRef.current;
        await watchStartRef.current;
        if (
          !disposed &&
          watchIdRef.current === null &&
          pendingEpoch !== lifecycleEpochRef.current
        ) {
          await startTracking();
        }
        return;
      }

      const startEpoch = lifecycleEpochRef.current;
      const startPromise = acquireWatcher();
      watchStartRef.current = startPromise;
      watchStartEpochRef.current = startEpoch;

      let acquiredId: string | number | null = null;
      try {
        acquiredId = await startPromise;
      } finally {
        if (watchStartRef.current === startPromise) {
          watchStartRef.current = null;
          watchStartEpochRef.current = null;
        }
      }

      if (acquiredId === null) {
        if (!disposed) setIsTracking(false);
        return;
      }

      if (disposed || startEpoch !== lifecycleEpochRef.current) {
        await clearWatcher(acquiredId);
        return;
      }

      if (watchIdRef.current === null) {
        watchIdRef.current = acquiredId;
        setIsTracking(true);
      } else {
        await clearWatcher(acquiredId);
      }
    };

    const stopTracking = async () => {
      lifecycleEpochRef.current += 1;
      const activeWatchId = watchIdRef.current;
      watchIdRef.current = null;
      setIsTracking(false);
      if (activeWatchId !== null) {
        await clearWatcher(activeWatchId);
      }
    };

    // Check immediately
    if (checkTrackingSchedule()) {
      void startTracking();
    } else {
      void stopTracking();
    }

    // Re-check every 5 minutes
    const intervalId = setInterval(() => {
      if (checkTrackingSchedule()) {
        void startTracking();
      } else {
        void stopTracking();
      }
    }, 5 * 60 * 1000);

    return () => {
      disposed = true;
      clearInterval(intervalId);
      void stopTracking();
    };
  }, [userUid, projectId, shiftStartValue, shiftEndValue, trackCommute, hasArt22]);

  return { isTracking, lastLocation };
};
