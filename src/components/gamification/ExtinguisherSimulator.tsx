import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Shield, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw, Trophy, X } from 'lucide-react';
import confetti from 'canvas-confetti';

interface ExtinguisherSimulatorProps {
  onComplete: (points: number) => void;
  onClose: () => void;
}

const PASS_STEPS = [
  { id: 'pull', title: 'Tirar (Pull)', description: 'Tira del pasador de seguridad para romper el precinto.', icon: '📌' },
  { id: 'aim', title: 'Apuntar (Aim)', description: 'Apunta la boquilla hacia la base del fuego.', icon: '🎯' },
  { id: 'squeeze', title: 'Presionar (Squeeze)', description: 'Presiona la palanca de forma controlada.', icon: '✊' },
  { id: 'sweep', title: 'Barrer (Sweep)', description: 'Mueve la boquilla de lado a lado cubriendo el área.', icon: '↔️' }
];

export function ExtinguisherSimulator({ onComplete, onClose }: ExtinguisherSimulatorProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [fireSize, setFireSize] = useState(100);
  const [isExtinguishing, setIsExtinguishing] = useState(false);
  const [gameWon, setGameWon] = useState(false);
  const [gameLost, setGameLost] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);

  useEffect(() => {
    if (gameWon || gameLost) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          setGameLost(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [gameWon, gameLost]);

  useEffect(() => {
    if (isExtinguishing && currentStep === 3) {
      const interval = setInterval(() => {
        setFireSize((prev) => {
          if (prev <= 5) {
            setGameWon(true);
            setIsExtinguishing(false);
            triggerConfetti();
            setTimeout(() => onComplete(150), 3000);
            return 0;
          }
          return prev - 5;
        });
      }, 100);
      return () => clearInterval(interval);
    }
  }, [isExtinguishing, currentStep, onComplete]);

  const triggerConfetti = () => {
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  };

  const handleStepAction = () => {
    if (currentStep < 3) {
      setCurrentStep(prev => prev + 1);
    } else if (currentStep === 3) {
      setIsExtinguishing(true);
    }
  };

  const handleReset = () => {
    setCurrentStep(0);
    setFireSize(100);
    setIsExtinguishing(false);
    setGameWon(false);
    setGameLost(false);
    setTimeLeft(30);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-white/10 rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative">
        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-gradient-to-r from-rose-500/10 to-transparent">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center text-rose-500">
              <Flame className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-white uppercase tracking-tight">Simulador de Extintores</h2>
              <p className="text-xs text-rose-400 font-bold uppercase tracking-widest">Método P.A.S.S.</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className={`text-2xl font-black ${timeLeft <= 10 ? 'text-rose-500 animate-pulse' : 'text-zinc-300'}`}>
              00:{timeLeft.toString().padStart(2, '0')}
            </div>
            <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-xl transition-colors text-zinc-400 hover:text-white">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="p-8 flex flex-col items-center justify-center min-h-[400px] relative overflow-hidden">
          {/* Fire Animation */}
          <AnimatePresence>
            {!gameWon && (
              <motion.div
                className="absolute bottom-20 flex justify-center items-end"
                animate={{ scale: fireSize / 100, opacity: fireSize / 100 }}
                transition={{ duration: 0.2 }}
              >
                <div className="relative">
                  <Flame className="w-48 h-48 text-orange-500 animate-pulse" style={{ filter: 'drop-shadow(0 0 20px rgba(249, 115, 22, 0.8))' }} />
                  <Flame className="w-32 h-32 text-yellow-400 absolute bottom-0 left-8 animate-bounce" style={{ filter: 'drop-shadow(0 0 10px rgba(250, 204, 21, 0.8))' }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Game Over / Win States */}
          <AnimatePresence>
            {gameWon && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/90 backdrop-blur-sm z-20"
              >
                <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500 mb-6">
                  <Trophy className="w-12 h-12" />
                </div>
                <h3 className="text-3xl font-black text-white uppercase tracking-tighter mb-2">¡Fuego Extinguido!</h3>
                <p className="text-emerald-400 font-bold uppercase tracking-widest mb-8">+150 Puntos</p>
                <p className="text-zinc-400 text-sm max-w-md text-center mb-8">
                  Has aplicado correctamente el método P.A.S.S. para controlar la emergencia.
                </p>
              </motion.div>
            )}

            {gameLost && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/90 backdrop-blur-sm z-20"
              >
                <div className="w-24 h-24 rounded-full bg-rose-500/20 flex items-center justify-center text-rose-500 mb-6">
                  <AlertTriangle className="w-12 h-12" />
                </div>
                <h3 className="text-3xl font-black text-white uppercase tracking-tighter mb-2">¡Tiempo Agotado!</h3>
                <p className="text-rose-400 font-bold uppercase tracking-widest mb-8">El fuego se ha descontrolado</p>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-6 py-3 bg-rose-500 hover:bg-rose-600 text-white rounded-xl font-bold uppercase tracking-widest transition-colors"
                >
                  <RefreshCw className="w-5 h-5" />
                  Reintentar
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Controls */}
          {!gameWon && !gameLost && (
            <div className="absolute bottom-8 left-0 right-0 px-8">
              <div className="bg-zinc-800/80 backdrop-blur-md border border-white/10 rounded-2xl p-6">
                <div className="flex justify-between mb-6 relative">
                  <div className="absolute top-1/2 left-0 right-0 h-1 bg-zinc-700 -translate-y-1/2 z-0" />
                  <div 
                    className="absolute top-1/2 left-0 h-1 bg-emerald-500 -translate-y-1/2 z-0 transition-all duration-300" 
                    style={{ width: `${(currentStep / 3) * 100}%` }}
                  />
                  
                  {PASS_STEPS.map((step, index) => (
                    <div key={step.id} className="relative z-10 flex flex-col items-center gap-2">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg transition-colors ${
                        index < currentStep ? 'bg-emerald-500 text-white' :
                        index === currentStep ? 'bg-emerald-500/20 text-emerald-500 border-2 border-emerald-500' :
                        'bg-zinc-700 text-zinc-500'
                      }`}>
                        {index < currentStep ? <CheckCircle2 className="w-5 h-5" /> : step.icon}
                      </div>
                      <span className={`text-[10px] font-bold uppercase tracking-widest ${index <= currentStep ? 'text-emerald-400' : 'text-zinc-500'}`}>
                        {step.title.split(' ')[0]}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="text-center mb-6">
                  <h4 className="text-lg font-bold text-white mb-1">{PASS_STEPS[currentStep].title}</h4>
                  <p className="text-sm text-zinc-400">{PASS_STEPS[currentStep].description}</p>
                </div>

                <button
                  onClick={handleStepAction}
                  onMouseUp={() => currentStep === 3 && setIsExtinguishing(false)}
                  onMouseLeave={() => currentStep === 3 && setIsExtinguishing(false)}
                  className={`w-full py-4 rounded-xl font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${
                    currentStep === 3 
                      ? 'bg-rose-500 hover:bg-rose-600 text-white active:scale-95' 
                      : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  }`}
                >
                  {currentStep === 3 ? (
                    <>
                      <Flame className="w-5 h-5" />
                      Mantener Presionado para Extinguir
                    </>
                  ) : (
                    <>
                      Realizar Acción
                      <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
