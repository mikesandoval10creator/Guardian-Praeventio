import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

export interface CompassData {
  heading: number;
  accuracy: number;
  magneticHeading?: number;
  trueHeading?: number;
  timestamp: number;
}

export interface CompassPermissions {
  location: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'unknown';
  sensors: 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale' | 'unknown';
}

export interface LocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  altitude?: number;
}

export function useNativeCompass() {
  const [compassData, setCompassData] = useState<CompassData | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [permissions, setPermissions] = useState<CompassPermissions>({
    location: 'unknown',
    sensors: 'unknown',
  });
  const [location, setLocation] = useState<LocationData | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Listener stored in a ref to avoid module-level closure issues and allow
  // safe removeEventListener across renders without stale capture.
  const listenerRef = useRef<((e: DeviceOrientationEvent) => void) | null>(null);

  const isSupported = useCallback((): boolean => {
    if (typeof window === 'undefined') return false;
    return Capacitor.isNativePlatform() || 'DeviceOrientationEvent' in window;
  }, []);

  const startCompass = useCallback(async () => {
    if (typeof window === 'undefined') return false;

    try {
      // Try to request geolocation permission
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setLocation({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
              altitude: pos.coords.altitude ?? undefined,
            });
            setPermissions(p => ({ ...p, location: 'granted' }));
          },
          () => {
            // Location not critical; compass still works
            setPermissions(p => ({ ...p, location: 'denied' }));
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      }

      // For iOS 13+ — request DeviceOrientation permission
      if (
        typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
          .requestPermission === 'function'
      ) {
        try {
          const perm = await (
            DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }
          ).requestPermission();
          if (perm !== 'granted') {
            setError('Permiso de orientación denegado');
            return false;
          }
        } catch {
          // Browser doesn't require permission or already granted
        }
      }

      setPermissions(p => ({ ...p, sensors: 'granted' }));
      setError(null);
      setIsActive(true);

      const handler = (event: DeviceOrientationEvent) => {
        if (event.alpha !== null) {
          const evt = event as DeviceOrientationEvent & {
            webkitCompassHeading?: number;
            webkitCompassAccuracy?: number;
          };
          let heading: number;
          if (evt.webkitCompassHeading !== undefined) {
            heading = evt.webkitCompassHeading;
          } else {
            heading = (360 - event.alpha) % 360;
          }
          setCompassData({
            heading: Math.round(heading),
            accuracy: evt.webkitCompassAccuracy ?? 15,
            magneticHeading: event.alpha,
            trueHeading: evt.webkitCompassHeading,
            timestamp: Date.now(),
          });
        }
      };

      listenerRef.current = handler;
      window.addEventListener('deviceorientation', handler, true);
      return true;
    } catch {
      setError('Error iniciando la brújula');
      return false;
    }
  }, []);

  const stopCompass = useCallback(() => {
    if (listenerRef.current) {
      window.removeEventListener('deviceorientation', listenerRef.current, true);
      listenerRef.current = null;
    }
    setIsActive(false);
    setCompassData(null);
  }, []);

  const calibrateCompass = useCallback(() => {
    // User-facing calibration guidance — component shows this as a toast/message
    console.info('[Compass] Calibrate: move device in figure-8 pattern');
  }, []);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    return startCompass();
  }, [startCompass]);

  const getDirectionName = useCallback((heading: number): string => {
    const dirs = [
      'Norte', 'Noreste', 'Este', 'Sureste', 'Sur', 'Suroeste', 'Oeste', 'Noroeste',
    ];
    return dirs[Math.round(heading / 45) % 8];
  }, []);

  const getDirectionAbbr = useCallback((heading: number): string => {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(heading / 45) % 8];
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (listenerRef.current) {
        window.removeEventListener('deviceorientation', listenerRef.current, true);
      }
    };
  }, []);

  return {
    compassData,
    isActive,
    permissions,
    location,
    error,
    startCompass,
    stopCompass,
    calibrateCompass,
    requestPermissions,
    getDirectionName,
    getDirectionAbbr,
    isSupported: isSupported(),
    isReady: permissions.sensors === 'granted',
    hasLocationPermission: permissions.location === 'granted',
  };
}
