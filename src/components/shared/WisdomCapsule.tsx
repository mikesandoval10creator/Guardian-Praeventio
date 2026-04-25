import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Quote, MapPin, X, QrCode } from 'lucide-react';
import QRCode from 'react-qr-code';
import { WisdomCapsuleData } from '../../hooks/useWisdomCapsules';

const quotes = [
  "El riesgo se neutraliza en el diseño, no en la reacción.",
  "Conoce a tu enemigo (el riesgo) y conócete a ti mismo; en cien batallas, nunca estarás en peligro.",
  "La suprema excelencia consiste en quebrar la resistencia del riesgo sin luchar (prevenirlo).",
  "Las oportunidades se multiplican a medida que se aprovechan.",
  "En medio del caos, también hay oportunidad.",
  "El general que gana la batalla hace muchos cálculos en su templo antes de que se libre la batalla.",
  "La invencibilidad radica en la defensa; la posibilidad de victoria, en el ataque."
];

interface WisdomCapsuleProps {
  capsule?: WisdomCapsuleData | null;
  onDismiss?: () => void;
}

export function WisdomCapsule({ capsule, onDismiss }: WisdomCapsuleProps = {}) {
  const [quote, setQuote] = useState('');
  const [showQR, setShowQR] = useState(false);

  useEffect(() => {
    setQuote(quotes[Math.floor(Math.random() * quotes.length)]);
  }, []);

  // Geo-activated capsule overlay
  if (capsule) {
    const qrPayload = JSON.stringify({ type: 'capsule', id: capsule.id, nodeId: capsule.nodeId, machineId: capsule.machineId });

    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="fixed bottom-24 left-4 right-4 z-[80] max-w-sm mx-auto"
        >
          <div className="bg-zinc-900 border border-amber-500/30 rounded-2xl overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-amber-500/10 border-b border-amber-500/20">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-amber-500" />
                <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">
                  Cápsula de Sabiduría Cercana
                </span>
              </div>
              <div className="flex items-center gap-2">
                {capsule.nodeId && (
                  <button
                    onClick={() => setShowQR(v => !v)}
                    className="p-1 hover:bg-white/5 rounded-lg transition-colors"
                    title="Ver QR de máquina"
                  >
                    <QrCode className="w-4 h-4 text-zinc-400 hover:text-white" />
                  </button>
                )}
                {onDismiss && (
                  <button onClick={onDismiss} className="p-1 hover:bg-white/5 rounded-lg transition-colors">
                    <X className="w-4 h-4 text-zinc-400 hover:text-white" />
                  </button>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="p-4">
              {showQR ? (
                <div className="flex flex-col items-center gap-3 py-2">
                  <div className="bg-white p-3 rounded-xl">
                    <QRCode value={qrPayload} size={140} />
                  </div>
                  <p className="text-[10px] text-zinc-500 text-center">
                    Imprime este QR y pégalo en la máquina para acceso directo.
                  </p>
                </div>
              ) : (
                <>
                  <h4 className="text-sm font-black text-white mb-2">{capsule.title}</h4>
                  <p className="text-sm text-zinc-300 leading-relaxed">{capsule.content}</p>
                  {capsule.machineId && (
                    <p className="text-[10px] text-zinc-600 mt-3 uppercase tracking-widest">
                      Máquina: {capsule.machineId}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // Default: random motivational quote widget
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 bg-zinc-900/80 border border-zinc-800 rounded-2xl relative overflow-hidden max-w-md mx-auto"
    >
      <Quote className="absolute -top-2 -left-2 w-12 h-12 text-zinc-800 opacity-50 rotate-180" />
      <p className="relative z-10 text-sm font-medium text-zinc-300 italic text-center px-4">
        "{quote}"
      </p>
      <p className="relative z-10 text-[10px] font-black text-zinc-600 uppercase tracking-widest text-center mt-3">
        El Guardián / Sun Tzu
      </p>
    </motion.div>
  );
}
