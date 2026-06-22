// src/components/shared/Sheet.tsx
import { useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  side?: 'left' | 'right';
  children: ReactNode;
}

/**
 * Side panel built on framer-motion (the repo has @radix-ui/react-tooltip
 * only — no react-dialog). Mirrors the prototype's Sheet pattern and the
 * existing Modal.tsx overlay. Token-driven so it holds contrast in the 4
 * modes. Used for critical actions WITHOUT a route change (keeps context).
 */
export default function Sheet({ isOpen, onClose, title, side = 'right', children }: SheetProps) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="sheet-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80]"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <div
            onClick={onClose}
            aria-hidden="true"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: side === 'right' ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'right' ? '100%' : '-100%' }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className={cn(
              'absolute top-0 bottom-0 w-[88%] max-w-md flex flex-col',
              'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 shadow-xl',
              side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
            )}
          >
            <div className="p-4 sm:p-5 border-b border-zinc-200 dark:border-zinc-700 flex items-center justify-between bg-white dark:bg-zinc-900 shrink-0">
              <h2 className="text-base sm:text-lg font-semibold text-zinc-900 dark:text-white truncate pr-4">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar panel"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 text-zinc-900 dark:text-white">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
