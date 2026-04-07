import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Box, Upload, ShieldAlert, Layers, ZoomIn, Maximize, AlertTriangle, FileCode2 } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';

export function AutoCADViewer() {
  const [file, setFile] = useState<File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  const handleUpload = () => {
    setIsParsing(true);
    // Simulate complex DWG parsing
    setTimeout(() => {
      setIsParsing(false);
      setIsLoaded(true);
    }, 4000);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Box className="w-8 h-8 text-cyan-500" />
            Visor AutoCAD (DWG)
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Integración de Planos Estructurales
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-cyan-500 bg-cyan-500/10 border-cyan-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Nivel: Enterprise
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Viewer Area */}
        <Card className="p-0 border-white/5 lg:col-span-2 overflow-hidden relative min-h-[600px] bg-zinc-900 flex items-center justify-center">
          {!isLoaded && !isParsing && (
            <div className="flex flex-col items-center justify-center text-center p-8">
              <FileCode2 className="w-16 h-16 text-zinc-700 mb-4" />
              <h3 className="text-lg font-bold text-white mb-2">Sube un archivo .DWG o .DXF</h3>
              <p className="text-sm text-zinc-500 max-w-md">
                El motor de renderizado procesará los vectores para superponer las capas de riesgo (IPER) directamente sobre los planos arquitectónicos.
              </p>
            </div>
          )}

          {isParsing && (
            <div className="flex flex-col items-center justify-center text-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              >
                <Layers className="w-16 h-16 text-cyan-500 mb-4" />
              </motion.div>
              <p className="text-sm font-bold text-cyan-400 animate-pulse">Parseando vectores y capas CAD...</p>
              <p className="text-xs text-zinc-500 mt-2">Esto puede tomar unos minutos dependiendo de la complejidad.</p>
            </div>
          )}

          {isLoaded && (
            <div className="absolute inset-0 w-full h-full">
              {/* Simulated CAD Viewer */}
              <div className="w-full h-full bg-[#1e1e1e] relative overflow-hidden" style={{ backgroundImage: 'radial-gradient(#333 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
                {/* Simulated blueprint lines */}
                <svg className="w-full h-full opacity-50" viewBox="0 0 800 600">
                  <path d="M100,100 L700,100 L700,500 L100,500 Z" fill="none" stroke="#06b6d4" strokeWidth="2" />
                  <path d="M300,100 L300,500" fill="none" stroke="#06b6d4" strokeWidth="1" strokeDasharray="5,5" />
                  <path d="M100,300 L700,300" fill="none" stroke="#06b6d4" strokeWidth="1" strokeDasharray="5,5" />
                  <rect x="150" y="150" width="100" height="100" fill="none" stroke="#3b82f6" strokeWidth="2" />
                  <rect x="550" y="350" width="100" height="100" fill="none" stroke="#ef4444" strokeWidth="2" />
                  <circle cx="400" cy="300" r="50" fill="none" stroke="#10b981" strokeWidth="2" />
                </svg>

                {/* Controls */}
                <div className="absolute bottom-4 right-4 flex gap-2">
                  <button className="p-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 text-white">
                    <ZoomIn className="w-5 h-5" />
                  </button>
                  <button className="p-2 bg-zinc-800 rounded-lg hover:bg-zinc-700 text-white">
                    <Maximize className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Controls Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Upload className="w-5 h-5 text-cyan-500" />
            Cargar Plano
          </h2>

          <div className="border-2 border-dashed border-zinc-700 hover:border-cyan-500 bg-zinc-900/50 rounded-2xl p-8 text-center transition-colors cursor-pointer">
            <Upload className="w-10 h-10 text-zinc-600 mx-auto mb-3" />
            <p className="text-sm font-bold text-zinc-300">Haz clic para subir archivo</p>
            <p className="text-xs text-zinc-500 mt-1">Soporta .DWG, .DXF (Max 50MB)</p>
          </div>

          <Button 
            className="w-full" 
            onClick={handleUpload} 
            disabled={isParsing || isLoaded}
          >
            Procesar Archivo CAD
          </Button>

          {isLoaded && (
            <div className="space-y-4 pt-4 border-t border-white/5">
              <h3 className="text-sm font-bold text-white">Capas Detectadas</h3>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-900 cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" />
                  <span className="text-sm text-zinc-300">Estructura Principal</span>
                </label>
                <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-900 cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" />
                  <span className="text-sm text-zinc-300">Red Eléctrica</span>
                </label>
                <label className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-900 cursor-pointer">
                  <input type="checkbox" defaultChecked className="rounded border-zinc-700 bg-zinc-900 text-cyan-500 focus:ring-cyan-500" />
                  <span className="text-sm text-zinc-300">Vías de Evacuación</span>
                </label>
              </div>

              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 mt-4">
                <div className="flex gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <p className="text-xs text-amber-400">
                    Se han detectado 3 zonas de conflicto entre la red eléctrica y las vías de evacuación proyectadas.
                  </p>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
