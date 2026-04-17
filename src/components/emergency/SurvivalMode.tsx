import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, HeartPulse, Flame, Droplets, Wind, Map, BookOpen, X, ChevronRight } from 'lucide-react';
import { Card, Button } from '../shared/Card';

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
    icon: Wind, // Using Wind as a placeholder for tremor/earthquake
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

export function SurvivalMode({ onClose }: SurvivalModeProps) {
  const [activeGuide, setActiveGuide] = useState<string | null>(null);

  const guide = survivalGuides.find(g => g.id === activeGuide);

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-rose-500/20 bg-rose-500/5 flex items-center justify-between">
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
