import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

export function ReloadPrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered: ' + r);
    },
    onRegisterError(error) {
      console.log('SW registration error', error);
    },
  });

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  if (!offlineReady && !needRefresh) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-4 max-w-sm w-full animate-in slide-in-from-bottom-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-white font-bold text-sm mb-1">
            {offlineReady ? 'App lista para trabajar offline' : 'Nueva actualización disponible'}
          </h3>
          <p className="text-zinc-400 text-xs">
            {offlineReady 
              ? 'La aplicación ha sido descargada y puede usarse sin conexión a internet.' 
              : 'Hay una nueva versión de Praeventio Guard. Actualiza para obtener las últimas mejoras.'}
          </p>
        </div>
        <button 
          onClick={close}
          className="text-zinc-500 hover:text-white transition-colors p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <div className="mt-4 flex gap-2">
        {needRefresh && (
          <button 
            onClick={() => updateServiceWorker(true)}
            className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-3 h-3" />
            Actualizar ahora
          </button>
        )}
        <button 
          onClick={close}
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold py-2 px-4 rounded-lg transition-colors"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}
