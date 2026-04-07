import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, X, Shield, AlertTriangle } from 'lucide-react';
import { RiskNode } from '../../types';

interface PresentationModeProps {
  risks: RiskNode[];
  onClose: () => void;
}

export function PresentationMode({ risks, onClose }: PresentationModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = 'auto'; };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') nextSlide();
      if (e.key === 'ArrowLeft') prevSlide();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, risks.length]);

  const nextSlide = () => setCurrentIndex((prev) => (prev + 1) % risks.length);
  const prevSlide = () => setCurrentIndex((prev) => (prev - 1 + risks.length) % risks.length);

  if (risks.length === 0) {
    return (
      <div className="fixed inset-0 z-[100] bg-black flex items-center justify-center">
        <div className="text-white text-center">
          <AlertTriangle className="w-16 h-16 text-amber-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold">No hay riesgos para presentar</h2>
          <button onClick={onClose} className="mt-6 px-6 py-2 bg-zinc-800 rounded-xl hover:bg-zinc-700 transition-colors">Salir</button>
        </div>
      </div>
    );
  }

  const currentRisk = risks[currentIndex];

  return (
    <div className="fixed inset-0 z-[100] bg-black text-white flex flex-col">
      {/* Header */}
      <header className="p-6 flex justify-between items-center bg-zinc-900/50 border-b border-white/10">
        <div className="flex items-center gap-4">
          <Shield className="w-8 h-8 text-emerald-500" />
          <div>
            <h1 className="text-xl font-black uppercase tracking-widest">Charla ODI - Obligación de Informar</h1>
            <p className="text-sm text-zinc-400">Riesgo {currentIndex + 1} de {risks.length}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-3 bg-white/10 hover:bg-white/20 rounded-full transition-colors">
          <X className="w-6 h-6" />
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-12 relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -100 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="max-w-5xl w-full bg-zinc-900 border border-white/10 rounded-[3rem] p-8 sm:p-16 shadow-2xl"
          >
            <div className="flex items-center gap-6 mb-8">
              <div className={`w-6 h-6 rounded-full shrink-0 ${
                String(currentRisk.metadata?.criticidad || '').toLowerCase() === 'crítica' || String(currentRisk.metadata?.criticidad || '').toLowerCase() === 'alta' ? 'bg-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.8)]' :
                String(currentRisk.metadata?.criticidad || '').toLowerCase() === 'media' ? 'bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.8)]' :
                'bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.8)]'
              }`} />
              <h2 className="text-3xl sm:text-5xl font-black tracking-tight leading-tight">{currentRisk.title}</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 sm:gap-12 mt-8 sm:mt-12">
              <div>
                <h3 className="text-lg sm:text-xl font-bold text-zinc-500 uppercase tracking-widest mb-4">Descripción del Peligro</h3>
                <p className="text-xl sm:text-2xl text-zinc-300 leading-relaxed">{currentRisk.description}</p>
              </div>
              <div className="space-y-8">
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-emerald-500 uppercase tracking-widest mb-4">Medidas de Control</h3>
                  <p className="text-xl sm:text-2xl text-white leading-relaxed">{currentRisk.metadata?.controles || 'Controles estándar aplicables'}</p>
                </div>
                <div className="flex items-center gap-4 sm:gap-8">
                  <div className="bg-zinc-800 rounded-2xl p-4 sm:p-6 flex-1 text-center">
                    <p className="text-xs sm:text-sm font-bold text-zinc-500 uppercase tracking-widest mb-2">Probabilidad</p>
                    <p className="text-3xl sm:text-4xl font-black">{currentRisk.metadata?.probabilidad || 3}</p>
                  </div>
                  <div className="bg-zinc-800 rounded-2xl p-4 sm:p-6 flex-1 text-center">
                    <p className="text-xs sm:text-sm font-bold text-zinc-500 uppercase tracking-widest mb-2">Severidad</p>
                    <p className="text-3xl sm:text-4xl font-black">{currentRisk.metadata?.severidad || 3}</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <button onClick={prevSlide} className="absolute left-2 sm:left-8 p-4 sm:p-6 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-all">
          <ChevronLeft className="w-8 h-8 sm:w-10 sm:h-10" />
        </button>
        <button onClick={nextSlide} className="absolute right-2 sm:right-8 p-4 sm:p-6 bg-white/5 hover:bg-white/10 rounded-full backdrop-blur-md transition-all">
          <ChevronRight className="w-8 h-8 sm:w-10 sm:h-10" />
        </button>
      </div>
      
      {/* Progress Bar */}
      <div className="h-2 bg-zinc-900">
        <div 
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${((currentIndex + 1) / risks.length) * 100}%` }}
        />
      </div>
    </div>
  );
}
