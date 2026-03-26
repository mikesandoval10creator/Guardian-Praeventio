import React, { useEffect, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { motion, AnimatePresence } from 'framer-motion';
import { X, QrCode, Loader2 } from 'lucide-react';

interface QRScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (decodedText: string) => void;
}

export function QRScannerModal({ isOpen, onClose, onScan }: QRScannerModalProps) {
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const scanner = new Html5QrcodeScanner(
      "reader",
      { fps: 10, qrbox: { width: 250, height: 250 } },
      /* verbose= */ false
    );

    scanner.render(
      (decodedText) => {
        setIsScanning(true);
        scanner.clear();
        onScan(decodedText);
        setIsScanning(false);
        onClose();
      },
      (error) => {
        // Ignore errors, they happen constantly when no QR is in frame
      }
    );

    return () => {
      scanner.clear().catch(error => {
        console.error("Failed to clear html5QrcodeScanner. ", error);
      });
    };
  }, [isOpen, onScan, onClose]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-2xl"
        >
          <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center text-zinc-900">
                <QrCode className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-zinc-900 uppercase tracking-tight">Escanear QR</h2>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Credencial de Trabajador</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors text-zinc-500">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 flex flex-col items-center">
            {isScanning ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <Loader2 className="w-8 h-8 text-zinc-900 animate-spin" />
                <p className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Procesando...</p>
              </div>
            ) : (
              <div id="reader" className="w-full overflow-hidden rounded-2xl border-2 border-dashed border-zinc-200" />
            )}
            
            <p className="text-xs text-zinc-500 text-center mt-6">
              Apunta la cámara hacia el código QR de la credencial del trabajador para registrar su asistencia automáticamente.
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
