import { useState, useEffect, useRef, useCallback } from 'react';

export interface DrPosition {
  x: number; // SVG x-coordinate (0-800)
  y: number; // SVG y-coordinate (0-600)
}

interface UseDeadReckoningOptions {
  initialPosition?: DrPosition;
  stepLengthSvg?: number; // SVG units per detected step, default 18
  stepThreshold?: number; // m/s² above which a step is counted, default 12
}

// Estimates indoor position from DeviceMotion + DeviceOrientation without GPS.
// Works by counting gait peaks (step detection) and applying the current heading.
export function useDeadReckoning({
  initialPosition = { x: 200, y: 250 },
  stepLengthSvg = 18,
  stepThreshold = 12,
}: UseDeadReckoningOptions = {}) {
  const [position, setPosition] = useState<DrPosition>(initialPosition);
  const [heading, setHeading] = useState(0); // compass degrees, 0 = North
  const [stepCount, setStepCount] = useState(0);
  const [isActive, setIsActive] = useState(false);

  const headingRef = useRef(heading);
  const lastMagRef = useRef(0);
  const lastStepRef = useRef(0);

  useEffect(() => { headingRef.current = heading; }, [heading]);

  useEffect(() => {
    if (!isActive) return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      // compassHeading is available on some browsers; alpha as fallback
      const h = (e as any).webkitCompassHeading ?? e.alpha ?? 0;
      setHeading(h);
    };

    const handleMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const mag = Math.sqrt((a.x ?? 0) ** 2 + (a.y ?? 0) ** 2 + (a.z ?? 0) ** 2);

      const now = Date.now();
      // Rising edge over threshold with minimum 300 ms cadence between steps
      if (mag > stepThreshold && lastMagRef.current <= stepThreshold && now - lastStepRef.current > 300) {
        lastStepRef.current = now;
        setStepCount(s => s + 1);
        setPosition(prev => {
          const rad = (headingRef.current * Math.PI) / 180;
          return {
            x: Math.max(0, Math.min(800, prev.x + Math.sin(rad) * stepLengthSvg)),
            y: Math.max(0, Math.min(600, prev.y - Math.cos(rad) * stepLengthSvg)),
          };
        });
      }
      lastMagRef.current = mag;
    };

    window.addEventListener('deviceorientation', handleOrientation as EventListener);
    window.addEventListener('devicemotion', handleMotion);

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation as EventListener);
      window.removeEventListener('devicemotion', handleMotion);
    };
  }, [isActive, stepLengthSvg, stepThreshold]);

  const start = useCallback(() => {
    setPosition(initialPosition);
    setStepCount(0);
    setIsActive(true);
  }, [initialPosition]);

  const stop = useCallback(() => setIsActive(false), []);
  const reset = useCallback(() => { setPosition(initialPosition); setStepCount(0); }, [initialPosition]);

  return { position, heading, stepCount, isActive, start, stop, reset };
}
