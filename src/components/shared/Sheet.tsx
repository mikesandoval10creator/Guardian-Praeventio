// src/components/shared/Sheet.tsx
import { useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
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
 * Accessible side panel built on Headless UI Dialog. Token-driven so it holds
 * contrast in the 4 modes. Used for critical actions WITHOUT a route change
 * (keeps context); Dialog owns focus containment, Escape and restoration.
 */
export default function Sheet({ isOpen, onClose, title, side = 'right', children }: SheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {isOpen && (
        <Dialog
          key="sheet-root"
          open
          onClose={onClose}
          initialFocus={closeButtonRef}
          className="relative z-[80]"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.3 }}
            className="fixed inset-0"
          >
            <DialogBackdrop className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <DialogPanel
              className={cn(
                'absolute top-0 bottom-0 w-[88%] max-w-md outline-none',
                side === 'right' ? 'right-0' : 'left-0',
              )}
            >
              <motion.div
                initial={{ x: side === 'right' ? '100%' : '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: side === 'right' ? '100%' : '-100%' }}
                transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.4, 0, 0.2, 1] }}
                className={cn(
                  'h-full flex flex-col bg-elevated border-default-token shadow-mode-lg',
                  side === 'right' ? 'border-l' : 'border-r',
                )}
              >
                <div className="p-4 sm:p-5 border-b border-default-token flex items-center justify-between bg-surface shrink-0">
                  <DialogTitle as="h2" className="text-base sm:text-lg font-semibold text-primary-token truncate pr-4">
                    {title}
                  </DialogTitle>
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
            </DialogPanel>
          </motion.div>
        </Dialog>
      )}
    </AnimatePresence>
  );
}
