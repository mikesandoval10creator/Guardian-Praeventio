import { useState, useEffect, useRef } from 'react';
import { useZettelkasten } from './useZettelkasten';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { NodeType } from '../types';
import { db, collection, addDoc, serverTimestamp } from '../services/firebase';

const INACTIVITY_THRESHOLD = 30000; // 30 seconds for demo, should be higher in production
const MOVEMENT_THRESHOLD = 0.5; // Sensitivity for accelerometer

export function useManDownDetection() {
  const [isActive, setIsActive] = useState(false);
  const [isAlerting, setIsAlerting] = useState(false);
  const [countdown, setCountdown] = useState(10);
  const lastMovementTime = useRef(Date.now());
  const { addNode } = useZettelkasten();
  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const startDetection = () => {
    if (!('DeviceMotionEvent' in window)) {
      console.warn('Device motion not supported');
      return;
    }
    setIsActive(true);
    lastMovementTime.current = Date.now();
  };

  const stopDetection = () => {
    setIsActive(false);
    setIsAlerting(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  };

  const triggerAlert = async () => {
    if (!selectedProject || !user) return;
    
    try {
      const location = await new Promise<string>((resolve) => {
        if (!navigator.geolocation) {
          resolve('Ubicación GPS no soportada por el navegador');
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => {
            resolve(`${position.coords.latitude}, ${position.coords.longitude}`);
          },
          (error) => {
            console.warn('Error fetching geolocation:', error);
            resolve('Error al obtener ubicación GPS');
          },
          { timeout: 5000 }
        );
      });

      // 1. Add Zettelkasten Node
      await addNode({
        type: NodeType.EMERGENCY,
        title: `ALERTA: Hombre Caído - ${user.displayName || 'Trabajador'}`,
        description: `Se ha detectado una posible caída o inmovilidad prolongada del trabajador en el proyecto ${selectedProject.name}.`,
        tags: ['Emergencia', 'Hombre Caído', 'Crítico'],
        projectId: selectedProject.id,
        connections: [],
        metadata: {
          type: 'Man Down',
          userId: user.uid,
          userName: user.displayName,
          timestamp: new Date().toISOString(),
          status: 'Activa',
          location: location
        }
      });

      // 2. Send Emergency Message to Crisis Chat
      const messagesRef = collection(db, `projects/${selectedProject.id}/emergency_messages`);
      await addDoc(messagesRef, {
        projectId: selectedProject.id,
        senderId: user.uid,
        senderName: 'SISTEMA AUTOMÁTICO',
        senderRole: 'ALERTA MAN DOWN',
        text: `🚨 ALERTA CRÍTICA: Se ha detectado una posible caída o inmovilidad prolongada del trabajador ${user.displayName || 'Desconocido'}. Ubicación: ${location}`,
        type: 'emergency',
        timestamp: serverTimestamp()
      });

      setIsAlerting(false);
      setCountdown(10);
    } catch (error) {
      console.error('Error triggering man down alert:', error);
    }
  };

  useEffect(() => {
    if (!isActive) return;

    const handleMotion = (event: DeviceMotionEvent) => {
      const acc = event.accelerationIncludingGravity;
      if (!acc) return;

      const totalAcc = Math.sqrt(
        (acc.x || 0) ** 2 + 
        (acc.y || 0) ** 2 + 
        (acc.z || 0) ** 2
      );

      // If movement is detected, reset the timer
      if (Math.abs(totalAcc - 9.8) > MOVEMENT_THRESHOLD) {
        lastMovementTime.current = Date.now();
        if (isAlerting) {
          setIsAlerting(false);
          setCountdown(10);
          if (countdownRef.current) clearInterval(countdownRef.current);
        }
      }
    };

    window.addEventListener('devicemotion', handleMotion);

    timerRef.current = setInterval(() => {
      const now = Date.now();
      if (now - lastMovementTime.current > INACTIVITY_THRESHOLD && !isAlerting) {
        setIsAlerting(true);
        // Start countdown
        countdownRef.current = setInterval(() => {
          setCountdown(prev => {
            if (prev <= 1) {
              triggerAlert();
              if (countdownRef.current) clearInterval(countdownRef.current);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    }, 1000);

    return () => {
      window.removeEventListener('devicemotion', handleMotion);
      if (timerRef.current) clearInterval(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [isActive, isAlerting, selectedProject, user]);

  return {
    isActive,
    isAlerting,
    countdown,
    startDetection,
    stopDetection
  };
}
