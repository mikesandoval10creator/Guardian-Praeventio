import React, { createContext, useContext, useState, useEffect } from 'react';
import { Motion } from '@capacitor/motion';
import { Capacitor } from '@capacitor/core';

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
    if (!isListening) return;

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
          console.error("Error starting native motion sensors", e);
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

  const startListening = () => setIsListening(true);
  const stopListening = () => setIsListening(false);

  return (
    <SensorContext.Provider value={{ sensorData, isListening, startListening, stopListening }}>
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
