import React, { useEffect, useState } from 'react';
import { WifiOff, Wifi, Loader2, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSyncState } from '../hooks/useSyncState';
import { offlineSync } from '../services/sync/syncStateMachine';

// Sprint 25 Bucket QQ — OfflineIndicator now reads from the central
// OfflineSyncStateMachine via `useSyncState()`. Previously this only
// observed `navigator.onLine`; the new banner additionally surfaces:
//   • pending op count when offline ("Pendiente: 5 cambios")
//   • syncing state ("Sincronizando…" + spinner) when online_syncing
//   • failure state ("Error de sync") with a "Reintentar" action
// The "back online" toast is still shown briefly on the offline→online
// transition for continuity with the original UX.
export function OfflineIndicator() {
  const sync = useSyncState();
  const [showBackOnline, setShowBackOnline] = useState(false);
  const [wasOffline, setWasOffline] = useState(!sync.isOnline);

  useEffect(() => {
    if (!sync.isOnline) {
      setWasOffline(true);
      setShowBackOnline(false);
      return undefined;
    }
    if (wasOffline && sync.isOnline) {
      setWasOffline(false);
      setShowBackOnline(true);
      const t = setTimeout(() => setShowBackOnline(false), 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [sync.isOnline, wasOffline]);

  const renderBadge = () => {
    if (sync.state === 'offline_queued') {
      return (
        <motion.div
          key="offline-queued"
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -50, opacity: 0 }}
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-orange-500/90 backdrop-blur-md border border-orange-500/50 text-white px-4 py-2 rounded-full shadow-lg shadow-orange-500/20 flex items-center gap-2 text-sm font-medium"
        >
          <WifiOff className="w-4 h-4" />
          <span>Pendiente: {sync.pendingCount} cambio{sync.pendingCount === 1 ? '' : 's'}</span>
        </motion.div>
      );
    }
    if (sync.state === 'offline_idle') {
      return (
        <motion.div
          key="offline-idle"
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -50, opacity: 0 }}
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-orange-500/90 backdrop-blur-md border border-orange-500/50 text-white px-4 py-2 rounded-full shadow-lg shadow-orange-500/20 flex items-center gap-2 text-sm font-medium"
        >
          <WifiOff className="w-4 h-4" />
          <span>Modo Offline. Guardando cambios localmente.</span>
        </motion.div>
      );
    }
    if (sync.state === 'online_syncing') {
      return (
        <motion.div
          key="syncing"
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -50, opacity: 0 }}
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-amber-500/90 backdrop-blur-md border border-amber-500/50 text-white px-4 py-2 rounded-full shadow-lg shadow-amber-500/20 flex items-center gap-2 text-sm font-medium"
        >
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Sincronizando{sync.pendingCount > 0 ? ` ${sync.pendingCount} cambios` : ''}…</span>
        </motion.div>
      );
    }
    if (sync.state === 'online_failed') {
      return (
        <motion.div
          key="failed"
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -50, opacity: 0 }}
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-red-500/90 backdrop-blur-md border border-red-500/50 text-white px-4 py-2 rounded-full shadow-lg shadow-red-500/20 flex items-center gap-2 text-sm font-medium"
        >
          <AlertTriangle className="w-4 h-4" />
          <span>Error de sync ({sync.pendingCount})</span>
          <button
            type="button"
            onClick={() => {
              void offlineSync.syncNow();
            }}
            className="ml-2 px-2 py-0.5 rounded-full bg-white/20 hover:bg-white/30 transition text-xs font-semibold"
          >
            Reintentar
          </button>
        </motion.div>
      );
    }
    if (showBackOnline) {
      return (
        <motion.div
          key="online-indicator"
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -50, opacity: 0 }}
          className="fixed top-4 left-1/2 transform -translate-x-1/2 z-[100] bg-emerald-500/90 backdrop-blur-md border border-emerald-500/50 text-white px-4 py-2 rounded-full shadow-lg shadow-emerald-500/20 flex items-center gap-2 text-sm font-medium"
        >
          <Wifi className="w-4 h-4" />
          <span>Sincronizado</span>
        </motion.div>
      );
    }
    return null;
  };

  return <AnimatePresence>{renderBadge()}</AnimatePresence>;
}
