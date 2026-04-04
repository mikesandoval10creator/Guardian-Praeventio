import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, QrCode, Download, Share2, Printer } from 'lucide-react';
import QRCode from 'react-qr-code';
import { Worker } from '../../types';

interface QRCodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  worker: Worker | null;
}

export function QRCodeModal({ isOpen, onClose, worker }: QRCodeModalProps) {
  if (!worker) return null;

  // The QR code will point to a public profile or identification URL
  const qrValue = `${window.location.origin}/public/node/${worker.nodeId || worker.id}`;

  return (
    <AnimatePresence>
      {isOpen && worker && (
        <motion.div
          key="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        >
          <div
            onClick={onClose}
            className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-zinc-200 dark:border-white/5 flex items-center justify-between bg-gradient-to-r from-emerald-500/5 dark:from-emerald-500/10 to-transparent shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-500 shrink-0">
                  <QrCode className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 dark:text-white uppercase tracking-tight truncate">Identificación QR</h2>
                  <p className="text-[10px] text-zinc-500 dark:text-zinc-400 font-bold uppercase tracking-widest truncate">{worker.name}</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-zinc-100 dark:hover:bg-white/10 rounded-xl transition-colors text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 flex flex-col items-center overflow-y-auto custom-scrollbar flex-1">
              <div className="bg-white p-4 rounded-2xl shadow-xl mb-6">
                <QRCode 
                  value={qrValue}
                  size={200}
                  level="H"
                  style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                />
              </div>

              <div className="text-center mb-8">
                <p className="text-zinc-500 dark:text-zinc-400 text-sm mb-1">ID: {worker.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-emerald-600 dark:text-emerald-500 text-xs font-bold uppercase tracking-widest">Verificación Activa</p>
              </div>

              <div className="grid grid-cols-3 gap-4 w-full">
                <button className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors group">
                  <Download className="w-5 h-5 text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-white" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase">Bajar</span>
                </button>
                <button className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors group">
                  <Printer className="w-5 h-5 text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-white" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase">Imprimir</span>
                </button>
                <button className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors group">
                  <Share2 className="w-5 h-5 text-zinc-500 dark:text-zinc-400 group-hover:text-zinc-900 dark:group-hover:text-white" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase">Compartir</span>
                </button>
              </div>
            </div>

            <div className="p-4 bg-emerald-50 dark:bg-emerald-500/5 border-t border-zinc-200 dark:border-white/5 text-center shrink-0">
              <p className="text-[10px] text-zinc-500 font-medium">
                Este código permite verificar certificaciones y EPP asignado en tiempo real.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
