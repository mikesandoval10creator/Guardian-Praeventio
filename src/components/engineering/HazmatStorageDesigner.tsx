import React, { useState, useMemo } from 'react';
import { designHazmatStorage } from '../../services/geminiService';
import { Building2, ShieldAlert, Loader2, CheckCircle2, Wind, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import { logger } from '../../utils/logger';
import { venturiFlowRate } from '../../services/physics/bernoulliEngine';
import {
  generateHazmatPipeNode,
  generateMiningExtractionNode,
} from '../../services/zettelkasten/bernoulli';
import { generateMistingNode } from '../../services/zettelkasten/bernoulli/mistingDustSuppression';
import { writeNodesDebounced } from '../../services/zettelkasten/persistence/writeNode';
import { useProject } from '../../contexts/ProjectContext';

// DS 594 Art. 35 — minimum air changes per hour for chemical storage
const ACH_MIN_DS594 = 12;
const AIR_DENSITY_KG_M3 = 1.225;

const formatEs = (value: number, fractionDigits = 2): string =>
  new Intl.NumberFormat('es-CL', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);

const STORAGE_TYPES = ['exclusive_warehouse', 'separated_warehouse', 'surface_tank', 'open_yard'] as const;
const MATERIAL_CLASSES = [
  'class_2_gases',
  'class_3_flammable_liquids',
  'class_4_flammable_solids',
  'class_5_oxidizing',
  'class_6_toxic',
  'class_8_corrosive',
] as const;

export const HazmatStorageDesigner: React.FC = () => {
  const { t } = useTranslation();
  const [storageType, setStorageType] = useState<string>(STORAGE_TYPES[0]);
  const [volume, setVolume] = useState<number | ''>('');
  const [materialClass, setMaterialClass] = useState<string>(MATERIAL_CLASSES[1]);
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Venturi (DS 594) extraction parameters
  const [roomVolumeM3, setRoomVolumeM3] = useState<number | ''>(150);
  const [inletAreaA1, setInletAreaA1] = useState<number | ''>(0.4);
  const [throatAreaA2, setThroatAreaA2] = useState<number | ''>(0.1);
  const [deltaPPa, setDeltaPPa] = useState<number | ''>(50);
  // Bucket B.4 — misting dust suppression (PM10 ambient → recommended nozzles).
  const [pm10UgM3, setPm10UgM3] = useState<number | ''>(80);
  const { selectedProject } = useProject();

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
      // TODO Sprint 10+: replace these console logs with addNode() calls into Firestore
      // via useRiskEngine. For now we surface the Bernoulli-driven Zettelkasten payloads
      // so the integration site is wired and observable in the dev console.
      const miningNode = generateMiningExtractionNode(
        {
          id: `hazmat-room-${storageType}`,
          volumeM3: Number(roomVolumeM3),
          inletAreaM2: Number(inletAreaA1),
          throatAreaM2: Number(throatAreaA2),
          deltaPPa: Number(deltaPPa),
        },
        { sensorId: 'hazmat-co-stub', measuredPpm: 0, oelPpm: 25 },
      );
      const pipeNode = generateHazmatPipeNode(
        { id: 'hazmat-pipe-stub', velocityInMs: 0.5, velocityOutMs: 1.5, heightDeltaM: 0 },
        { id: materialClass, densityKgM3: 870, vaporPressurePa: 10_000 },
        { upstreamPressurePa: 200_000 },
      );
      if (miningNode) logger.info('zettelkasten:mining-extraction', { node: miningNode });
      if (pipeNode) logger.info('zettelkasten:hazmat-pipe', { node: pipeNode });
      // Sprint 11: persistir nodos en zettelkasten_nodes (debounce 2 s).
      // Saltamos limpiamente si no hay proyecto seleccionado.
      const projectId = selectedProject?.id;
      if (projectId) {
        const batch = [miningNode, pipeNode].filter(
          (n): n is NonNullable<typeof n> => Boolean(n),
        );
        if (batch.length > 0) writeNodesDebounced(batch, { projectId });
      }
      return { q, ach, compliant: ach >= ACH_MIN_DS594 };
    } catch (err) {
      logger.error(err);
      return null;
    }
  }, [roomVolumeM3, inletAreaA1, throatAreaA2, deltaPPa, materialClass, storageType, selectedProject?.id]);

  // Bucket B.4 — misting dust suppression: recommend nozzle count from ambient PM10.
  // OEL DS 594 Art. 65 (sílice respirable) ≈ 0.025 mg/m³; trigger generator if PM10 > 50 µg/m³.
  const mistingResult = useMemo(() => {
    const pm10 = Number(pm10UgM3);
    if (!pm10UgM3 || pm10 <= 0) return null;
    // Heuristic: 1 nozzle per 50 m³ of room when PM10 > OEL guidance, +1 every 50 µg/m³.
    const baseNozzles = Math.max(1, Math.ceil(Number(roomVolumeM3 || 150) / 50));
    const extraNozzles = Math.max(0, Math.floor((pm10 - 50) / 50));
    const nozzleCount = baseNozzles + extraNozzles;

    const node = generateMistingNode(
      {
        id: `misting-${storageType}`,
        inletAreaM2: Number(inletAreaA1 || 0.4),
        throatAreaM2: Number(throatAreaA2 || 0.1),
        deltaPPa: Number(deltaPPa || 50),
      },
      { flowRateM3S: 0.0002 * nozzleCount, pressurePa: 300_000 },
      { availableFlowM3S: 0.05 },
    );
    const projectId = selectedProject?.id;
    if (node && projectId) writeNodesDebounced([node], { projectId });
    return { nozzleCount, pm10, exceedsOel: pm10 > 50 };
  }, [pm10UgM3, roomVolumeM3, inletAreaA1, throatAreaA2, deltaPPa, storageType, selectedProject?.id]);

  const handleDesign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storageType || !volume || !materialClass) return;

    setIsLoading(true);
    try {
      // Backend receives the localized labels so the model has concrete
      // descriptions to reason about.
      const response = await designHazmatStorage(
        t(`hazmat_designer.storage_${storageType}`),
        Number(volume),
        t(`hazmat_designer.material_${materialClass}`),
      );
      setResult(response);
    } catch (error) {
      logger.error(error);
      setResult(t('hazmat_designer.error_design'));
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
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t('hazmat_designer.title')}</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm">{t('hazmat_designer.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div className="space-y-4">
          <form onSubmit={handleDesign} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('hazmat_designer.installation_type')}</label>
              <select
                value={storageType}
                onChange={(e) => setStorageType(e.target.value)}
                className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              >
                {STORAGE_TYPES.map((key) => (
                  <option key={key} value={key}>{t(`hazmat_designer.storage_${key}`)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('hazmat_designer.volume_label')}</label>
              <input
                type="number"
                value={volume}
                onChange={(e) => setVolume(e.target.value ? Number(e.target.value) : '')}
                placeholder={t('hazmat_designer.volume_placeholder')}
                className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('hazmat_designer.material_class')}</label>
              <select
                value={materialClass}
                onChange={(e) => setMaterialClass(e.target.value)}
                className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all"
              >
                {MATERIAL_CLASSES.map((key) => (
                  <option key={key} value={key}>{t(`hazmat_designer.material_${key}`)}</option>
                ))}
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
              {isLoading ? t('hazmat_designer.designing') : t('hazmat_designer.generate_btn')}
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
                <p>{t('hazmat_designer.analyzing')}</p>
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
                  <span className="text-sm font-medium">{t('hazmat_designer.generated')}</span>
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
                  {t('hazmat_designer.empty_prompt')}
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
            <h4 className="text-lg font-bold text-slate-900 dark:text-white">{t('hazmat_designer.venturi_title')}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t('hazmat_designer.venturi_subtitle')}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{t('hazmat_designer.room_volume')}</label>
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
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{t('hazmat_designer.inlet_area')}</label>
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
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{t('hazmat_designer.throat_area')}</label>
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
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{t('hazmat_designer.delta_p')}</label>
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
                <p className="text-[10px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-bold">{t('hazmat_designer.q_extraction')}</p>
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
                  {t('hazmat_designer.ach_label')}
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
                  {t('hazmat_designer.ach_warning', { minAch: ACH_MIN_DS594 })}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400 italic">
            {t('hazmat_designer.invalid_params')}
          </p>
        )}
        <p className="mt-3 text-[10px] text-slate-400 dark:text-slate-500">
          {t('hazmat_designer.bernoulli_note')}
        </p>
      </div>

      {/* Bucket B.4 — Misting dust suppression (DS 594 Art. 65, ISO 14644). */}
      <div className="mt-6 bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center border border-cyan-500/20">
            <Wind className="w-5 h-5 text-cyan-500 dark:text-cyan-400" />
          </div>
          <div>
            <h4 className="text-lg font-bold text-slate-900 dark:text-white">Supresión de polvo (misting Venturi)</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Calcula boquillas mister según PM10 ambiente — DS 594 Art. 65, ISO 14644.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">PM10 ambiente (µg/m³)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={pm10UgM3}
              onChange={(e) => setPm10UgM3(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white"
            />
          </div>
          {mistingResult && (
            <div className={`rounded-lg px-3 py-2 border ${
              mistingResult.exceedsOel
                ? 'bg-amber-500/10 border-amber-500/20'
                : 'bg-emerald-500/10 border-emerald-500/20'
            }`}>
              <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
                Boquillas mister recomendadas
              </p>
              <p className={`text-lg font-black ${
                mistingResult.exceedsOel ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
              }`}>
                {mistingResult.nozzleCount}
              </p>
            </div>
          )}
        </div>
        {mistingResult?.exceedsOel && (
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              PM10 supera referencia OEL — activar misting Venturi para captar partículas finas.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
