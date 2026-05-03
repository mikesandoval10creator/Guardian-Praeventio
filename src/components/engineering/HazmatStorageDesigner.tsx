import React, { useState, useMemo } from 'react';
import { designHazmatStorage } from '../../services/geminiService';
import { Building2, ShieldAlert, Loader2, CheckCircle2, Wind, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { logger } from '../../utils/logger';
import { venturiFlowRate } from '../../services/physics/bernoulliEngine';

// DS 594 Art. 35 — minimum air changes per hour for chemical storage
const ACH_MIN_DS594 = 12;
const AIR_DENSITY_KG_M3 = 1.225;

const formatEs = (value: number, fractionDigits = 2): string =>
  new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);

export const HazmatStorageDesigner: React.FC = () => {
  const [storageType, setStorageType] = useState('Bodega Exclusiva');
  const [volume, setVolume] = useState<number | ''>('');
  const [materialClass, setMaterialClass] = useState('Clase 3 (Líquidos Inflamables)');
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Venturi (DS 594) extraction parameters
  const [roomVolumeM3, setRoomVolumeM3] = useState<number | ''>(150);
  const [inletAreaA1, setInletAreaA1] = useState<number | ''>(0.4);
  const [throatAreaA2, setThroatAreaA2] = useState<number | ''>(0.1);
  const [deltaPPa, setDeltaPPa] = useState<number | ''>(50);

  const venturiResult = useMemo(() => {
    if (
      roomVolumeM3 === '' || inletAreaA1 === '' || throatAreaA2 === '' || deltaPPa === '' ||
      Number(roomVolumeM3) <= 0 || Number(inletAreaA1) <= 0 || Number(throatAreaA2) <= 0 ||
      Number(deltaPPa) < 0 || Number(inletAreaA1) <= Number(throatAreaA2)
    ) {
      return null;
    }
    try {
      const q = venturiFlowRate(
        Number(inletAreaA1),
        Number(throatAreaA2),
        Number(deltaPPa),
        AIR_DENSITY_KG_M3,
      );
      const ach = (q * 3600) / Number(roomVolumeM3);
      return { q, ach, compliant: ach >= ACH_MIN_DS594 };
    } catch (err) {
      logger.error(err);
      return null;
    }
  }, [roomVolumeM3, inletAreaA1, throatAreaA2, deltaPPa]);

  const handleDesign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storageType || !volume || !materialClass) return;

    setIsLoading(true);
    try {
      const response = await designHazmatStorage(storageType, Number(volume), materialClass);
      setResult(response);
    } catch (error) {
      logger.error(error);
      setResult('Error al diseñar la instalación. Intente nuevamente.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
          <Building2 className="w-6 h-6 text-orange-500 dark:text-orange-400" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">Diseñador de Instalaciones (OGUC / DS 43)</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Diseño normativo para bodegas de sustancias peligrosas.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div className="space-y-4">
          <form onSubmit={handleDesign} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Tipo de Instalación</label>
              <select
                value={storageType}
                onChange={(e) => setStorageType(e.target.value)}
                className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              >
                <option value="Bodega Exclusiva">Bodega Exclusiva Adyacente</option>
                <option value="Bodega Separada">Bodega Separada (Aislada)</option>
                <option value="Estanque Sobre Superficie">Estanque Sobre Superficie</option>
                <option value="Patio de Almacenamiento">Patio de Almacenamiento Abierto</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Volumen Estimado (Toneladas o Litros)</label>
              <input
                type="number"
                value={volume}
                onChange={(e) => setVolume(e.target.value ? Number(e.target.value) : '')}
                placeholder="Ej: 5000"
                className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Clase de Sustancia (NCh382)</label>
              <select
                value={materialClass}
                onChange={(e) => setMaterialClass(e.target.value)}
                className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
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
        <div className="bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-6 overflow-y-auto max-h-[500px] custom-scrollbar">
          <AnimatePresence mode="wait">
            {isLoading ? (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="h-full flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 space-y-4 py-12"
              >
                <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
                <p>Analizando OGUC y DS 43...</p>
              </motion.div>
            ) : result ? (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="prose dark:prose-invert prose-orange max-w-none"
              >
                <div className="flex items-center gap-2 mb-4 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-400/10 px-3 py-2 rounded-lg border border-emerald-500/20 dark:border-emerald-400/20 w-fit">
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

      {/* Venturi extraction (DS 594 Art. 35) — additive Bernoulli engine integration */}
      <div className="mt-6 bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center border border-sky-500/20">
            <Wind className="w-5 h-5 text-sky-500 dark:text-sky-400" />
          </div>
          <div>
            <h4 className="text-lg font-bold text-slate-900 dark:text-white">Ventilación por Venturi (DS 594)</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Cálculo local (Bernoulli) de extracción de aire para bodegas químicas. Ref.: DS 594 Art. 35.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Volumen sala (m³)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={roomVolumeM3}
              onChange={(e) => setRoomVolumeM3(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">A₁ entrada (m²)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={inletAreaA1}
              onChange={(e) => setInletAreaA1(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">A₂ garganta (m²)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={throatAreaA2}
              onChange={(e) => setThroatAreaA2(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">ΔP (Pa)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={deltaPPa}
              onChange={(e) => setDeltaPPa(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white"
            />
          </div>
        </div>

        {venturiResult ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-lg px-3 py-2">
                <p className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-bold">Q extracción</p>
                <p className="text-lg font-black text-slate-900 dark:text-white">
                  {formatEs(venturiResult.q, 4)} <span className="text-xs font-medium text-slate-500">m³/s</span>
                </p>
              </div>
              <div className={`rounded-lg px-3 py-2 border ${
                venturiResult.compliant
                  ? 'bg-emerald-500/10 border-emerald-500/20'
                  : 'bg-rose-500/10 border-rose-500/20'
              }`}>
                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
                  Renovaciones aire / hora (ACH)
                </p>
                <p className={`text-lg font-black ${
                  venturiResult.compliant ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                }`}>
                  {formatEs(venturiResult.ach, 2)}
                </p>
              </div>
            </div>
            {!venturiResult.compliant && (
              <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                <p className="text-xs text-rose-700 dark:text-rose-300">
                  ACH inferior al mínimo de {ACH_MIN_DS594} exigido por DS 594 Art. 35 para almacenamiento químico.
                  Aumentar A₂, ΔP o reducir volumen.
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400 italic">
            Ingresa parámetros válidos (A₁ &gt; A₂, ΔP ≥ 0) para calcular la extracción.
          </p>
        )}
        <p className="mt-3 text-[10px] text-slate-400 dark:text-slate-500">
          Cálculo local mediante ecuación de Bernoulli/Venturi (ρ aire = 1,225 kg/m³). Ref.: DS 594 Art. 35.
        </p>
      </div>
    </div>
  );
};
