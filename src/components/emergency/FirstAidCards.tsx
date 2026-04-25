import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { HeartPulse, Activity, ChevronRight, X, Play, Square, Vibrate, AlertTriangle } from 'lucide-react';
import { useAccelerometer } from '../../hooks/useAccelerometer';

const guides = [
  {
    id: 'rcp',
    title: 'RCP (Reanimación Cardiopulmonar)',
    icon: HeartPulse,
    color: 'text-rose-500',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
    steps: [
      'Asegure la zona. Verifique si la persona responde.',
      'Llame a emergencias (131) y pida un DEA.',
      'Coloque el talón de una mano en el centro del pecho.',
      'Coloque la otra mano encima y entrelace los dedos.',
      'Comprima fuerte y rápido (5-6 cm de profundidad).',
      'Siga el ritmo del metrónomo (100-120 compresiones por minuto).'
    ],
    hasMetronome: true
  },
  {
    id: 'torniquete',
    title: 'Hemorragia Masiva (Torniquete)',
    icon: Activity,
    color: 'text-red-500',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    steps: [
      'Identifique el origen del sangrado masivo.',
      'Aplique presión directa inmediata con un paño limpio.',
      'Si no se detiene, coloque el torniquete 5-8 cm por encima de la herida (nunca en una articulación).',
      'Apriete hasta que el sangrado se detenga por completo.',
      'Asegure el torniquete y anote la hora exacta de colocación.',
      'No afloje el torniquete bajo ninguna circunstancia.'
    ],
    hasMetronome: false
  }
];

export function FirstAidCards() {
  const [activeGuide, setActiveGuide] = useState<string | null>(null);
  const [metronomeActive, setMetronomeActive] = useState(false);
  const [depthCheckActive, setDepthCheckActive] = useState(false);
  const [depthFeedback, setDepthFeedback] = useState<'OK' | 'DEEPER' | 'FASTER' | null>(null);
  const peakAccelRef = useRef<number>(0);
  const lastBeatRef = useRef<number>(Date.now());

  const { data: accelData, start: startAccel, stop: stopAccel } = useAccelerometer({
    threshold: 99, // don't use fall detection
    onFallDetected: undefined,
  });

  // CPR depth feedback — uses accelerometer while metronome is active
  useEffect(() => {
    if (!depthCheckActive || !accelData) return;

    const { acceleration } = accelData;
    // Track peak acceleration per beat (compression spike)
    if (acceleration > peakAccelRef.current) {
      peakAccelRef.current = acceleration;
    }

    // Evaluate every ~600ms (one beat at 100 BPM)
    const now = Date.now();
    if (now - lastBeatRef.current >= 600) {
      const peak = peakAccelRef.current;
      peakAccelRef.current = 0;
      lastBeatRef.current = now;

      if (peak < 12) {
        setDepthFeedback('DEEPER');
        navigator.vibrate?.([200, 50, 200]);
      } else if (now - lastBeatRef.current > 750) {
        setDepthFeedback('FASTER');
        navigator.vibrate?.([100]);
      } else {
        setDepthFeedback('OK');
        navigator.vibrate?.([50]);
      }
    }
  }, [accelData, depthCheckActive]);

  const toggleDepthCheck = async () => {
    if (depthCheckActive) {
      setDepthCheckActive(false);
      setDepthFeedback(null);
      stopAccel();
    } else {
      setDepthCheckActive(true);
      await startAccel();
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    let audioCtx: AudioContext | null = null;

    if (metronomeActive) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      const playClick = () => {
        if (!audioCtx) return;
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        
        gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
        
        osc.start(audioCtx.currentTime);
        osc.stop(audioCtx.currentTime + 0.1);
      };

      // 100 BPM = 600ms per beat
      interval = setInterval(playClick, 600);
    }

    return () => {
      if (interval) clearInterval(interval);
      if (audioCtx) audioCtx.close();
    };
  }, [metronomeActive]);

  return (
    <div className="space-y-4">
      <h3 className="text-xl font-black uppercase tracking-tighter text-zinc-900 dark:text-white flex items-center gap-2">
        <HeartPulse className="w-6 h-6 text-rose-500" />
        Primeros Auxilios
      </h3>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {guides.map(guide => (
          <button
            key={guide.id}
            onClick={() => setActiveGuide(guide.id)}
            className={`p-4 rounded-2xl border text-left transition-all ${guide.bgColor} ${guide.borderColor} hover:bg-opacity-20`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-2 rounded-xl bg-white dark:bg-zinc-900 ${guide.color}`}>
                <guide.icon className="w-6 h-6" />
              </div>
              <ChevronRight className={`w-5 h-5 ${guide.color}`} />
            </div>
            <h4 className={`font-bold uppercase tracking-widest text-xs ${guide.color}`}>
              {guide.title}
            </h4>
          </button>
        ))}
      </div>

      <AnimatePresence>
        {activeGuide && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
          >
            <div className="bg-white dark:bg-zinc-900 w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border border-zinc-200 dark:border-zinc-800">
              {guides.map(guide => guide.id === activeGuide && (
                <div key={guide.id}>
                  <div className={`p-6 ${guide.bgColor} border-b ${guide.borderColor} flex items-center justify-between`}>
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-xl bg-white dark:bg-zinc-900 ${guide.color}`}>
                        <guide.icon className="w-6 h-6" />
                      </div>
                      <h2 className={`text-xl font-black uppercase tracking-tighter ${guide.color}`}>
                        {guide.title}
                      </h2>
                    </div>
                    <button
                      onClick={() => {
                        setActiveGuide(null);
                        setMetronomeActive(false);
                        setDepthCheckActive(false);
                        setDepthFeedback(null);
                        stopAccel();
                      }}
                      className="p-2 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                    >
                      <X className="w-6 h-6 text-zinc-500" />
                    </button>
                  </div>
                  
                  <div className="p-6 space-y-6">
                    <ol className="space-y-4">
                      {guide.steps.map((step, index) => (
                        <li key={index} className="flex gap-4">
                          <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${guide.bgColor} ${guide.color}`}>
                            {index + 1}
                          </span>
                          <p className="text-zinc-700 dark:text-zinc-300 font-medium pt-1">
                            {step}
                          </p>
                        </li>
                      ))}
                    </ol>

                    {guide.hasMetronome && (
                      <div className="mt-8 rounded-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                        {/* Emergency metronome — use during real CPR, hands always on victim */}
                        <div className="p-6 bg-zinc-100 dark:bg-zinc-800/50 flex flex-col items-center gap-4">
                          <div className="text-center">
                            <h4 className="font-black uppercase tracking-widest text-zinc-900 dark:text-white">Metrónomo RCP</h4>
                            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">100 BPM</p>
                            <p className="text-[10px] text-zinc-500 mt-1">
                              Usa solo el audio y la vibración. Mantén ambas manos sobre la víctima en todo momento.
                            </p>
                          </div>
                          <button
                            onClick={() => setMetronomeActive(!metronomeActive)}
                            className={`w-full py-4 rounded-xl font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                              metronomeActive
                                ? 'bg-rose-500 text-white shadow-[0_0_20px_rgba(244,63,94,0.5)] animate-pulse'
                                : 'bg-zinc-900 dark:bg-white text-white dark:text-black'
                            }`}
                          >
                            {metronomeActive ? (
                              <>
                                <Square className="w-5 h-5 fill-current" />
                                Detener Metrónomo
                              </>
                            ) : (
                              <>
                                <Play className="w-5 h-5 fill-current" />
                                Iniciar Metrónomo
                              </>
                            )}
                          </button>
                        </div>

                        {/* Training-only separator */}
                        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-t border-amber-500/30">
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                          <p className="text-[10px] font-black text-amber-600 dark:text-amber-400 uppercase tracking-widest">
                            Solo Entrenamiento — Requiere Maniquí CPR
                          </p>
                        </div>

                        {/* Depth guide — training only, shown only when metronome active */}
                        {metronomeActive && (
                          <div className="p-4 bg-zinc-50 dark:bg-zinc-900/60 space-y-3">
                            <p className="text-[10px] text-zinc-500 dark:text-zinc-400 text-center leading-relaxed">
                              Guía de profundidad de compresión. Coloca el celular sobre el maniquí — <strong>nunca sobre una víctima real.</strong>
                            </p>
                            <button
                              onClick={toggleDepthCheck}
                              className={`w-full py-3 rounded-xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all border ${
                                depthCheckActive
                                  ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
                                  : 'border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-400 hover:border-zinc-400'
                              }`}
                            >
                              <Vibrate className="w-4 h-4" />
                              {depthCheckActive ? 'Desactivar Guía (Maniquí)' : 'Activar Guía de Profundidad (Maniquí)'}
                            </button>

                            {depthCheckActive && depthFeedback && (
                              <motion.div
                                key={depthFeedback}
                                initial={{ scale: 0.9, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className={`w-full py-3 rounded-xl text-center font-black uppercase tracking-widest text-sm ${
                                  depthFeedback === 'OK'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-rose-500/20 text-rose-400 animate-pulse'
                                }`}
                              >
                                {depthFeedback === 'OK' && '✓ Profundidad correcta'}
                                {depthFeedback === 'DEEPER' && '↓ Más fuerte'}
                                {depthFeedback === 'FASTER' && '↑ Más rápido'}
                              </motion.div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
