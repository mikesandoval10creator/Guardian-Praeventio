import React, { useState } from 'react';
import { designHazmatStorage } from '../../services/geminiService';
import { Building2, ShieldAlert, Loader2, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';

export const HazmatStorageDesigner: React.FC = () => {
  const [storageType, setStorageType] = useState('Bodega Exclusiva');
  const [volume, setVolume] = useState<number | ''>('');
  const [materialClass, setMaterialClass] = useState('Clase 3 (Líquidos Inflamables)');
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleDesign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storageType || !volume || !materialClass) return;

    setIsLoading(true);
    try {
      const response = await designHazmatStorage(storageType, Number(volume), materialClass);
      setResult(response);
    } catch (error) {
      console.error(error);
      setResult('Error al diseñar la instalación. Intente nuevamente.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-slate-800/50 rounded-2xl border border-slate-700/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
          <Building2 className="w-6 h-6 text-orange-400" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-white">Diseñador de Instalaciones (OGUC / DS 43)</h3>
          <p className="text-slate-400 text-sm">Diseño normativo para bodegas de sustancias peligrosas.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div className="space-y-4">
          <form onSubmit={handleDesign} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Tipo de Instalación</label>
              <select
                value={storageType}
                onChange={(e) => setStorageType(e.target.value)}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              >
                <option value="Bodega Exclusiva">Bodega Exclusiva Adyacente</option>
                <option value="Bodega Separada">Bodega Separada (Aislada)</option>
                <option value="Estanque Sobre Superficie">Estanque Sobre Superficie</option>
                <option value="Patio de Almacenamiento">Patio de Almacenamiento Abierto</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Volumen Estimado (Toneladas o Litros)</label>
              <input
                type="number"
                value={volume}
                onChange={(e) => setVolume(e.target.value ? Number(e.target.value) : '')}
                placeholder="Ej: 5000"
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Clase de Sustancia (NCh382)</label>
              <select
                value={materialClass}
                onChange={(e) => setMaterialClass(e.target.value)}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              >
                <option value="Clase 2 (Gases)">Clase 2 (Gases Comprimidos)</option>
                <option value="Clase 3 (Líquidos Inflamables)">Clase 3 (Líquidos Inflamables)</option>
                <option value="Clase 4 (Sólidos Inflamables)">Clase 4 (Sólidos Inflamables)</option>
                <option value="Clase 5 (Sustancias Comburentes)">Clase 5 (Sustancias Comburentes y Peróxidos)</option>
                <option value="Clase 6 (Sustancias Tóxicas)">Clase 6 (Sustancias Tóxicas e Infecciosas)</option>
                <option value="Clase 8 (Sustancias Corrosivas)">Clase 8 (Sustancias Corrosivas)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isLoading || !volume}
              className="w-full bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <ShieldAlert className="w-5 h-5" />
              )}
              {isLoading ? 'Diseñando Instalación...' : 'Generar Diseño Normativo'}
            </button>
          </form>
        </div>

        {/* Results */}
        <div className="bg-slate-900/50 rounded-xl border border-slate-700/50 p-6 overflow-y-auto max-h-[500px] custom-scrollbar">
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4 py-12"
              >
                <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                <p>Analizando OGUC y DS 43...</p>
              </motion.div>
            ) : result ? (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="prose prose-invert prose-orange max-w-none"
              >
                <div className="flex items-center gap-2 mb-4 text-emerald-400 bg-emerald-400/10 px-3 py-2 rounded-lg border border-emerald-400/20 w-fit">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-sm font-medium">Diseño Normativo Generado</span>
                </div>
                <div className="markdown-body text-sm">
                  <ReactMarkdown>{result}</ReactMarkdown>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4 py-12"
              >
                <Building2 className="w-12 h-12 opacity-20" />
                <p className="text-center max-w-xs">
                  Ingresa los parámetros de almacenamiento para generar los requisitos constructivos y de seguridad.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
