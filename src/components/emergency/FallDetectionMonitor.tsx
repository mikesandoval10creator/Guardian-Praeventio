import React, { useEffect, useState } from 'react';
import { useAccelerometer } from '../../hooks/useAccelerometer';
import { useNotifications } from '../../contexts/NotificationContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, CheckCircle2 } from 'lucide-react';

export function FallDetectionMonitor() {
  const { user } = useFirebase();
  const { addNotification } = useNotifications();
  const [showModal, setShowModal] = useState(false);
  const [countdown, setCountdown] = useState(15);

  const handleFallDetected = () => {
    if (!showModal) {
      setShowModal(true);
      setCountdown(15);
      
      // Vibrate to alert the user
      if (navigator.vibrate) {
        navigator.vibrate([500, 200, 500, 200, 1000]);
      }
    }
  };

  const { start, stop, isSupported, permissionGranted, requestPermission } = useAccelerometer({
    threshold: 25, // Adjust threshold as needed
    onFallDetected: handleFallDetected
  });

  useEffect(() => {
    if (user) {
      start();
    } else {
      stop();
    }
    return () => stop();
  }, [user, start, stop]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showModal && countdown > 0) {
      timer = setTimeout(() => setCountdown(c => c - 1), 1000);
    } else if (showModal && countdown === 0) {
      // Auto-trigger emergency if countdown reaches 0
      addNotification({
        title: 'Posible Caída Detectada',
        message: 'Se ha alertado a los supervisores por falta de respuesta.',
        type: 'error'
      });
      setShowModal(false);
      // Here we could also trigger a real emergency protocol via EmergencyContext
    }
    return () => clearTimeout(timer);
  }, [showModal, countdown, addNotification]);

  const handleImOk = () => {
    setShowModal(false);
    addNotification({
      title: 'Falsa Alarma',
      message: 'Has confirmado que estás bien.',
      type: 'success'
    });
  };

  const handleNeedHelp = () => {
    setShowModal(false);
    addNotification({
      title: 'Emergencia Declarada',
      message: 'Se ha notificado a los equipos de rescate.',
      type: 'error'
    });
    // Trigger real emergency protocol here
  };

  if (!user) return null;

  return (
    <AnimatePresence>
      {showModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="bg-zinc-900 border border-rose-500/30 rounded-3xl p-6 max-w-sm w-full shadow-2xl shadow-rose-500/20"
          >
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="w-20 h-20 bg-rose-500/20 rounded-full flex items-center justify-center animate-pulse">
                <AlertTriangle className="w-10 h-10 text-rose-500" />
              </div>
              
              <div>
                <h2 className="text-2xl font-black text-white uppercase tracking-tight">¿Estás bien?</h2>
                <p className="text-zinc-400 mt-2 text-sm">
                  Hemos detectado un movimiento brusco que podría ser una caída.
                </p>
              </div>

              <div className="text-4xl font-black text-rose-500 my-4">
                00:{countdown.toString().padStart(2, '0')}
              </div>

              <div className="w-full space-y-3">
                <button
                  onClick={handleImOk}
                  className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  Estoy Bien
                </button>
                <button
                  onClick={handleNeedHelp}
                  className="w-full py-4 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
                >
                  <AlertTriangle className="w-5 h-5" />
                  Necesito Ayuda
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
