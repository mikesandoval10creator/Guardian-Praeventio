import { useEffect, useState } from 'react';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { collection, addDoc, serverTimestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';

export const useGeolocationTracking = () => {
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const [isTracking, setIsTracking] = useState(false);
  const [lastLocation, setLastLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [hasArt22, setHasArt22] = useState(false);

  useEffect(() => {
    if (!user || !selectedProject) return;

    const checkWorkerStatus = async () => {
      try {
        const workersRef = collection(db, `projects/${selectedProject.id}/workers`);
        const q = query(workersRef, where('email', '==', user.email));
        const snapshot = await getDocs(q);
        
        if (!snapshot.empty) {
          const workerData = snapshot.docs[0].data();
          setHasArt22(workerData.hasArt22 === true);
        } else {
          setHasArt22(false);
        }
      } catch (error) {
        console.error('Error checking worker status:', error);
      }
    };

    checkWorkerStatus();
  }, [user, selectedProject]);

  useEffect(() => {
    if (!user || !selectedProject) {
      setIsTracking(false);
      return;
    }

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

      const shiftStart = parseTime(selectedProject.shiftStart);
      const shiftEnd = parseTime(selectedProject.shiftEnd);

      if (shiftStart === null || shiftEnd === null) {
        // If no schedule is defined, default to not tracking unless alwaysTrack is true
        return false;
      }

      const buffer = selectedProject.trackCommute ? 1 : 0; // 1 hour buffer

      let start = shiftStart - buffer;
      let end = shiftEnd + buffer;

      // Handle overnight shifts
      if (end < start) {
        return currentTime >= start || currentTime <= end;
      }

      return currentTime >= start && currentTime <= end;
    };

    let watchId: number;

    const startTracking = () => {
      if (!navigator.geolocation) {
        console.warn('Geolocation is not supported by this browser.');
        return;
      }

      setIsTracking(true);
      watchId = navigator.geolocation.watchPosition(
        async (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          setLastLocation({ lat: latitude, lng: longitude });

          // Solo guardar si la precisión es razonable (< 50 metros)
          if (accuracy < 50) {
            try {
              await addDoc(collection(db, `projects/${selectedProject.id}/locations`), {
                userId: user.uid,
                projectId: selectedProject.id,
                latitude,
                longitude,
                accuracy,
                timestamp: serverTimestamp(),
              });
            } catch (error) {
              console.error('Error saving location:', error);
            }
          }
        },
        (error) => {
          console.error('Geolocation error:', error);
          setIsTracking(false);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0,
        }
      );
    };

    const stopTracking = () => {
      if (watchId) {
        navigator.geolocation.clearWatch(watchId);
      }
      setIsTracking(false);
    };

    // Check immediately
    if (checkTrackingSchedule()) {
      startTracking();
    } else {
      stopTracking();
    }

    // Re-check every 5 minutes
    const intervalId = setInterval(() => {
      if (checkTrackingSchedule()) {
        if (!isTracking) startTracking();
      } else {
        if (isTracking) stopTracking();
      }
    }, 5 * 60 * 1000);

    return () => {
      stopTracking();
      clearInterval(intervalId);
    };
  }, [user, selectedProject, isTracking, hasArt22]);

  return { isTracking, lastLocation };
};
