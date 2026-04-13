import React, { useState, useEffect } from 'react';
import { RefreshCw, X } from 'lucide-react';

export function PWAUpdateToast() {
  const [show, setShow] = useState(false);
  const [updateFn, setUpdateFn] = useState<(() => void) | null>(null);

  useEffect(() => {
    const handleUpdateAvailable = (event: CustomEvent<{ update: () => void }>) => {
      setUpdateFn(() => event.detail.update);
      setShow(true);
    };

    window.addEventListener('pwa-update-available', handleUpdateAvailable as EventListener);
    
    return () => {
      window.removeEventListener('pwa-update-available', handleUpdateAvailable as EventListener);
    };
  }, []);

  if (!show) return null;

  return (
    <div className="fixed bottom-24 sm:bottom-8 left-1/2 -translate-x-1/2 z-[100] bg-zinc-900 border border-emerald-500/30 shadow-2xl shadow-emerald-500/20 rounded-2xl p-4 flex items-center gap-4 animate-in slide-in-from-bottom-10 fade-in w-[90%] max-w-sm">
      <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center shrink-0">
        <RefreshCw className="w-5 h-5 text-emerald-500 animate-spin-slow" />
      </div>
      <div className="flex-1">
        <h4 className="text-sm font-bold text-white">Actualización Crítica</h4>
        <p className="text-xs text-zinc-400">Nuevos protocolos de seguridad disponibles.</p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            if (updateFn) updateFn();
            setShow(false);
          }}
          className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors"
        >
          Actualizar
        </button>
        <button
          onClick={() => setShow(false)}
          className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
