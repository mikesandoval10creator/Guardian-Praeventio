import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
          <motion.div
            key="modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // WCAG 1.4.10 — responsive padding; reflows for 320px viewport.
            className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
          >
            <div
              onClick={onClose}
              aria-hidden="true"
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              // Mode-aware surface — uses elevated tokens so contrast holds
              // in driving (white) + emergency (black) modes.
              className="relative w-full max-w-2xl max-h-[90vh] bg-elevated border border-default-token rounded-2xl shadow-mode-lg flex flex-col overflow-hidden"
            >
              <div className="p-4 sm:p-6 border-b border-default-token flex items-center justify-between bg-surface shrink-0">
                <h2 id="modal-title" className="text-base sm:text-lg font-bold text-primary-token truncate pr-4">
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  aria-label="Close modal"
                  // WCAG 2.5.8 — 44x44 minimum target on mobile.
                  className="min-w-[44px] min-h-[44px] p-2 hover:bg-canvas rounded-xl transition-colors shrink-0 text-muted-token hover:text-primary-token flex items-center justify-center"
                >
                  <X className="w-5 h-5" aria-hidden="true" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-4 sm:p-6 text-primary-token">
                {children}
              </div>
            </motion.div>
          </motion.div>
      )}
    </AnimatePresence>
  );
}
