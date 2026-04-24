import { useState, useEffect, useRef, useCallback } from 'react';
import { useAmbientNoise } from './useAmbientNoise';

interface UseAcousticSOSOptions {
  threshold?: number; // noiseLevel 0-100 to count as a knock (default 75)
  requiredKnocks?: number; // knocks needed to trigger SOS (default 3)
  windowMs?: number; // time window to complete the sequence (default 6000ms)
  onSOS?: () => void;
}

export function useAcousticSOS({
  threshold = 75,
  requiredKnocks = 3,
  windowMs = 6000,
  onSOS,
}: UseAcousticSOSOptions = {}) {
  const { noiseLevel, isListening, startListening, stopListening } = useAmbientNoise();
  const [isActive, setIsActive] = useState(false);
  const knockTimestamps = useRef<number[]>([]);
  const lastKnockTime = useRef<number>(0);
  const KNOCK_COOLDOWN_MS = 400; // avoid counting one knock twice

  useEffect(() => {
    if (!isActive) return;

    const now = Date.now();
    if (noiseLevel >= threshold && now - lastKnockTime.current > KNOCK_COOLDOWN_MS) {
      lastKnockTime.current = now;
      const recent = knockTimestamps.current.filter(t => now - t < windowMs);
      recent.push(now);
      knockTimestamps.current = recent;

      if (recent.length >= requiredKnocks) {
        knockTimestamps.current = [];
        onSOS?.();
      }
    }
  }, [noiseLevel, isActive, threshold, requiredKnocks, windowMs, onSOS]);

  const start = useCallback(async () => {
    knockTimestamps.current = [];
    lastKnockTime.current = 0;
    setIsActive(true);
    await startListening();
  }, [startListening]);

  const stop = useCallback(() => {
    setIsActive(false);
    stopListening();
  }, [stopListening]);

  return { isActive, noiseLevel, isListening, start, stop };
}
