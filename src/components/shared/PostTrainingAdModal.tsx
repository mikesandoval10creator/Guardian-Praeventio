import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AD_CONFIG, isNative, showInterstitial, loadAdSenseScript } from '../../services/adService';

const AD_DURATION = 30; // seconds

interface PostTrainingAdModalProps {
  trainingTitle: string;
  onClose: () => void;
}

/**
 * Shows after a free-plan user completes a training.
 * - Native (Android/iOS): triggers AdMob interstitial which covers the whole screen,
 *   then this modal shows only the completion message.
 * - Web (PWA): shows an AdSense banner with a 30-second countdown.
 *
 * Design goal: professional, not disruptive. One ad, one moment.
 */
export function PostTrainingAdModal({ trainingTitle, onClose }: PostTrainingAdModalProps) {
  const [secondsLeft, setSecondsLeft] = useState(AD_DURATION);
  const [canSkip, setCanSkip] = useState(false);
  const [nativeAdShown, setNativeAdShown] = useState(false);
  const adRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const navigate = useNavigate();

  // On native: show AdMob interstitial immediately and run the countdown
  useEffect(() => {
    if (isNative()) {
      showInterstitial().finally(() => setNativeAdShown(true));
    } else {
      injectAdSenseBanner();
    }

    timerRef.current = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setCanSkip(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const injectAdSenseBanner = async () => {
    if (!AD_CONFIG.adsenseClient || !AD_CONFIG.adsenseSlot) return;
    try {
      await loadAdSenseScript(); // wait for script to be available
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      ins.setAttribute('data-ad-client', AD_CONFIG.adsenseClient);
      ins.setAttribute('data-ad-slot', AD_CONFIG.adsenseSlot);
      ins.setAttribute('data-ad-format', 'auto');
      ins.setAttribute('data-full-width-responsive', 'true');
      adRef.current?.appendChild(ins);
      (window as any).adsbygoogle = (window as any).adsbygoogle || [];
      (window as any).adsbygoogle.push({});
    } catch {
      // silently ignore
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      >
        <motion.div
          initial={{ scale: 0.95, y: 20 }}
          animate={{ scale: 1, y: 0 }}
          exit={{ scale: 0.95, y: 10 }}
          className="w-full max-w-sm bg-zinc-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
        >
          {/* Completion header */}
          <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-6 py-5 flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0" />
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-widest text-emerald-500">Capacitación completada</p>
              <p className="text-sm font-bold text-white truncate mt-0.5">{trainingTitle}</p>
            </div>
          </div>

          {/* Ad area — only shown on web */}
          {!isNative() && (
            <div className="px-4 pt-4">
              <p className="text-[8px] font-bold uppercase tracking-widest text-zinc-600 text-center mb-2">Publicidad</p>
              <div
                ref={adRef}
                className="w-full min-h-[100px] rounded-xl bg-zinc-800/50 border border-white/5 flex items-center justify-center overflow-hidden"
              >
                {(!AD_CONFIG.adsenseClient || !AD_CONFIG.adsenseSlot) && (
                  <p className="text-[10px] text-zinc-600 font-bold text-center px-4 py-6">
                    Espacio publicitario
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Footer with countdown */}
          <div className="px-6 py-5 space-y-3">
            <p className="text-[10px] text-zinc-500 text-center leading-relaxed">
              Los anuncios permiten que Praeventio Guard sea gratuito para equipos de hasta 10 personas.
            </p>

            {canSkip ? (
              <button
                onClick={onClose}
                className="w-full py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-black uppercase tracking-widest text-sm transition-colors flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" />
                Continuar
              </button>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
                  Puedes continuar en
                </p>
                <div className="w-10 h-10 rounded-full border-2 border-zinc-700 flex items-center justify-center">
                  <span className="text-sm font-black text-white tabular-nums">{secondsLeft}</span>
                </div>
              </div>
            )}

            <div className="text-center pt-1">
              <button
                onClick={() => { onClose(); navigate('/pricing'); }}
                className="text-[9px] text-zinc-600 hover:text-zinc-400 underline underline-offset-2 transition-colors"
              >
                Eliminar anuncios · Plan Profesional desde $10/mes
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
