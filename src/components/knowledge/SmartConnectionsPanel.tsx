import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  X,
  Link,
  BookOpen,
  Building2,
  Shield,
  GraduationCap,
  type LucideProps,
} from 'lucide-react';
import { useZettelkastenIntelligence } from '../../hooks/useZettelkastenIntelligence';
import type { SmartAction, URLContext } from '../../hooks/useZettelkastenIntelligence';

// ---------------------------------------------------------------------------
// Icon map — string names → Lucide components
// ---------------------------------------------------------------------------

type IconComponent = React.FC<LucideProps>;

const ICON_MAP: Record<string, IconComponent> = {
  Link,
  BookOpen,
  Building2,
  Shield,
  GraduationCap,
};

// ---------------------------------------------------------------------------
// Context badge labels
// ---------------------------------------------------------------------------

const CONTEXT_LABELS: Record<URLContext, string> = {
  workers: 'Trabajadores',
  epp: 'EPP',
  risks: 'Riesgos',
  training: 'Capacitación',
  ergonomics: 'Ergonomía',
  medicine: 'Medicina',
  audits: 'Auditorías',
  general: 'General',
};

// ---------------------------------------------------------------------------
// Priority helpers
// ---------------------------------------------------------------------------

const PRIORITY_DOT: Record<SmartAction['priority'], string> = {
  high: 'bg-red-400',
  medium: 'bg-yellow-400',
  low: 'bg-green-400',
};

// ---------------------------------------------------------------------------
// SmartConnectionsPanel
// ---------------------------------------------------------------------------

export function SmartConnectionsPanel() {
  const { smartActions, currentContext, smartPanelVisible, setSmartPanelVisible } =
    useZettelkastenIntelligence();

  const isVisible = smartPanelVisible && smartActions.length > 0;

  return (
    <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
      {/* ------------------------------------------------------------------ */}
      {/* Expanded card                                                        */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {isVisible && (
          <motion.div
            key="smart-panel"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="w-72 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/50 dark:border-white/10 shadow-2xl p-4 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <Sparkles
                  className="w-4 h-4 shrink-0"
                  style={{ color: '#4db6ac' }}
                />
                <span className="text-[12px] font-bold text-zinc-900 dark:text-white truncate">
                  Conexiones Inteligentes
                </span>
                {/* Context badge */}
                <span
                  className="shrink-0 text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full border"
                  style={{
                    color: '#2a8a81',
                    borderColor: '#4db6ac55',
                    backgroundColor: '#4db6ac18',
                  }}
                >
                  {CONTEXT_LABELS[currentContext]}
                </span>
              </div>
              <button
                onClick={() => setSmartPanelVisible(false)}
                className="ml-2 shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                aria-label="Cerrar panel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Action list */}
            <ul className="flex flex-col gap-1.5">
              {smartActions.map((action) => {
                const Icon: IconComponent = ICON_MAP[action.icon] ?? Shield;
                return (
                  <li key={action.id}>
                    <button
                      onClick={() => {
                        // Smart action wiring pendiente — ver Bloque L (Zettelkasten capacity expansion).
                      }}
                      className="w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left group
                        bg-zinc-50 dark:bg-zinc-800/60
                        hover:bg-[#4db6ac]/10 dark:hover:bg-[#4db6ac]/15
                        border border-transparent hover:border-[#4db6ac]/30
                        transition-all duration-150"
                    >
                      {/* Icon */}
                      <span
                        className="mt-0.5 shrink-0 w-7 h-7 rounded-lg flex items-center justify-center
                          bg-zinc-200/70 dark:bg-zinc-700/70
                          group-hover:bg-[#4db6ac]/20
                          transition-colors duration-150"
                        style={{ color: '#2a8a81' }}
                      >
                        <Icon className="w-4 h-4" />
                      </span>

                      {/* Text */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {/* Priority dot */}
                          <span
                            className={`shrink-0 w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[action.priority]}`}
                          />
                          <span className="text-[11px] font-semibold text-zinc-800 dark:text-zinc-100 leading-tight truncate">
                            {action.label}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[9px] text-zinc-500 dark:text-zinc-400 leading-snug line-clamp-2">
                          {action.description}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ------------------------------------------------------------------ */}
      {/* Collapsed pill button (always visible when there are actions)        */}
      {/* ------------------------------------------------------------------ */}
      <AnimatePresence>
        {!isVisible && smartActions.length > 0 && (
          <motion.button
            key="smart-pill"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={() => setSmartPanelVisible(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg border
              bg-white dark:bg-zinc-900
              border-zinc-200/60 dark:border-white/10
              hover:border-[#4db6ac]/50 dark:hover:border-[#4db6ac]/40
              hover:shadow-[0_0_16px_#4db6ac33]
              transition-all duration-200"
            aria-label="Mostrar acciones inteligentes"
          >
            <Sparkles
              className="w-4 h-4 shrink-0"
              style={{ color: '#4db6ac' }}
            />
            {/* Count badge */}
            <span
              className="min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-[9px] font-black text-white px-1"
              style={{ backgroundColor: '#2a8a81' }}
            >
              {smartActions.length}
            </span>
            <span className="text-[11px] font-semibold text-zinc-700 dark:text-zinc-300">
              Acciones IA
            </span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
