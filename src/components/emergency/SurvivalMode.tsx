import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, HeartPulse, Flame, Droplets, Wind, Map, BookOpen, X, ChevronRight, Zap, Radio, Mic, MicOff } from 'lucide-react';
import { Card, Button } from '../shared/Card';
import { useAcousticSOS } from '../../hooks/useAcousticSOS';
import { useWakeLock } from '../../hooks/useWakeLock';

interface SurvivalModeProps {
  onClose: () => void;
}

const survivalGuides = [
  {
    id: 'first-aid',
    title: 'Primeros Auxilios Básicos',
    icon: HeartPulse,
    color: 'text-rose-500',
    content: [
      { step: '1', text: 'Asegurar el área antes de acercarse a la víctima.' },
      { step: '2', text: 'Evaluar consciencia: "Señor/a, ¿me escucha?".' },
      { step: '3', text: 'Si no responde, revisar respiración (ver, oír, sentir).' },
      { step: '4', text: 'Si no respira, iniciar RCP (30 compresiones x 2 ventilaciones).' },
      { step: '5', text: 'Controlar hemorragias con presión directa.' }
    ]
  },
  {
    id: 'fire',
    title: 'Incendio / Humo',
    icon: Flame,
    color: 'text-orange-500',
    content: [
      { step: '1', text: 'Activar alarma y evacuar inmediatamente.' },
      { step: '2', text: 'Si hay humo, gatear a ras de suelo (el aire limpio está abajo).' },
      { step: '3', text: 'Tocar las puertas antes de abrir; si están calientes, buscar otra salida.' },
      { step: '4', text: 'No usar ascensores bajo ninguna circunstancia.' },
      { step: '5', text: 'Dirigirse al Punto de Encuentro designado.' }
    ]
  },
  {
    id: 'earthquake',
    title: 'Sismo Severo',
    icon: Wind,
    color: 'text-amber-500',
    content: [
      { step: '1', text: 'Mantener la calma. Agacharse, cubrirse y afirmarse.' },
      { step: '2', text: 'Alejarse de ventanas, estanterías y objetos que puedan caer.' },
      { step: '3', text: 'Si está al aire libre, alejarse de edificios, árboles y postes.' },
      { step: '4', text: 'Esperar a que termine el movimiento para evacuar.' },
      { step: '5', text: 'No encender fósforos ni usar ascensores.' }
    ]
  }
];

// Emergency breathing overlay — auto-starts, uses physiological sigh pattern
function EmergencyBreathing({ onDismiss }: { onDismiss: () => void }) {
  const [phase, setPhase] = useState<'Inhala' | 'Inhala más' | 'Exhala lento'>('Inhala');

  useEffect(() => {
    // Physiological sigh: double inhale + long exhale (Huberman protocol)
    const cycle = async () => {
      setPhase('Inhala');
      await new Promise(r => setTimeout(r, 2000));
      setPhase('Inhala más');
      navigator.vibrate?.([80]);
      await new Promise(r => setTimeout(r, 1000));
      setPhase('Exhala lento');
      navigator.vibrate?.([300]);
      await new Promise(r => setTimeout(r, 4000));
    };

    let active = true;
    const run = async () => {
      while (active) { await cycle(); }
    };
    run();
    return () => { active = false; };
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[150] bg-black/95 flex flex-col items-center justify-center p-6"
    >
      <p className="text-zinc-400 text-xs font-bold uppercase tracking-widest mb-4">
        Tu señal está activa. El rescate está en camino.
      </p>
      <motion.div
        animate={{ scale: phase === 'Exhala lento' ? 1 : phase === 'Inhala más' ? 1.6 : 1.3 }}
        transition={{ duration: phase === 'Exhala lento' ? 4 : phase === 'Inhala más' ? 1 : 2, ease: 'easeInOut' }}
        className="w-36 h-36 rounded-full bg-sky-500/20 border-2 border-sky-500/50 flex items-center justify-center mb-8"
      >
        <span className="text-sky-300 font-black text-lg text-center leading-tight px-2">{phase}</span>
      </motion.div>
      <p className="text-white font-black text-2xl uppercase tracking-tight mb-2">Respira conmigo</p>
      <p className="text-zinc-500 text-xs text-center max-w-xs">
        Respirar lento reduce el consumo de oxígeno y mantiene tu mente clara.
      </p>
      <button
        onClick={onDismiss}
        className="mt-10 px-6 py-3 border border-zinc-700 rounded-xl text-xs font-bold text-zinc-400 hover:text-white uppercase tracking-widest transition-colors"
      >
        Estoy calmado
      </button>
    </motion.div>
  );
}

export function SurvivalMode({ onClose }: SurvivalModeProps) {
  const [activeGuide, setActiveGuide] = useState<string | null>(null);
  const [isStrobeActive, setIsStrobeActive] = useState(false);
  const [strobeFlash, setStrobeFlash] = useState(false);
  const [showPanic, setShowPanic] = useState(false);
  const torchStreamRef = useRef<MediaStream | null>(null);
  const { requestWakeLock, releaseWakeLock } = useWakeLock();

  // Acoustic SOS: 3 loud knocks → auto-activate strobe
  const { isActive: sosListening, noiseLevel, start: startSOS, stop: stopSOS } = useAcousticSOS({
    threshold: 75,
    onSOS: useCallback(() => {
      setIsStrobeActive(true);
      navigator.vibrate?.([500, 200, 500, 200, 500]);
    }, []),
  });

  // Strobe beacon: 2Hz flash
  useEffect(() => {
    if (!isStrobeActive) {
      setStrobeFlash(false);
      return;
    }
    requestWakeLock();
    const interval = setInterval(() => setStrobeFlash(f => !f), 500);

    // Try to toggle device torch as well
    const startTorch = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        torchStreamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        let on = false;
        setInterval(() => {
          on = !on;
          (track.applyConstraints as any)({ advanced: [{ torch: on }] }).catch(() => {});
        }, 500);
      } catch { /* torch not available, screen strobe is enough */ }
    };
    startTorch();

    return () => {
      clearInterval(interval);
      if (torchStreamRef.current) {
        torchStreamRef.current.getTracks().forEach(t => t.stop());
        torchStreamRef.current = null;
      }
      releaseWakeLock();
    };
  }, [isStrobeActive, requestWakeLock, releaseWakeLock]);

  const guide = survivalGuides.find(g => g.id === activeGuide);

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col">
      {/* Strobe overlay */}
      {isStrobeActive && (
        <div
          className={`fixed inset-0 z-[120] pointer-events-none transition-colors duration-75 ${
            strobeFlash ? 'bg-white' : 'bg-transparent'
          }`}
        />
      )}

      {/* Emergency breathing overlay */}
      <AnimatePresence>
        {showPanic && <EmergencyBreathing onDismiss={() => setShowPanic(false)} />}
      </AnimatePresence>

      {/* Header */}
      <div className="p-4 border-b border-rose-500/20 bg-rose-500/5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-rose-500/20 rounded-lg animate-pulse">
            <ShieldAlert className="w-6 h-6 text-rose-500" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white uppercase tracking-tight">
              Modo Supervivencia
            </h2>
            <p className="text-xs text-rose-400 font-bold tracking-widest uppercase">
              100% Offline • Siempre Listo
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors">
          <X className="w-6 h-6 text-zinc-400" />
        </button>
      </div>

      {/* Emergency action buttons */}
      <div className="p-4 grid grid-cols-3 gap-2 shrink-0 border-b border-white/5">
        {/* Strobe beacon */}
        <button
          onClick={() => setIsStrobeActive(v => !v)}
          className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all ${
            isStrobeActive
              ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400 animate-pulse'
              : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
          }`}
        >
          <Zap className="w-5 h-5" />
          <span className="text-[9px] font-bold uppercase tracking-wider">
            {isStrobeActive ? 'Faro ON' : 'Faro'}
          </span>
        </button>

        {/* Acoustic SOS listener */}
        <button
          onClick={() => sosListening ? stopSOS() : startSOS()}
          className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all ${
            sosListening
              ? 'bg-rose-500/20 border-rose-500/50 text-rose-400'
              : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
          }`}
        >
          {sosListening ? <Radio className="w-5 h-5 animate-pulse" /> : <Mic className="w-5 h-5" />}
          <span className="text-[9px] font-bold uppercase tracking-wider">
            {sosListening ? `SOS ${noiseLevel}` : 'SOS Acústico'}
          </span>
        </button>

        {/* Anti-panic breathing */}
        <button
          onClick={() => setShowPanic(true)}
          className="flex flex-col items-center gap-1 p-3 rounded-xl border border-zinc-700 text-zinc-400 hover:border-sky-500 hover:text-sky-400 transition-all"
        >
          <Wind className="w-5 h-5" />
          <span className="text-[9px] font-bold uppercase tracking-wider">Respirar</span>
        </button>
      </div>

      {/* Acoustic SOS hint */}
      {sosListening && (
        <div className="px-4 py-2 bg-rose-500/5 border-b border-rose-500/10 shrink-0">
          <p className="text-[10px] text-rose-400 text-center font-bold">
            Escuchando — 3 golpes fuertes activan el faro automáticamente
          </p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-3xl mx-auto">
          <AnimatePresence mode="wait">
            {!activeGuide ? (
              <motion.div
                key="menu"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="grid grid-cols-1 sm:grid-cols-2 gap-4"
              >
                {survivalGuides.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setActiveGuide(g.id)}
                    className="p-6 rounded-2xl border-2 border-zinc-800 bg-zinc-900/50 hover:border-rose-500/50 hover:bg-rose-500/5 transition-all text-left flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-3 rounded-xl bg-zinc-800 group-hover:bg-rose-500/10 ${g.color} transition-colors`}>
                        <g.icon className="w-8 h-8" />
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white">{g.title}</h3>
                        <p className="text-xs text-zinc-500 uppercase tracking-wider mt-1">Manual Táctico</p>
                      </div>
                    </div>
                    <ChevronRight className="w-6 h-6 text-zinc-600 group-hover:text-rose-500 transition-colors" />
                  </button>
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="guide"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="space-y-6"
              >
                <button
                  onClick={() => setActiveGuide(null)}
                  className="text-sm font-bold text-zinc-400 hover:text-white flex items-center gap-2 uppercase tracking-wider"
                >
                  <ChevronRight className="w-4 h-4 rotate-180" />
                  Volver al Menú
                </button>

                {guide && (
                  <Card className="p-6 sm:p-8 border-rose-500/20 bg-zinc-900/80">
                    <div className="flex items-center gap-4 mb-8">
                      <div className={`p-4 rounded-2xl bg-zinc-800 ${guide.color}`}>
                        <guide.icon className="w-10 h-10" />
                      </div>
                      <div>
                        <h2 className="text-2xl sm:text-3xl font-black text-white uppercase tracking-tight">
                          {guide.title}
                        </h2>
                        <p className="text-sm text-zinc-400 font-medium mt-1">
                          Siga estas instrucciones paso a paso.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {guide.content.map((item, idx) => (
                        <div key={idx} className="flex gap-4 p-4 rounded-xl bg-black/40 border border-white/5">
                          <div className="w-8 h-8 rounded-full bg-rose-500/20 text-rose-500 flex items-center justify-center font-black shrink-0">
                            {item.step}
                          </div>
                          <p className="text-zinc-300 font-medium leading-relaxed">
                            {item.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
