import { useState, useEffect, useCallback } from 'react';

interface AccelerometerData {
  x: number;
  y: number;
  z: number;
  acceleration: number;
}

interface FallDetectionOptions {
  threshold?: number; // Acceleration threshold (m/s^2) to trigger a fall (default ~20)
  timeWindow?: number; // Time window in ms to check for impact
  onFallDetected?: () => void;
}

export function useAccelerometer(options: FallDetectionOptions = {}) {
  const { threshold = 25, onFallDetected } = options;
  const [data, setData] = useState<AccelerometerData | null>(null);
  const [isSupported, setIsSupported] = useState<boolean>(true);
  const [isActive, setIsActive] = useState<boolean>(false);
  const [permissionGranted, setPermissionGranted] = useState<boolean>(false);

  const handleMotion = useCallback((event: DeviceMotionEvent) => {
    if (!event.accelerationIncludingGravity) return;
    
    const { x, y, z } = event.accelerationIncludingGravity;
    
    if (x !== null && y !== null && z !== null) {
      // Calculate total acceleration vector magnitude
      const acceleration = Math.sqrt(x * x + y * y + z * z);
      
      setData({ x, y, z, acceleration });

      // Fall detection logic: sudden spike in acceleration (impact)
      if (acceleration > threshold) {
        if (onFallDetected) {
          onFallDetected();
        }
      }
    }
  }, [threshold, onFallDetected]);

  const requestPermission = async () => {
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      try {
        const permissionState = await (DeviceMotionEvent as any).requestPermission();
        if (permissionState === 'granted') {
          setPermissionGranted(true);
          return true;
        } else {
          setPermissionGranted(false);
          return false;
        }
      } catch (error) {
        console.error('Error requesting DeviceMotion permission:', error);
        return false;
      }
    } else {
      // Non-iOS 13+ devices
      setPermissionGranted(true);
      return true;
    }
  };

  const start = useCallback(async () => {
    if (!window.DeviceMotionEvent) {
      setIsSupported(false);
      return;
    }

    const granted = await requestPermission();
    if (granted) {
      window.addEventListener('devicemotion', handleMotion);
      setIsActive(true);
    }
  }, [handleMotion]);

  const stop = useCallback(() => {
    window.removeEventListener('devicemotion', handleMotion);
    setIsActive(false);
  }, [handleMotion]);

  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    data,
    isSupported,
    isActive,
    permissionGranted,
    start,
    stop,
    requestPermission
  };
}
