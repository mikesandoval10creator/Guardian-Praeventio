import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Play, RotateCcw, Trophy, AlertCircle, X } from 'lucide-react';

interface ReflexBuzzerProps {
  onComplete: (points: number) => void;
  onClose: () => void;
}

export function ReflexBuzzer({ onComplete, onClose }: ReflexBuzzerProps) {
  const [gameState, setGameState] = useState<'start' | 'waiting' | 'ready' | 'finished'>('start');
  const [reactionTime, setReactionTime] = useState<number | null>(null);
  const [bestTime, setBestTime] = useState<number | null>(null);
  const [attempts, setAttempts] = useState(0);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  const startGame = () => {
    setGameState('waiting');
    setReactionTime(null);
    
    // Random wait between 2 to 5 seconds
    const waitTime = Math.floor(Math.random() * 3000) + 2000;
    
    timeoutRef.current = setTimeout(() => {
      setGameState('ready');
      startTimeRef.current = Date.now();
    }, waitTime);
  };

  const handleInteraction = () => {
    if (gameState === 'waiting') {
      // Too early!
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setGameState('start');
      alert('¡Demasiado pronto! Espera a que la pantalla se ponga verde.');
    } else if (gameState === 'ready') {
      // Good reaction
      const time = Date.now() - startTimeRef.current;
      setReactionTime(time);
      setGameState('finished');
      setAttempts(prev => prev + 1);
      
      if (!bestTime || time < bestTime) {
        setBestTime(time);
      }
    }
  };

  const handleFinish = () => {
    if (bestTime) {
      // Calculate points based on best time
      // < 200ms = 100 points
      // < 300ms = 80 points
      // < 400ms = 50 points
      // > 400ms = 20 points
      let points = 20;
      if (bestTime < 200) points = 100;
      else if (bestTime < 300) points = 80;
      else if (bestTime < 400) points = 50;

      onComplete(points);
    } else {
      onClose();
    }
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 40 }}
        className="bg-zinc-900 border border-white/10 rounded-[32px] w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col"
      >
        <div className="p-6 border-b border-white/10 flex items-center justify-between shrink-0 bg-zinc-900/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center text-amber-500 border border-amber-500/20">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white uppercase tracking-tight">Buzzer de Reflejos</h2>
              <p className="text-sm text-zinc-400">Evalúa tu capacidad de respuesta antes del turno</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-8 flex flex-col items-center justify-center min-h-[400px]">
          <AnimatePresence mode="wait">
            {gameState === 'start' && (
              <motion.div
                key="start"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-center space-y-8"
              >
                <div className="max-w-md mx-auto text-zinc-400 text-sm leading-relaxed">
                  <p>Cuando hagas clic en "Comenzar", la pantalla se pondrá roja.</p>
                  <p className="mt-2 text-white font-bold">Espera a que se ponga VERDE y haz clic lo más rápido posible.</p>
                </div>
                
                <button
                  onClick={startGame}
                  className="px-8 py-4 bg-amber-500 hover:bg-amber-600 text-white rounded-2xl font-black uppercase tracking-widest text-lg transition-all flex items-center gap-3 mx-auto"
                >
                  <Play className="w-6 h-6 fill-current" />
                  Comenzar Prueba
                </button>
              </motion.div>
            )}

            {gameState === 'waiting' && (
              <motion.div
                key="waiting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={handleInteraction}
                className="absolute inset-0 bg-rose-500 flex items-center justify-center cursor-pointer"
              >
                <h3 className="text-4xl font-black text-white uppercase tracking-widest">Espera...</h3>
              </motion.div>
            )}

            {gameState === 'ready' && (
              <motion.div
                key="ready"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={handleInteraction}
                className="absolute inset-0 bg-emerald-500 flex items-center justify-center cursor-pointer"
              >
                <h3 className="text-6xl font-black text-white uppercase tracking-widest">¡AHORA!</h3>
              </motion.div>
            )}

            {gameState === 'finished' && (
              <motion.div
                key="finished"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="text-center space-y-8 w-full"
              >
                <div className="bg-zinc-800/50 border border-white/10 rounded-3xl p-8">
                  <h3 className="text-zinc-400 font-bold uppercase tracking-widest mb-2">Tiempo de Reacción</h3>
                  <div className="text-6xl font-black text-white tracking-tighter">
                    {reactionTime} <span className="text-2xl text-zinc-500">ms</span>
                  </div>
                  
                  {bestTime && (
                    <div className="mt-4 inline-flex items-center gap-2 text-amber-500 bg-amber-500/10 px-4 py-2 rounded-xl font-bold">
                      <Trophy className="w-4 h-4" />
                      Mejor tiempo: {bestTime} ms
                    </div>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <button
                    onClick={startGame}
                    className="w-full sm:w-auto px-8 py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3"
                  >
                    <RotateCcw className="w-5 h-5" />
                    Intentar de nuevo
                  </button>
                  <button
                    onClick={handleFinish}
                    className="w-full sm:w-auto px-8 py-4 bg-emerald-500 hover:bg-emerald-600 text-white rounded-2xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-3"
                  >
                    <Trophy className="w-5 h-5" />
                    Finalizar y Reclamar
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
