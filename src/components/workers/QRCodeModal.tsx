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
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-zinc-900 border border-white/10 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-white/5 flex justify-between items-center bg-gradient-to-r from-emerald-500/10 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                  <QrCode className="w-6 h-6 text-emerald-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white">Identificación QR</h2>
                  <p className="text-xs text-zinc-400">{worker.name}</p>
                </div>
              </div>
              <button 
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-full transition-colors text-zinc-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-8 flex flex-col items-center">
              <div className="bg-white p-4 rounded-2xl shadow-xl mb-6">
                <QRCode 
                  value={qrValue}
                  size={200}
                  level="H"
                  style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                />
              </div>

              <div className="text-center mb-8">
                <p className="text-zinc-400 text-sm mb-1">ID: {worker.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-emerald-500 text-xs font-bold uppercase tracking-widest">Verificación Activa</p>
              </div>

              <div className="grid grid-cols-3 gap-4 w-full">
                <button className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-zinc-800 hover:bg-zinc-700 transition-colors group">
                  <Download className="w-5 h-5 text-zinc-400 group-hover:text-white" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase">Bajar</span>
                </button>
                <button className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-zinc-800 hover:bg-zinc-700 transition-colors group">
                  <Printer className="w-5 h-5 text-zinc-400 group-hover:text-white" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase">Imprimir</span>
                </button>
                <button className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-zinc-800 hover:bg-zinc-700 transition-colors group">
                  <Share2 className="w-5 h-5 text-zinc-400 group-hover:text-white" />
                  <span className="text-[10px] font-bold text-zinc-500 uppercase">Compartir</span>
                </button>
              </div>
            </div>

            <div className="p-4 bg-emerald-500/5 border-t border-white/5 text-center">
              <p className="text-[10px] text-zinc-500 font-medium">
                Este código permite verificar certificaciones y EPP asignado en tiempo real.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
