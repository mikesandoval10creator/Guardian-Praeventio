import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldAlert, AlertTriangle, CheckCircle2, XCircle, Info, Beaker } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

// Simplified UN Hazard Classes
const HAZARD_CLASSES = [
  { id: '1', name: 'Explosivos', color: 'bg-orange-500' },
  { id: '2.1', name: 'Gases Inflamables', color: 'bg-red-500' },
  { id: '2.2', name: 'Gases No Inflamables', color: 'bg-green-500' },
  { id: '2.3', name: 'Gases Tóxicos', color: 'bg-zinc-100 text-black' },
  { id: '3', name: 'Líquidos Inflamables', color: 'bg-red-600' },
  { id: '4.1', name: 'Sólidos Inflamables', color: 'bg-red-400' },
  { id: '5.1', name: 'Comburentes (Oxidantes)', color: 'bg-yellow-400 text-black' },
  { id: '6.1', name: 'Sustancias Tóxicas', color: 'bg-zinc-100 text-black' },
  { id: '8', name: 'Sustancias Corrosivas', color: 'bg-zinc-800' },
];

// Segregation Matrix (Simplified for demo purposes)
// 0: Incompatible (Must be separated)
// 1: Compatible (Can be stored together)
// 2: Caution (Store with specific separation distance)
const SEGREGATION_MATRIX: Record<string, Record<string, number>> = {
  '1':   { '1': 1, '2.1': 0, '2.2': 0, '2.3': 0, '3': 0, '4.1': 0, '5.1': 0, '6.1': 0, '8': 0 },
  '2.1': { '1': 0, '2.1': 1, '2.2': 1, '2.3': 0, '3': 0, '4.1': 0, '5.1': 0, '6.1': 0, '8': 0 },
  '2.2': { '1': 0, '2.1': 1, '2.2': 1, '2.3': 1, '3': 1, '4.1': 1, '5.1': 0, '6.1': 1, '8': 1 },
  '2.3': { '1': 0, '2.1': 0, '2.2': 1, '2.3': 1, '3': 0, '4.1': 0, '5.1': 0, '6.1': 1, '8': 0 },
  '3':   { '1': 0, '2.1': 0, '2.2': 1, '2.3': 0, '3': 1, '4.1': 1, '5.1': 0, '6.1': 2, '8': 0 },
  '4.1': { '1': 0, '2.1': 0, '2.2': 1, '2.3': 0, '3': 1, '4.1': 1, '5.1': 0, '6.1': 2, '8': 0 },
  '5.1': { '1': 0, '2.1': 0, '2.2': 0, '2.3': 0, '3': 0, '4.1': 0, '5.1': 1, '6.1': 0, '8': 0 },
  '6.1': { '1': 0, '2.1': 0, '2.2': 1, '2.3': 1, '3': 2, '4.1': 2, '5.1': 0, '6.1': 1, '8': 0 },
  '8':   { '1': 0, '2.1': 0, '2.2': 1, '2.3': 0, '3': 0, '4.1': 0, '5.1': 0, '6.1': 0, '8': 1 },
};

export function HazmatStorage() {
  const [selectedClass1, setSelectedClass1] = useState<string | null>(null);
  const [selectedClass2, setSelectedClass2] = useState<string | null>(null);

  const getCompatibility = () => {
    if (!selectedClass1 || !selectedClass2) return null;
    return SEGREGATION_MATRIX[selectedClass1]?.[selectedClass2];
  };

  const compatibility = getCompatibility();

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Beaker className="w-8 h-8 text-emerald-500" />
            Acopio HAZMAT
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Matriz de Segregación Química Offline
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border text-emerald-500 bg-emerald-500/10 border-emerald-500/20 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Validación Activa
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Selector Panel */}
        <Card className="p-6 border-white/5 space-y-6 lg:col-span-1">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Selección de Sustancias
          </h2>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-3">Sustancia A (Clase UN)</label>
              <div className="grid grid-cols-2 gap-2">
                {HAZARD_CLASSES.map((c) => (
                  <button
                    key={`a-${c.id}`}
                    onClick={() => setSelectedClass1(c.id)}
                    className={`p-2 rounded-lg text-xs font-bold border text-left transition-all ${
                      selectedClass1 === c.id
                        ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                        : 'bg-zinc-900 border-white/5 text-zinc-400 hover:bg-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-sm ${c.color}`} />
                      <span>{c.id}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-3">Sustancia B (Clase UN)</label>
              <div className="grid grid-cols-2 gap-2">
                {HAZARD_CLASSES.map((c) => (
                  <button
                    key={`b-${c.id}`}
                    onClick={() => setSelectedClass2(c.id)}
                    className={`p-2 rounded-lg text-xs font-bold border text-left transition-all ${
                      selectedClass2 === c.id
                        ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                        : 'bg-zinc-900 border-white/5 text-zinc-400 hover:bg-zinc-800'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-sm ${c.color}`} />
                      <span>{c.id}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Result Panel */}
        <Card className="p-6 border-white/5 lg:col-span-2 flex flex-col justify-center items-center relative overflow-hidden min-h-[400px]">
          {/* Background Pattern */}
          <div className="absolute inset-0 opacity-10" style={{
            backgroundImage: 'radial-gradient(circle at center, #3f3f46 1px, transparent 1px)',
            backgroundSize: '20px 20px'
          }} />

          {!selectedClass1 || !selectedClass2 ? (
            <div className="text-center z-10">
              <Beaker className="w-16 h-16 text-zinc-700 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-zinc-500">Seleccione dos sustancias</h3>
              <p className="text-sm text-zinc-600 mt-2">Para validar su compatibilidad de almacenamiento conjunto.</p>
            </div>
          ) : (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              key={`${selectedClass1}-${selectedClass2}`}
              className="z-10 w-full max-w-md"
            >
              <div className="flex justify-between items-center mb-8">
                <div className="text-center">
                  <div className={`w-16 h-16 mx-auto rounded-xl flex items-center justify-center text-2xl font-black border-4 border-zinc-900 shadow-xl ${HAZARD_CLASSES.find(c => c.id === selectedClass1)?.color}`}>
                    {selectedClass1}
                  </div>
                  <p className="text-xs font-bold text-zinc-400 mt-3 uppercase tracking-wider">
                    {HAZARD_CLASSES.find(c => c.id === selectedClass1)?.name}
                  </p>
                </div>

                <div className="flex-1 flex justify-center">
                  <div className="w-12 h-1 bg-zinc-800 rounded-full relative">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 px-2 text-zinc-500 font-bold text-xs">
                      VS
                    </div>
                  </div>
                </div>

                <div className="text-center">
                  <div className={`w-16 h-16 mx-auto rounded-xl flex items-center justify-center text-2xl font-black border-4 border-zinc-900 shadow-xl ${HAZARD_CLASSES.find(c => c.id === selectedClass2)?.color}`}>
                    {selectedClass2}
                  </div>
                  <p className="text-xs font-bold text-zinc-400 mt-3 uppercase tracking-wider">
                    {HAZARD_CLASSES.find(c => c.id === selectedClass2)?.name}
                  </p>
                </div>
              </div>

              <div className={`p-6 rounded-2xl border ${
                compatibility === 1 ? 'bg-emerald-500/10 border-emerald-500/30' :
                compatibility === 0 ? 'bg-rose-500/10 border-rose-500/30' :
                'bg-amber-500/10 border-amber-500/30'
              }`}>
                <div className="flex items-center gap-4 mb-4">
                  {compatibility === 1 ? <CheckCircle2 className="w-10 h-10 text-emerald-500" /> :
                   compatibility === 0 ? <XCircle className="w-10 h-10 text-rose-500" /> :
                   <AlertTriangle className="w-10 h-10 text-amber-500" />}
                  
                  <div>
                    <h3 className={`text-xl font-black uppercase tracking-wider ${
                      compatibility === 1 ? 'text-emerald-400' :
                      compatibility === 0 ? 'text-rose-400' :
                      'text-amber-400'
                    }`}>
                      {compatibility === 1 ? 'Almacenamiento Permitido' :
                       compatibility === 0 ? 'Incompatible - Separar' :
                       'Precaución - Separación Específica'}
                    </h3>
                  </div>
                </div>

                <p className="text-sm text-zinc-300 leading-relaxed">
                  {compatibility === 1 ? 'Estas sustancias pueden almacenarse en la misma bodega o área de acopio sin requerimientos especiales de separación, siempre que se mantengan en sus envases originales.' :
                   compatibility === 0 ? '¡PELIGRO! Estas sustancias no deben almacenarse juntas. Requieren bodegas separadas o una distancia mínima de 10 metros con barreras físicas (muros cortafuego) según normativa.' :
                   'Pueden almacenarse en la misma bodega, pero requieren una separación mínima de 3 metros o barreras físicas intermedias para evitar reacciones en caso de derrame.'}
                </p>
              </div>
            </motion.div>
          )}

          <div className="absolute bottom-6 right-6 bg-black/50 backdrop-blur-md border border-white/10 p-3 rounded-xl max-w-xs z-10">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
              <p className="text-xs text-zinc-300">
                Matriz de segregación basada en NCh 382 y NCh 2190. Esta herramienta funciona 100% offline para uso en bodegas remotas.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
