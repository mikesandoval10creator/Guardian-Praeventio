import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../services/firebase';

export interface WisdomCapsuleData {
  id: string;
  title: string;
  content: string;
  lat: number;
  lng: number;
  radius: number; // meters, default 50
  machineId?: string;
  nodeId?: string;
  mediaUrl?: string;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function useWisdomCapsules() {
  const [capsules, setCapsules] = useState<WisdomCapsuleData[]>([]);
  const [nearbyCapsule, setNearbyCapsule] = useState<WisdomCapsuleData | null>(null);

  // Fetch capsules from Firestore on mount (silently fails if collection absent)
  useEffect(() => {
    getDocs(collection(db, 'wisdomCapsules'))
      .then(snap => {
        setCapsules(snap.docs.map(d => ({ id: d.id, ...d.data() } as WisdomCapsuleData)));
      })
      .catch(() => {});
  }, []);

  // Watch GPS and compute proximity
  useEffect(() => {
    if (!('geolocation' in navigator) || capsules.length === 0) return;

    const watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const { latitude, longitude } = coords;
        const nearby = capsules.find(c =>
          haversineDistance(latitude, longitude, c.lat, c.lng) <= (c.radius ?? 50)
        ) ?? null;
        setNearbyCapsule(prev => {
          // Only update if capsule id changed to avoid re-renders
          if (prev?.id === nearby?.id) return prev;
          if (nearby) navigator.vibrate?.([80, 40, 80]);
          return nearby;
        });
      },
      () => {},
      { enableHighAccuracy: false, maximumAge: 30000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [capsules]);

  return { nearbyCapsule, capsules };
}
