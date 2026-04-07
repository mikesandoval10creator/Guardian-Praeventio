import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, ShieldAlert, AlertTriangle, Info, Plus, Search } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

export function HumanBodyViewer() {
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const bodyParts = [
    { id: 'head', name: 'Cabeza y Cuello', risk: 'high', ppe: ['Casco', 'Lentes', 'Protección Auditiva'] },
    { id: 'torso', name: 'Tórax y Abdomen', risk: 'medium', ppe: ['Chaleco Reflectante', 'Arnés'] },
    { id: 'arms', name: 'Extremidades Superiores', risk: 'high', ppe: ['Guantes de Cuero', 'Mangas Anticorte'] },
    { id: 'legs', name: 'Extremidades Inferiores', risk: 'medium', ppe: ['Pantalón Ignífugo', 'Rodilleras'] },
    { id: 'feet', name: 'Pies', risk: 'high', ppe: ['Zapatos de Seguridad (Puntera Acero)'] },
  ];

  const handlePartClick = (id: string) => {
    setSelectedPart(id === selectedPart ? null : id);
  };

  const selectedInfo = bodyParts.find(p => p.id === selectedPart);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Activity className="w-8 h-8 text-rose-500" />
            Visor Anatómico
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Mapeo de Riesgos Biomecánicos y EPP
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-rose-500 bg-rose-500/10 border-rose-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Análisis Corporal
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Interactive Viewer */}
        <Card className="p-0 border-white/5 lg:col-span-2 overflow-hidden relative min-h-[600px] bg-zinc-900 flex items-center justify-center">
          {/* Controls */}
          <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
            <button onClick={() => setZoom(z => Math.min(z + 0.2, 2))} className="p-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 text-white">
              <Plus className="w-5 h-5" />
            </button>
            <button onClick={() => setZoom(z => Math.max(z - 0.2, 0.5))} className="p-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 text-white">
              <div className="w-5 h-0.5 bg-current my-2.5" />
            </button>
          </div>

          {/* Simulated 3D/SVG Body */}
          <motion.div 
            className="relative w-64 h-[500px]"
            animate={{ scale: zoom }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          >
            {/* Head */}
            <motion.div 
              className={`absolute top-0 left-1/2 -translate-x-1/2 w-16 h-20 rounded-[40%] border-2 cursor-pointer transition-colors ${selectedPart === 'head' ? 'bg-rose-500/40 border-rose-500' : 'bg-zinc-800 border-zinc-600 hover:border-rose-400'}`}
              onClick={() => handlePartClick('head')}
              whileHover={{ scale: 1.05 }}
            />
            
            {/* Torso */}
            <motion.div 
              className={`absolute top-24 left-1/2 -translate-x-1/2 w-24 h-40 rounded-2xl border-2 cursor-pointer transition-colors ${selectedPart === 'torso' ? 'bg-amber-500/40 border-amber-500' : 'bg-zinc-800 border-zinc-600 hover:border-amber-400'}`}
              onClick={() => handlePartClick('torso')}
              whileHover={{ scale: 1.05 }}
            />

            {/* Left Arm */}
            <motion.div 
              className={`absolute top-24 left-4 w-8 h-36 rounded-full border-2 cursor-pointer transition-colors origin-top ${selectedPart === 'arms' ? 'bg-rose-500/40 border-rose-500' : 'bg-zinc-800 border-zinc-600 hover:border-rose-400'}`}
              style={{ rotate: '15deg' }}
              onClick={() => handlePartClick('arms')}
              whileHover={{ scale: 1.05 }}
            />

            {/* Right Arm */}
            <motion.div 
              className={`absolute top-24 right-4 w-8 h-36 rounded-full border-2 cursor-pointer transition-colors origin-top ${selectedPart === 'arms' ? 'bg-rose-500/40 border-rose-500' : 'bg-zinc-800 border-zinc-600 hover:border-rose-400'}`}
              style={{ rotate: '-15deg' }}
              onClick={() => handlePartClick('arms')}
              whileHover={{ scale: 1.05 }}
            />

            {/* Left Leg */}
            <motion.div 
              className={`absolute top-60 left-12 w-10 h-44 rounded-full border-2 cursor-pointer transition-colors ${selectedPart === 'legs' ? 'bg-amber-500/40 border-amber-500' : 'bg-zinc-800 border-zinc-600 hover:border-amber-400'}`}
              onClick={() => handlePartClick('legs')}
              whileHover={{ scale: 1.05 }}
            />

            {/* Right Leg */}
            <motion.div 
              className={`absolute top-60 right-12 w-10 h-44 rounded-full border-2 cursor-pointer transition-colors ${selectedPart === 'legs' ? 'bg-amber-500/40 border-amber-500' : 'bg-zinc-800 border-zinc-600 hover:border-amber-400'}`}
              onClick={() => handlePartClick('legs')}
              whileHover={{ scale: 1.05 }}
            />

            {/* Feet */}
            <motion.div 
              className={`absolute bottom-0 left-10 w-12 h-6 rounded-full border-2 cursor-pointer transition-colors ${selectedPart === 'feet' ? 'bg-rose-500/40 border-rose-500' : 'bg-zinc-800 border-zinc-600 hover:border-rose-400'}`}
              onClick={() => handlePartClick('feet')}
              whileHover={{ scale: 1.05 }}
            />
            <motion.div 
              className={`absolute bottom-0 right-10 w-12 h-6 rounded-full border-2 cursor-pointer transition-colors ${selectedPart === 'feet' ? 'bg-rose-500/40 border-rose-500' : 'bg-zinc-800 border-zinc-600 hover:border-rose-400'}`}
              onClick={() => handlePartClick('feet')}
              whileHover={{ scale: 1.05 }}
            />
          </motion.div>

          {/* Overlay Info */}
          <div className="absolute bottom-6 left-6 bg-black/50 backdrop-blur-md border border-white/10 p-4 rounded-xl max-w-sm pointer-events-none">
            <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2">
              <Search className="w-4 h-4 text-rose-500" />
              Instrucciones
            </h4>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Haz clic en cualquier segmento corporal para visualizar los riesgos asociados, historial de lesiones y el Equipo de Protección Personal (EPP) requerido.
            </p>
          </div>
        </Card>

        {/* Details Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Info className="w-5 h-5 text-rose-500" />
            Detalles del Segmento
          </h2>

          {selectedInfo ? (
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="space-y-6"
            >
              <div>
                <h3 className="text-2xl font-black text-white uppercase tracking-tight">{selectedInfo.name}</h3>
                <div className={`inline-flex items-center gap-1 px-2 py-1 rounded mt-2 text-xs font-bold uppercase tracking-wider ${selectedInfo.risk === 'high' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  <AlertTriangle className="w-3 h-3" />
                  Riesgo {selectedInfo.risk === 'high' ? 'Alto' : 'Medio'}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">EPP Obligatorio</h4>
                <ul className="space-y-2">
                  {selectedInfo.ppe.map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2 p-3 rounded-lg bg-zinc-900 border border-white/5">
                      <ShieldAlert className="w-4 h-4 text-emerald-500" />
                      <span className="text-sm text-white font-medium">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <h4 className="text-xs font-bold text-rose-400 uppercase tracking-widest mb-2">Historial de Lesiones (Faena)</h4>
                <div className="flex items-end gap-2">
                  <span className="text-3xl font-black text-white">
                    {selectedInfo.id === 'arms' ? '12' : selectedInfo.id === 'head' ? '3' : '7'}
                  </span>
                  <span className="text-xs text-zinc-400 mb-1">incidentes este año</span>
                </div>
              </div>

              <Button className="w-full">
                Registrar Nueva Lesión
              </Button>
            </motion.div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
              <Activity className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500">Selecciona una parte del cuerpo en el visor para ver los detalles.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
