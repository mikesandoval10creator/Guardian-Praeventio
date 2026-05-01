import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { Toast } from '../../hooks/useToast';

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES = {
  success: 'bg-emerald-900/90 border-emerald-500/30 text-emerald-100',
  error: 'bg-rose-900/90 border-rose-500/30 text-rose-100',
  warning: 'bg-amber-900/90 border-amber-500/30 text-amber-100',
  info: 'bg-zinc-800/90 border-white/10 text-zinc-100',
};

const ICON_STYLES = {
  success: 'text-emerald-400',
  error: 'text-rose-400',
  warning: 'text-amber-400',
  info: 'text-zinc-400',
};

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none"
    >
      <AnimatePresence>
        {toasts.map(toast => {
          const Icon = ICONS[toast.type];
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 12, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              role="status"
              className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl border backdrop-blur-md shadow-xl max-w-xs ${STYLES[toast.type]}`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${ICON_STYLES[toast.type]}`} aria-hidden="true" />
              <span className="text-sm font-medium flex-1">{toast.message}</span>
              <button
                onClick={() => onDismiss(toast.id)}
                aria-label="Cerrar notificación"
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
