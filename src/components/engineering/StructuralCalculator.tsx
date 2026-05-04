import React, { useState } from 'react';
import { calculateStructuralLoad } from '../../services/geminiService';
import { Calculator, Wrench, AlertTriangle, Loader2, CheckCircle2, Wind } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import { logger } from '../../utils/logger';
import { windLoadOnSurface, windSpeedKmhToMs } from '../../services/physics/bernoulliEngine';
import { generateScaffoldUpliftNode } from '../../services/zettelkasten/bernoulli';
import { writeNodesDebounced } from '../../services/zettelkasten/persistence/writeNode';
import { useProject } from '../../contexts/ProjectContext';

const WIND_PRESSURE_COEFF = 0.8; // Cp windward, según norma chilena NCh 432
const newtonFormatter = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

// Element type values map to backend keys; labels are localized at render time.
const ELEMENT_TYPES = [
  'bolt',
  'sling',
  'scaffold',
  'lifeline',
] as const;

export const StructuralCalculator: React.FC = () => {
  const { t } = useTranslation();
  const [element, setElement] = useState<string>(ELEMENT_TYPES[0]);
  const [specs, setSpecs] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [windAreaM2, setWindAreaM2] = useState<number>(20);
  const [windSpeedKmh, setWindSpeedKmh] = useState<number>(90);
  const { selectedProject } = useProject();

  const windForceN = windLoadOnSurface(
    windAreaM2,
    windSpeedKmhToMs(windSpeedKmh),
    WIND_PRESSURE_COEFF,
  );

  // TODO Sprint 10+: replace this console emission with addNode() into Firestore via
  // useRiskEngine. For now we wire the Bernoulli-driven scaffold-uplift generator so
  // its output is observable in the engineer's dev console.
  const scaffoldUpliftNode = generateScaffoldUpliftNode(
    { id: 'structural-surface', areaM2: windAreaM2, pressureCoefficient: -1.0 },
    { windKmh: windSpeedKmh },
    { ratedCapacityN: 5_000, anchorCount: 4 },
  );
  if (scaffoldUpliftNode) {
    logger.info('zettelkasten:scaffold-uplift', { node: scaffoldUpliftNode });
    // Sprint 11: persistencia debounceada (2 s). Sin proyecto, no escribimos.
    const projectId = selectedProject?.id;
    if (projectId) writeNodesDebounced([scaffoldUpliftNode], { projectId });
  }

  const handleCalculate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!element || !specs) return;

    setIsLoading(true);
    try {
      // Send the localized label to the backend so the model receives a
      // concrete element description (it never sees the internal key).
      const response = await calculateStructuralLoad(t(`structural_calc.element_${element}`), specs);
      setResult(response);
    } catch (error) {
      logger.error(error);
      setResult(t('structural_calc.error_calculate'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700/50 p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
          <Calculator className="w-6 h-6 text-indigo-500 dark:text-indigo-400" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t('structural_calc.title')}</h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm">{t('structural_calc.subtitle')}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div className="space-y-4">
          <form onSubmit={handleCalculate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.element_type')}</label>
              <select
                value={element}
                onChange={(e) => setElement(e.target.value)}
                className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              >
                {ELEMENT_TYPES.map((key) => (
                  <option key={key} value={key}>{t(`structural_calc.element_${key}`)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.specs_label')}</label>
              <textarea
                value={specs}
                onChange={(e) => setSpecs(e.target.value)}
                placeholder={t('structural_calc.specs_placeholder')}
                className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all h-32 resize-none"
                required
              />
            </div>

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-200/80 leading-relaxed">
                <strong>{t('structural_calc.safety_warning_title')}</strong> {t('structural_calc.safety_warning_body')}
              </p>
            </div>

            <button
              type="submit"
              disabled={isLoading || !specs}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Wrench className="w-5 h-5" />
              )}
              {isLoading ? t('structural_calc.calculating') : t('structural_calc.calculate_btn')}
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
                <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                <p>{t('structural_calc.consulting')}</p>
              </motion.div>
            ) : result ? (
              <motion.div
                key="result"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="prose dark:prose-invert prose-indigo max-w-none"
              >
                <div className="flex items-center gap-2 mb-4 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 dark:bg-emerald-400/10 px-3 py-2 rounded-lg border border-emerald-500/20 dark:border-emerald-400/20 w-fit">
                  <CheckCircle2 className="w-5 h-5" />
                  <span className="text-sm font-medium">{t('structural_calc.completed')}</span>
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
                <Calculator className="w-12 h-12 opacity-20" />
                <p className="text-center max-w-xs">
                  {t('structural_calc.empty_prompt')}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Wind load (Bernoulli) — additive section */}
      <div className="mt-6 bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 flex items-center justify-center border border-sky-500/20">
            <Wind className="w-5 h-5 text-sky-500 dark:text-sky-400" />
          </div>
          <div>
            <h4 className="text-lg font-bold text-slate-900 dark:text-white">{t('structural_calc.wind_title')}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('structural_calc.wind_subtitle')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.area_label')}</label>
            <input
              type="number"
              min={0}
              step="0.1"
              value={windAreaM2}
              onChange={(e) => setWindAreaM2(Number(e.target.value) || 0)}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.wind_speed_label')}</label>
            <input
              type="number"
              min={0}
              step="1"
              value={windSpeedKmh}
              onChange={(e) => setWindSpeedKmh(Number(e.target.value) || 0)}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
            />
          </div>
          <div className="flex flex-col justify-center">
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('structural_calc.estimated_force', { coeff: WIND_PRESSURE_COEFF })}</span>
            <span className="text-2xl font-bold text-sky-600 dark:text-sky-400">
              {newtonFormatter.format(windForceN)} N
            </span>
          </div>
        </div>

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {t('structural_calc.local_calc_note')}
        </p>
      </div>
    </div>
  );
};
