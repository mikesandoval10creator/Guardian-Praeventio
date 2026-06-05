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
  // True once the noise has fallen clearly below threshold — i.e. we're "armed"
  // for the next knock. A knock is the rising edge below→above, NOT sustained
  // loudness.
  const armedRef = useRef<boolean>(true);
  const KNOCK_COOLDOWN_MS = 400; // avoid counting one knock twice
  const RELEASE_RATIO = 0.8; // hysteresis: must drop to 80% of threshold to re-arm

  useEffect(() => {
    if (!isActive) return;

    // Re-arm once the noise drops clearly below threshold. The hysteresis gap
    // (RELEASE_RATIO) keeps jitter around the threshold from re-triggering.
    if (noiseLevel < threshold * RELEASE_RATIO) {
      armedRef.current = true;
      return;
    }

    const now = Date.now();
    // Count a knock ONLY on a rising edge (armed + above threshold). Sustained
    // loud noise — machinery, a running alarm — stays above threshold and must
    // NOT rack up phantom knocks: a false SOS erodes trust in a life-safety
    // trigger and wastes responder attention.
    if (
      noiseLevel >= threshold &&
      armedRef.current &&
      now - lastKnockTime.current > KNOCK_COOLDOWN_MS
    ) {
      armedRef.current = false;
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
    armedRef.current = true;
    setIsActive(true);
    await startListening();
  }, [startListening]);

  const stop = useCallback(() => {
    setIsActive(false);
    stopListening();
  }, [stopListening]);

  return { isActive, noiseLevel, isListening, start, stop };
}
