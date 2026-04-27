import { useState, useEffect, useRef } from 'react';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, polygon } from '@turf/helpers';

export interface GeofenceZone {
  id: string;
  name: string;
  type: 'HAZMAT' | 'DANGER' | 'RESTRICTED';
  coordinates: number[][][]; // GeoJSON Polygon coordinates
}

function playZoneAlarm() {
  try {
    navigator.vibrate([200, 100, 200, 100, 500]);
  } catch {}
  try {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass) return;
    const audioCtx = new AudioCtxClass() as AudioContext;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.2);
    gainNode.gain.setValueAtTime(0.5, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.5);
  } catch {}
}

export function useGeofence(zones: GeofenceZone[]) {
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [activeZones, setActiveZones] = useState<GeofenceZone[]>([]);
  // Track which zone IDs the worker is currently inside to avoid repeated alarms
  const insideZoneIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!('geolocation' in navigator)) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCurrentLocation({ lat: latitude, lng: longitude });

        const userPoint = point([longitude, latitude]);

        const insideZones = zones.filter(zone => {
          try {
            const poly = polygon(zone.coordinates);
            return booleanPointInPolygon(userPoint, poly);
          } catch {
            return false;
          }
        });

        setActiveZones(insideZones);

        // Fire alarm only on zone ENTRY (transition from outside → inside)
        const prevIds = insideZoneIdsRef.current;
        const newIds = new Set(insideZones.map(z => z.id));
        const justEntered = insideZones.filter(z => !prevIds.has(z.id));
        insideZoneIdsRef.current = newIds;

        if (justEntered.length > 0) {
          playZoneAlarm();
        }
      },
      () => { /* geolocation errors are silent — hook stays operational */ },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [zones]);

  return { currentLocation, activeZones };
}
