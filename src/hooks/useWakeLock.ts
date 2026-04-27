import { useState, useEffect, useCallback } from 'react';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { Capacitor } from '@capacitor/core';

export function useWakeLock() {
  const [isSupported, setIsSupported] = useState(false);
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [isNativeLocked, setIsNativeLocked] = useState(false);
  const [wakeLockFailed, setWakeLockFailed] = useState(false);

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      setIsSupported(true);
    } else if ('wakeLock' in navigator) {
      setIsSupported(true);
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    setWakeLockFailed(false);
    if (isSupported) {
      if (Capacitor.isNativePlatform()) {
        try {
          await KeepAwake.keepAwake();
          setIsNativeLocked(true);
        } catch {
          setWakeLockFailed(true);
        }
      } else if (!wakeLock) {
        try {
          const lock = await navigator.wakeLock.request('screen');
          setWakeLock(lock);
          lock.addEventListener('release', () => {
            setWakeLock(null);
          });
        } catch {
          setWakeLockFailed(true);
        }
      }
    } else {
      setWakeLockFailed(true);
    }
  }, [isSupported, wakeLock]);

  const releaseWakeLock = useCallback(async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        await KeepAwake.allowSleep();
        setIsNativeLocked(false);
      } catch {
        // ignore release errors
      }
    } else if (wakeLock) {
      await wakeLock.release();
      setWakeLock(null);
    }
    setWakeLockFailed(false);
  }, [wakeLock]);

  return {
    isSupported,
    isLocked: Capacitor.isNativePlatform() ? isNativeLocked : !!wakeLock,
    wakeLockFailed,
    requestWakeLock,
    releaseWakeLock,
  };
}
