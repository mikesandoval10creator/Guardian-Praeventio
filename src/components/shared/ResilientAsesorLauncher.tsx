// Praeventio Guard — B14 (2026-06-11): floating launcher para el
// asistente resiliente.
//
// `<ResilientAsesorPanel />` es un panel inline (section); el shell
// (`RootLayout` vía `AsesorChatLazy` → `AsesorChatRouter`) necesita la
// misma UX flotante que el `<AsesorChat>` legacy: botón burbuja abajo a
// la derecha + ventana flotante. Este wrapper aporta exactamente eso:
//
//   1. Botón flotante (Shield) con indicador ámbar cuando estás offline
//      — el asistente SIGUE funcionando offline (escalera SLM → RAG →
//      mensaje honesto), el punto solo informa el modo.
//   2. Ventana fija que monta el panel resiliente.
//   3. Listener del evento global `open-ai-chat` (paridad con el chat
//      legacy): abre la ventana y pre-carga `detail.query` como borrador.
import { useEffect, useState } from 'react';
import { Shield, X } from 'lucide-react';
import { ResilientAsesorPanel } from './ResilientAsesorPanel';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import type { ComponentProps } from 'react';

export type ResilientAsesorLauncherProps = ComponentProps<
  typeof ResilientAsesorPanel
>;

export function ResilientAsesorLauncher(props: ResilientAsesorLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [initialDraft, setInitialDraft] = useState<string | undefined>(
    undefined,
  );
  const isOnline = useOnlineStatus();

  useEffect(() => {
    const handleOpenChat = (e: Event) => {
      const detail = (e as CustomEvent<{ query?: string }>).detail;
      if (detail?.query) setInitialDraft(detail.query);
      setIsOpen(true);
    };
    window.addEventListener('open-ai-chat', handleOpenChat);
    return () => window.removeEventListener('open-ai-chat', handleOpenChat);
  }, []);

  return (
    <>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Abrir asistente El Guardián"
          data-testid="resilient-asesor-launcher"
          className="fixed bottom-20 sm:bottom-6 right-4 sm:right-6 z-40 w-14 h-14 sm:w-16 sm:h-16 bg-gradient-to-br from-emerald-400 to-emerald-600 hover:from-emerald-500 hover:to-emerald-700 text-white rounded-full shadow-2xl shadow-emerald-500/30 flex items-center justify-center transition-all group border border-white/10"
        >
          <Shield className="w-6 h-6 sm:w-7 sm:h-7 group-hover:scale-110 transition-transform drop-shadow-md" />
          {!isOnline && (
            <span
              data-testid="resilient-asesor-offline-dot"
              title="Sin conexión — El Guardián responde con IA local"
              className="absolute top-0 right-0 w-4 h-4 bg-amber-500 border-2 border-zinc-900 rounded-full animate-pulse"
            />
          )}
        </button>
      )}

      {isOpen && (
        <div
          data-testid="resilient-asesor-window"
          className="fixed bottom-20 sm:bottom-6 right-2 sm:right-6 z-50 w-[calc(100vw-1rem)] sm:w-[420px] max-h-[80vh] overflow-y-auto bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-2xl sm:rounded-3xl shadow-2xl flex flex-col"
        >
          <div className="p-3 border-b border-zinc-200 dark:border-white/5 bg-gradient-to-r from-emerald-500/10 to-transparent flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
                  El Guardián
                </h3>
                <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                  {isOnline ? 'Conciencia activa' : 'Modo offline — IA local'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Cerrar asistente"
              className="p-2 hover:bg-zinc-200 dark:hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-zinc-900 dark:hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-2">
            <ResilientAsesorPanel {...props} initialDraft={initialDraft} />
          </div>
        </div>
      )}
    </>
  );
}
