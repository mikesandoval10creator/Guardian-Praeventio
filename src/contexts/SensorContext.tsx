import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Motion } from '@capacitor/motion';
import { Capacitor } from '@capacitor/core';
import { logger } from '../utils/logger';

interface SensorData {
  acceleration: { x: number | null; y: number | null; z: number | null };
  rotationRate: { alpha: number | null; beta: number | null; gamma: number | null };
  orientation: { alpha: number | null; beta: number | null; gamma: number | null };
}

interface SensorContextType {
  sensorData: SensorData;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
}

const SensorContext = createContext<SensorContextType | undefined>(undefined);

export function SensorProvider({ children }: { children: React.ReactNode }) {
  const [isListening, setIsListening] = useState(false);
  const [sensorData, setSensorData] = useState<SensorData>({
    acceleration: { x: null, y: null, z: null },
    rotationRate: { alpha: null, beta: null, gamma: null },
    orientation: { alpha: null, beta: null, gamma: null }
  });

  useEffect(() => {
    if (!isListening) return undefined;

    let accelListener: any;
    let orientListener: any;

    const startSensors = async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          accelListener = await Motion.addListener('accel', (event) => {
            setSensorData(prev => ({
              ...prev,
              acceleration: {
                x: event.acceleration.x,
                y: event.acceleration.y,
                z: event.acceleration.z
              },
              rotationRate: {
                alpha: event.rotationRate.alpha,
                beta: event.rotationRate.beta,
                gamma: event.rotationRate.gamma
              }
            }));
          });

          orientListener = await Motion.addListener('orientation', (event) => {
            setSensorData(prev => ({
              ...prev,
              orientation: {
                alpha: event.alpha,
                beta: event.beta,
                gamma: event.gamma
              }
            }));
          });
        } catch (e) {
          logger.error("Error starting native motion sensors", e);
        }
      } else {
        const handleMotion = (event: DeviceMotionEvent) => {
          setSensorData(prev => ({
            ...prev,
            acceleration: {
              x: event.acceleration?.x ?? null,
              y: event.acceleration?.y ?? null,
              z: event.acceleration?.z ?? null
            },
            rotationRate: {
              alpha: event.rotationRate?.alpha ?? null,
              beta: event.rotationRate?.beta ?? null,
              gamma: event.rotationRate?.gamma ?? null
            }
          }));
        };

        const handleOrientation = (event: DeviceOrientationEvent) => {
          setSensorData(prev => ({
            ...prev,
            orientation: {
              alpha: event.alpha,
              beta: event.beta,
              gamma: event.gamma
            }
          }));
        };

        window.addEventListener('devicemotion', handleMotion);
        window.addEventListener('deviceorientation', handleOrientation);

        accelListener = { remove: () => window.removeEventListener('devicemotion', handleMotion) };
        orientListener = { remove: () => window.removeEventListener('deviceorientation', handleOrientation) };
      }
    };

    startSensors();

    return () => {
      if (accelListener) accelListener.remove();
      if (orientListener) orientListener.remove();
    };
  }, [isListening]);

  // Plan 2026-05-23 perf — useCallback para refs estables. Wraps de
  // setIsListening (useState setter, ya estable) — el useCallback es
  // para que el value memoizado abajo no se invalide en cada render.
  const startListening = useCallback(() => setIsListening(true), []);
  const stopListening = useCallback(() => setIsListening(false), []);

  // Memoize el value. Consumers: useAccelerometer, useFallDetection,
  // useManDownDetection, useFrequencyAnalysis, fatigueMonitor — todos
  // hooks que leen sensorData continuously a 50-100Hz. Sin memo, cada
  // render del SensorProvider re-rendereaba toda la cadena de sensores.
  const contextValue = useMemo(
    () => ({ sensorData, isListening, startListening, stopListening }),
    [sensorData, isListening, startListening, stopListening],
  );

  return (
    <SensorContext.Provider value={contextValue}>
      {children}
    </SensorContext.Provider>
  );
}

export function useSensors() {
  const context = useContext(SensorContext);
  if (context === undefined) {
    throw new Error('useSensors must be used within a SensorProvider');
  }
  return context;
}
