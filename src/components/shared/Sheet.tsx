// src/components/shared/Sheet.tsx
import { useEffect, useRef, type ReactNode } from 'react';
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Holds the element focused before the panel opened so we can restore it.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Focus management: move focus to close button on open; restore on close.
  // TODO: full tab-trap deferred (repo-wide gap, matches Modal.tsx — would need focus-trap-react)
  useEffect(() => {
    if (isOpen) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement;
      // Defer one tick so framer-motion has mounted the panel into the DOM.
      const id = setTimeout(() => { closeButtonRef.current?.focus(); }, 0);
      return () => clearTimeout(id);
    } else {
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
      return undefined;
    }
  }, [isOpen]);

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
              'bg-elevated border-default-token shadow-mode-lg',
              side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
            )}
          >
            <div className="p-4 sm:p-5 border-b border-default-token flex items-center justify-between bg-surface shrink-0">
              <h2 className="text-base sm:text-lg font-semibold text-primary-token truncate pr-4">
                {title}
              </h2>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={onClose}
                aria-label="Cerrar panel"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-muted-token hover:text-primary-token hover:bg-canvas transition-colors shrink-0"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 text-primary-token">
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
