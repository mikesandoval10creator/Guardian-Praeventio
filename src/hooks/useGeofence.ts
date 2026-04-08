import { useState, useEffect } from 'react';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, polygon } from '@turf/helpers';

export interface GeofenceZone {
  id: string;
  name: string;
  type: 'HAZMAT' | 'DANGER' | 'RESTRICTED';
  coordinates: number[][][]; // GeoJSON Polygon coordinates
}

export function useGeofence(zones: GeofenceZone[]) {
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [activeZones, setActiveZones] = useState<GeofenceZone[]>([]);

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
          } catch (e) {
            console.error("Invalid polygon for zone", zone.id, e);
            return false;
          }
        });

        setActiveZones(insideZones);

        if (insideZones.length > 0) {
          // Trigger alarm
          if ('vibrate' in navigator) {
            navigator.vibrate([200, 100, 200, 100, 500]);
          }
          
          // Play sound
          const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
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
        }
      },
      (error) => {
        console.error("Error watching position:", error);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 5000
      }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [zones]);

  return { currentLocation, activeZones };
}
