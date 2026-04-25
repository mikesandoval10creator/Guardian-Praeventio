import { useState, useEffect, useRef, useCallback } from 'react';
import { useAmbientNoise } from './useAmbientNoise';

interface SensoryFatigueOptions {
  noiseThreshold?: number; // 0-100 scale, default 65
  windowMs?: number;       // rolling window, default 15 min
  onFatigueAlert?: () => void;
}

export function useSensoryFatigue({
  noiseThreshold = 65,
  windowMs = 15 * 60 * 1000,
  onFatigueAlert,
}: SensoryFatigueOptions = {}) {
  const { noiseLevel, isListening, startListening, stopListening } = useAmbientNoise();
  const [fatigueIndex, setFatigueIndex] = useState(0); // 0-100
  const [shouldRest, setShouldRest] = useState(false);
  const exposureRef = useRef(0);
  const lastTickRef = useRef(Date.now());
  const alertSentRef = useRef(false);

  useEffect(() => {
    if (!isListening) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const dt = (now - lastTickRef.current) / 1000; // seconds
      lastTickRef.current = now;

      if (noiseLevel > noiseThreshold) {
        const excess = (noiseLevel - noiseThreshold) / (100 - noiseThreshold);
        exposureRef.current += excess * dt;
      }
      // Natural decay — exposure dissipates at 0.05/s when quiet
      exposureRef.current = Math.max(0, exposureRef.current - dt * 0.05);

      const maxExposure = (windowMs / 1000) * 0.4;
      const index = Math.min(100, Math.round((exposureRef.current / maxExposure) * 100));
      setFatigueIndex(index);

      if (index >= 75 && !alertSentRef.current) {
        setShouldRest(true);
        alertSentRef.current = true;
        onFatigueAlert?.();
        navigator.vibrate?.([100, 50, 100]);
      } else if (index < 50) {
        alertSentRef.current = false;
        setShouldRest(false);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isListening, noiseLevel, noiseThreshold, windowMs, onFatigueAlert]);

  const reset = useCallback(() => {
    exposureRef.current = 0;
    setFatigueIndex(0);
    setShouldRest(false);
    alertSentRef.current = false;
  }, []);

  return { fatigueIndex, shouldRest, noiseLevel, isListening, startListening, stopListening, reset };
}
