import { useState, useEffect, useCallback, useRef } from 'react';
import { Motion } from '@capacitor/motion';
import { Capacitor } from '@capacitor/core';
import { logger } from '../utils/logger';

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
  const [listenerId, setListenerId] = useState<any>(null);

  // Keep the latest threshold + callback in refs so `handleMotion` can stay
  // referentially STABLE. Before this fix, handleMotion was recreated whenever
  // the parent passed a new onFallDetected closure, so `start` added one
  // listener but the cleanup/`stop` called removeEventListener with a DIFFERENT
  // function reference — the old `devicemotion` listener leaked (and on native,
  // removeAllListeners() nuked every motion listener app-wide). Fall detection
  // is life-safety, so a silently-detached listener is dangerous.
  const onFallRef = useRef(onFallDetected);
  const thresholdRef = useRef(threshold);
  useEffect(() => { onFallRef.current = onFallDetected; }, [onFallDetected]);
  useEffect(() => { thresholdRef.current = threshold; }, [threshold]);

  const handleMotion = useCallback((event: any) => {
    // Handle both Web API and Capacitor plugin event formats
    const accel = event.accelerationIncludingGravity || event.acceleration;
    if (!accel) return;

    const { x, y, z } = accel;

    if (x !== null && y !== null && z !== null && x !== undefined) {
      // Calculate total acceleration vector magnitude
      const acceleration = Math.sqrt(x * x + y * y + z * z);

      setData({ x, y, z, acceleration });

      // Fall detection logic: sudden spike in acceleration (impact).
      if (acceleration > thresholdRef.current) {
        onFallRef.current?.();
      }
    }
  }, []); // stable: latest threshold/callback read via refs

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
        logger.error('Error requesting DeviceMotion permission:', error);
        return false;
      }
    } else {
      // Non-iOS 13+ devices or native platforms
      setPermissionGranted(true);
      return true;
    }
  };

  const start = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const listener = await Motion.addListener('accel', handleMotion);
        setListenerId(listener);
        setIsActive(true);
        setPermissionGranted(true);
      } catch (error) {
        logger.error("Error starting native motion listener:", error);
        setIsSupported(false);
      }
    } else {
      if (!window.DeviceMotionEvent) {
        setIsSupported(false);
        return;
      }

      const granted = await requestPermission();
      if (granted) {
        window.addEventListener('devicemotion', handleMotion);
        setIsActive(true);
      }
    }
  }, [handleMotion]);

  const stop = useCallback(() => {
    if (Capacitor.isNativePlatform()) {
      if (listenerId) {
        Motion.removeAllListeners();
        setListenerId(null);
      }
    } else {
      window.removeEventListener('devicemotion', handleMotion);
    }
    setIsActive(false);
  }, [handleMotion, listenerId]);

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
