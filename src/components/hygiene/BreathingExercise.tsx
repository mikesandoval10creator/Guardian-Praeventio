import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Wind, Play, Square, Activity } from 'lucide-react';
import { Card } from '../shared/Card';

export function BreathingExercise() {
  const [isActive, setIsActive] = useState(false);
  const [phase, setPhase] = useState<'Inhala' | 'Mantén' | 'Exhala' | 'Mantén '>('Inhala');
  const [timeLeft, setTimeLeft] = useState(60); // 1 minute exercise

  useEffect(() => {
    let interval: NodeJS.Timeout;
    let phaseTimeout: NodeJS.Timeout;

    if (isActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);

      // Box breathing pattern: 4s inhale, 4s hold, 4s exhale, 4s hold
      const runCycle = () => {
        setPhase('Inhala');
        phaseTimeout = setTimeout(() => {
          if (!isActive) return;
          setPhase('Mantén');
          phaseTimeout = setTimeout(() => {
            if (!isActive) return;
            setPhase('Exhala');
            phaseTimeout = setTimeout(() => {
              if (!isActive) return;
              setPhase('Mantén ');
              phaseTimeout = setTimeout(() => {
                if (isActive) runCycle();
              }, 4000);
            }, 4000);
          }, 4000);
        }, 4000);
      };

      runCycle();
    } else if (timeLeft === 0) {
      setIsActive(false);
      setPhase('Inhala');
    }

    return () => {
      clearInterval(interval);
      clearTimeout(phaseTimeout);
    };
  }, [isActive, timeLeft]);

  const toggleExercise = () => {
    if (isActive) {
      setIsActive(false);
      setTimeLeft(60);
      setPhase('Inhala');
    } else {
      setIsActive(true);
      setTimeLeft(60);
    }
  };

  const getScale = () => {
    switch (phase) {
      case 'Inhala': return 1.5;
      case 'Mantén': return 1.5;
      case 'Exhala': return 1;
      case 'Mantén ': return 1;
      default: return 1;
    }
  };

  return (
    <Card className="p-6 border-white/5 space-y-6 relative overflow-hidden">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Wind className="w-5 h-5 text-emerald-500" />
            Pausa Fisiológica
          </h3>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">
            Respiración Guiada (1 Minuto)
          </p>
        </div>
        <button
          onClick={toggleExercise}
          className={`p-3 rounded-full transition-colors ${
            isActive ? 'bg-rose-500/20 text-rose-500 hover:bg-rose-500/30' : 'bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/30'
          }`}
        >
          {isActive ? <Square className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>
      </div>

      <div className="flex flex-col items-center justify-center py-8 h-48">
        {!isActive ? (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
              <Activity className="w-8 h-8 text-emerald-500" />
            </div>
            <p className="text-sm text-zinc-400">
              Recomendado antes de tareas de alto rigor mental o trabajos en altura.
            </p>
          </div>
        ) : (
          <div className="relative flex flex-col items-center justify-center w-full h-full">
            <motion.div
              className="absolute w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center"
              animate={{ scale: getScale() }}
              transition={{ duration: 4, ease: "easeInOut" }}
            >
              <span className="text-emerald-400 font-bold text-lg">{phase}</span>
            </motion.div>
            
            <div className="absolute bottom-0 text-zinc-500 font-mono text-sm">
              00:{timeLeft.toString().padStart(2, '0')}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
