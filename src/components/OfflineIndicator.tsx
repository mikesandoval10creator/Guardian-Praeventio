import React, { useState, useEffect } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [showBackOnline, setShowBackOnline] = useState(false);

  useEffect(() => {
    const handleOffline = () => {
      setIsOffline(true);
      setShowBackOnline(false);
    };

    const handleOnline = () => {
      setIsOffline(false);
      setShowBackOnline(true);
      
      // Hide the "back online" message after 3 seconds
      setTimeout(() => {
        setShowBackOnline(false);
      }, 3000);
    };

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  return (
    <AnimatePresence>
      {isOffline && (
        <motion.div
          key="offline-indicator"
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -50, opacity: 0 }}
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-orange-500/90 backdrop-blur-md border border-orange-500/50 text-white px-4 py-2 rounded-full shadow-lg shadow-orange-500/20 flex items-center gap-2 text-sm font-medium"
        >
          <WifiOff className="w-4 h-4" />
          <span>Modo Offline. Guardando cambios localmente.</span>
        </motion.div>
      )}
      {showBackOnline && (
        <motion.div
          key="online-indicator"
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -50, opacity: 0 }}
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-emerald-500/90 backdrop-blur-md border border-emerald-500/50 text-white px-4 py-2 rounded-full shadow-lg shadow-emerald-500/20 flex items-center gap-2 text-sm font-medium"
        >
          <Wifi className="w-4 h-4" />
          <span>Conexión restaurada. Sincronizando...</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
