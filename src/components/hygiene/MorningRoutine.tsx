import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sun, ArrowRight, CheckCircle2, Timer, Activity, Heart, Shield } from 'lucide-react';
import { Card } from '../shared/Card';

interface Stretch {
  id: string;
  title: string;
  description: string;
  duration: number; // seconds
  image: string;
  targetArea: string;
}

const STRETCHES: Stretch[] = [
  {
    id: '1',
    title: 'Elongación Cervical',
    description: 'Inclina suavemente la cabeza hacia un lado, llevando la oreja al hombro. Mantén la espalda recta.',
    duration: 15,
    image: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?auto=format&fit=crop&q=80&w=200&h=200',
    targetArea: 'Cuello'
  },
  {
    id: '2',
    title: 'Apertura de Pecho',
    description: 'Entrelaza las manos detrás de la espalda y estira los brazos hacia atrás, abriendo el pecho.',
    duration: 20,
    image: 'https://images.unsplash.com/photo-1510894347713-fc3ad6cb0d4d?auto=format&fit=crop&q=80&w=200&h=200',
    targetArea: 'Torso'
  },
  {
    id: '3',
    title: 'Estiramiento Lumbar',
    description: 'De pie, inclina el torso hacia adelante suavemente, intentando tocar la punta de los pies.',
    duration: 20,
    image: 'https://images.unsplash.com/photo-1552196564-977a44c0d3b9?auto=format&fit=crop&q=80&w=200&h=200',
    targetArea: 'Espalda'
  },
  {
    id: '4',
    title: 'Activación de Muñecas',
    description: 'Extiende un brazo y con la otra mano tira suavemente de los dedos hacia atrás.',
    duration: 15,
    image: 'https://images.unsplash.com/photo-1591343395082-e120087004b4?auto=format&fit=crop&q=80&w=200&h=200',
    targetArea: 'Brazos'
  }
];

export function MorningRoutine() {
  const [step, setStep] = useState<'intro' | 'active' | 'complete'>('intro');
  const [currentStretchIndex, setCurrentStretchIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isActive && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isActive) {
      if (currentStretchIndex < STRETCHES.length - 1) {
        setCurrentStretchIndex((prev) => prev + 1);
        setTimeLeft(STRETCHES[currentStretchIndex + 1].duration);
      } else {
        setIsActive(false);
        setStep('complete');
      }
    }
    return () => clearInterval(timer);
  }, [isActive, timeLeft, currentStretchIndex]);

  const startRoutine = () => {
    setStep('active');
    setCurrentStretchIndex(0);
    setTimeLeft(STRETCHES[0].duration);
    setIsActive(true);
  };

  const currentStretch = STRETCHES[currentStretchIndex];

  return (
    <Card className="p-6 border-white/5 overflow-hidden relative">
      <AnimatePresence mode="wait">
        {step === 'intro' && (
          <motion.div
            key="intro"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="space-y-6"
          >
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-2xl bg-amber-500/20 border border-amber-500/30">
                <Sun className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Despertar Matutino</h3>
                <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Protocolo de Activación Física</p>
              </div>
            </div>

            <p className="text-sm text-zinc-400 leading-relaxed">
              Prepara tu cuerpo para la jornada. Estas elongaciones reducen el riesgo de lesiones musculoesqueléticas y mejoran tu enfoque.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <Timer className="w-4 h-4 text-amber-400 mb-2" />
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Duración</p>
                <p className="text-sm font-bold text-white">~2 Minutos</p>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                <Activity className="w-4 h-4 text-emerald-400 mb-2" />
                <p className="text-[10px] text-zinc-500 uppercase font-bold">Intensidad</p>
                <p className="text-sm font-bold text-white">Baja / Activación</p>
              </div>
            </div>

            <button
              onClick={startRoutine}
              className="w-full py-4 rounded-2xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2"
            >
              Iniciar Check-in Fisiológico
              <ArrowRight className="w-4 h-4" />
            </button>
          </motion.div>
        )}

        {step === 'active' && (
          <motion.div
            key="active"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05 }}
            className="space-y-6"
          >
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-black text-amber-500 uppercase tracking-widest">
                Ejercicio {currentStretchIndex + 1} de {STRETCHES.length}
              </span>
              <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10">
                <Timer className="w-3 h-3 text-amber-400" />
                <span className="text-xs font-mono font-bold text-white">{timeLeft}s</span>
              </div>
            </div>

            <div className="relative aspect-square rounded-3xl overflow-hidden border border-white/10">
              <img 
                src={currentStretch.image} 
                alt={currentStretch.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-6">
                <h4 className="text-xl font-black text-white mb-1">{currentStretch.title}</h4>
                <p className="text-xs text-zinc-300 leading-relaxed">{currentStretch.description}</p>
              </div>
            </div>

            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-amber-500"
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: currentStretch.duration, ease: 'linear' }}
                key={currentStretch.id}
              />
            </div>

            <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-bold uppercase">
              <Heart className="w-3 h-3 text-rose-500" />
              Zona: {currentStretch.targetArea}
            </div>
          </motion.div>
        )}

        {step === 'complete' && (
          <motion.div
            key="complete"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-6 py-4"
          >
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto relative">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              <motion.div 
                className="absolute inset-0 rounded-full border-2 border-emerald-500"
                animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
              />
            </div>

            <div>
              <h3 className="text-2xl font-black text-white mb-2">¡Cuerpo Sincronizado!</h3>
              <p className="text-sm text-zinc-400">
                Has completado tu activación matutina. Estás listo para operar con seguridad.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3 text-left">
              <Shield className="w-5 h-5 text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-400 font-bold">
                Puntos de Seguridad obtenidos: +15 XP
              </p>
            </div>

            <button
              onClick={() => setStep('intro')}
              className="w-full py-4 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-black text-xs uppercase tracking-widest transition-all"
            >
              Finalizar Check-in
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
