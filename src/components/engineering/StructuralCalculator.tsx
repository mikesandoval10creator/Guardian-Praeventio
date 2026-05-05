import React, { useMemo, useState } from 'react';
import { calculateStructuralLoad } from '../../services/geminiService';
import { Calculator, Wrench, AlertTriangle, Loader2, CheckCircle2, Wind, Columns3 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import { useTranslation } from 'react-i18next';
import { logger } from '../../utils/logger';
import { windLoadOnSurface, windSpeedKmhToMs } from '../../services/physics/bernoulliEngine';
import { generateScaffoldUpliftNode } from '../../services/zettelkasten/bernoulli';
import { writeNodesDebounced } from '../../services/zettelkasten/persistence/writeNode';
import { useProject } from '../../contexts/ProjectContext';
import {
  calculateCriticalLoad,
  bucklingSafetyFactor,
  rectangularInertia,
  circularSolidInertia,
  circularHollowInertia,
  type EndConditions,
} from '../../services/euler/criticalLoad';

const WIND_PRESSURE_COEFF = 0.8; // Cp windward, según norma chilena NCh 432
const newtonFormatter = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });

// Common Young's modulus presets (Pa) — palette of materials for jobsite columns.
const MATERIAL_PRESETS = [
  { id: 'steel', E: 200e9 },
  { id: 'aluminum', E: 69e9 },
  { id: 'wood', E: 10e9 },
] as const;

const SECTION_TYPES = ['rectangular', 'circular-solid', 'circular-hollow'] as const;
type SectionType = (typeof SECTION_TYPES)[number];

const END_CONDITIONS: readonly EndConditions[] = [
  'pinned-pinned',
  'fixed-fixed',
  'fixed-pinned',
  'fixed-free',
] as const;

// Recommended minimum SF against buckling — DS 594 / OGUC use 2.0 baseline.
const MIN_SAFETY_FACTOR_BUCKLING = 2.0;

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
  // Sprint 25 Bucket NN — scaffold wind suction (NCh 433 / NCh 432).
  const [scaffoldHeightM, setScaffoldHeightM] = useState<number>(12);
  const [scaffoldLateralAreaM2, setScaffoldLateralAreaM2] = useState<number>(40);
  const [gustWindKmh, setGustWindKmh] = useState<number>(120);

  // Pandeo de Euler (P_cr) state
  const [bucklingMaterial, setBucklingMaterial] = useState<(typeof MATERIAL_PRESETS)[number]['id']>('steel');
  const [bucklingSection, setBucklingSection] = useState<SectionType>('rectangular');
  const [bucklingWidth, setBucklingWidth] = useState<number>(0.1); // m
  const [bucklingHeight, setBucklingHeight] = useState<number>(0.1); // m
  const [bucklingDiameter, setBucklingDiameter] = useState<number>(0.05); // m
  const [bucklingOuter, setBucklingOuter] = useState<number>(0.1); // m
  const [bucklingInner, setBucklingInner] = useState<number>(0.08); // m
  const [bucklingLength, setBucklingLength] = useState<number>(2); // m
  const [bucklingEndCond, setBucklingEndCond] = useState<EndConditions>('pinned-pinned');
  const [bucklingApplied, setBucklingApplied] = useState<number>(50_000); // N
  const [bucklingDisplayKN, setBucklingDisplayKN] = useState<boolean>(true);

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

  // Sprint 25 Bucket NN — Succión sobre andamios (NCh 433 / NCh 432).
  const scaffoldSuctionResult = useMemo(() => {
    if (scaffoldHeightM <= 0 || scaffoldLateralAreaM2 <= 0 || gustWindKmh <= 0) return null;
    // Cp succión típico cubierta plana = -1.2; mayor altura → coef. mayor.
    const cp = -1.2 - (scaffoldHeightM > 20 ? 0.2 : 0);
    const node = generateScaffoldUpliftNode(
      { id: `scaffold-h${scaffoldHeightM}`, areaM2: scaffoldLateralAreaM2, pressureCoefficient: cp },
      { windKmh: gustWindKmh },
      { ratedCapacityN: 5_000, anchorCount: Math.max(4, Math.ceil(scaffoldLateralAreaM2 / 10)) },
    );
    // Force horizontal (succión total): F = q · A · |Cp|, con q = 0.5·ρ·v²
    const v = (gustWindKmh * 1000) / 3600;
    const q = 0.5 * 1.225 * v * v;
    const horizontalForceN = q * scaffoldLateralAreaM2 * Math.abs(cp);
    // NCh 433 — exposición B máx 0.55 kN/m² para H<20m (heurística).
    const allowableKnPerM2 = scaffoldHeightM > 20 ? 0.7 : 0.55;
    const compliance = (horizontalForceN / scaffoldLateralAreaM2) / 1000 <= allowableKnPerM2;

    if (node) {
      logger.info('zettelkasten:scaffold-uplift-suction', { node });
      const projectId = selectedProject?.id;
      if (projectId) writeNodesDebounced([node], { projectId });
    }
    return { node, horizontalForceN, compliance, allowableKnPerM2 };
  }, [scaffoldHeightM, scaffoldLateralAreaM2, gustWindKmh, selectedProject?.id]);

  // Euler P_cr — pure-compute, derived per render.
  const bucklingResult = useMemo(() => {
    const preset = MATERIAL_PRESETS.find((m) => m.id === bucklingMaterial)!;
    let I: number;
    if (bucklingSection === 'rectangular') {
      I = rectangularInertia(bucklingWidth, bucklingHeight);
    } else if (bucklingSection === 'circular-solid') {
      I = circularSolidInertia(bucklingDiameter);
    } else {
      I = circularHollowInertia(bucklingOuter, bucklingInner);
    }
    return calculateCriticalLoad({
      youngsModulus: preset.E,
      momentOfInertia: I,
      length: bucklingLength,
      endConditions: bucklingEndCond,
    });
  }, [
    bucklingMaterial,
    bucklingSection,
    bucklingWidth,
    bucklingHeight,
    bucklingDiameter,
    bucklingOuter,
    bucklingInner,
    bucklingLength,
    bucklingEndCond,
  ]);
  const bucklingSF = bucklingSafetyFactor(bucklingResult.criticalLoad, bucklingApplied);
  const bucklingPcrValid = Number.isFinite(bucklingResult.criticalLoad);
  const bucklingUnsafe = bucklingPcrValid && Number.isFinite(bucklingSF) && bucklingSF < MIN_SAFETY_FACTOR_BUCKLING;

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

      {/* Sprint 25 Bucket NN — Succión viento sobre andamios (NCh 433). */}
      <div className="mt-6 bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
            <Wind className="w-5 h-5 text-amber-500 dark:text-amber-400" />
          </div>
          <div>
            <h4 className="text-lg font-bold text-slate-900 dark:text-white">Succión viento sobre andamios</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">NCh 433 · NCh 432 Of.71 · DS 594 Art. 78.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Altura andamio (m)</label>
            <input type="number" min="0" step="0.5" value={scaffoldHeightM}
              onChange={(e) => setScaffoldHeightM(Number(e.target.value) || 0)}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Área lateral (m²)</label>
            <input type="number" min="0" step="any" value={scaffoldLateralAreaM2}
              onChange={(e) => setScaffoldLateralAreaM2(Number(e.target.value) || 0)}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">v ráfaga (km/h)</label>
            <input type="number" min="0" step="any" value={gustWindKmh}
              onChange={(e) => setGustWindKmh(Number(e.target.value) || 0)}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white" />
          </div>
        </div>

        {scaffoldSuctionResult && (
          <div className={`rounded-lg px-3 py-2 border ${
            scaffoldSuctionResult.compliance
              ? 'bg-emerald-500/10 border-emerald-500/20'
              : 'bg-rose-500/10 border-rose-500/20'
          }`}>
            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
              Fuerza horizontal · Cumplimiento NCh 433
            </p>
            <p className={`text-lg font-black ${
              scaffoldSuctionResult.compliance
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}>
              {(scaffoldSuctionResult.horizontalForceN / 1000).toFixed(2)} kN ·{' '}
              {scaffoldSuctionResult.compliance ? `≤ ${scaffoldSuctionResult.allowableKnPerM2} kN/m² OK` : 'EXCEDE'}
            </p>
          </div>
        )}
      </div>

      {/* Pandeo de Euler (P_cr) — additive section */}
      <div className="mt-6 bg-white dark:bg-slate-900/50 rounded-xl border border-slate-200 dark:border-slate-700/50 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center border border-teal-500/20">
            <Columns3 className="w-5 h-5 text-teal-500 dark:text-teal-400" />
          </div>
          <div>
            <h4 className="text-lg font-bold text-slate-900 dark:text-white">{t('structural_calc.buckling.title', 'Pandeo de Euler (P_cr)')}</h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('structural_calc.buckling.subtitle', 'Estabilidad elástica de columnas: andamios, puntales y estructuras provisionales.')}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.buckling.material_label', 'Material')}</label>
            <select
              value={bucklingMaterial}
              onChange={(e) => setBucklingMaterial(e.target.value as (typeof MATERIAL_PRESETS)[number]['id'])}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
            >
              {MATERIAL_PRESETS.map((m) => (
                <option key={m.id} value={m.id}>
                  {t(`structural_calc.buckling.material_${m.id}`, m.id)} (E = {(m.E / 1e9).toFixed(0)} GPa)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.buckling.end_cond_label', 'Condiciones de borde')}</label>
            <select
              value={bucklingEndCond}
              onChange={(e) => setBucklingEndCond(e.target.value as EndConditions)}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
            >
              {END_CONDITIONS.map((ec) => (
                <option key={ec} value={ec}>
                  {t(`structural_calc.buckling.end_${ec}`, ec)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.buckling.section_label', 'Sección')}</label>
            <select
              value={bucklingSection}
              onChange={(e) => setBucklingSection(e.target.value as SectionType)}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
            >
              {SECTION_TYPES.map((s) => (
                <option key={s} value={s}>
                  {t(`structural_calc.buckling.section_${s}`, s)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.buckling.length_label', 'Longitud sin arriostrar L (m)')}</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={bucklingLength}
              onChange={(e) => setBucklingLength(Number(e.target.value) || 0)}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
            />
          </div>

          {bucklingSection === 'rectangular' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.buckling.width_label', 'Ancho b (m)')}</label>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={bucklingWidth}
                  onChange={(e) => setBucklingWidth(Number(e.target.value) || 0)}
                  className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.buckling.height_label', 'Alto h (m)')}</label>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={bucklingHeight}
                  onChange={(e) => setBucklingHeight(Number(e.target.value) || 0)}
                  className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                />
              </div>
            </>
          )}

          {bucklingSection === 'circular-solid' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.buckling.diameter_label', 'Diámetro d (m)')}</label>
              <input
                type="number"
                min={0}
                step="0.001"
                value={bucklingDiameter}
                onChange={(e) => setBucklingDiameter(Number(e.target.value) || 0)}
                className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
              />
            </div>
          )}

          {bucklingSection === 'circular-hollow' && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.buckling.outer_label', 'Diámetro exterior (m)')}</label>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={bucklingOuter}
                  onChange={(e) => setBucklingOuter(Number(e.target.value) || 0)}
                  className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.buckling.inner_label', 'Diámetro interior (m)')}</label>
                <input
                  type="number"
                  min={0}
                  step="0.001"
                  value={bucklingInner}
                  onChange={(e) => setBucklingInner(Number(e.target.value) || 0)}
                  className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('structural_calc.buckling.applied_label', 'Carga aplicada (N)')}</label>
            <input
              type="number"
              min={0}
              step="100"
              value={bucklingApplied}
              onChange={(e) => setBucklingApplied(Number(e.target.value) || 0)}
              className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-slate-900 dark:text-white focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3 bg-teal-500/5 dark:bg-teal-400/10 border border-teal-500/20 dark:border-teal-400/20 rounded-xl p-4">
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {t('structural_calc.buckling.pcr_label', 'Carga crítica P_cr')} (K = {bucklingResult.K})
            </span>
            <span className="text-2xl font-bold text-teal-600 dark:text-teal-400">
              {bucklingPcrValid
                ? bucklingDisplayKN
                  ? `${(bucklingResult.criticalLoad / 1000).toFixed(2)} kN`
                  : `${newtonFormatter.format(bucklingResult.criticalLoad)} N`
                : '—'}
            </span>
            <button
              type="button"
              onClick={() => setBucklingDisplayKN((prev) => !prev)}
              className="mt-1 text-[11px] text-teal-700 dark:text-teal-300 hover:underline self-start"
            >
              {t('structural_calc.buckling.toggle_units', 'Cambiar unidades (N ↔ kN)')}
            </button>
          </div>
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 dark:text-slate-400">{t('structural_calc.buckling.sf_label', 'Factor de seguridad SF = P_cr / P_aplicada')}</span>
            <span className={`text-2xl font-bold ${bucklingUnsafe ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {bucklingPcrValid && Number.isFinite(bucklingSF)
                ? bucklingSF.toFixed(2)
                : bucklingPcrValid && bucklingSF === Number.POSITIVE_INFINITY
                ? '∞'
                : '—'}
            </span>
          </div>
        </div>

        {bucklingUnsafe && (
          <div className="mt-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-200/80 leading-relaxed">
              <strong>{t('structural_calc.buckling.warning_title', 'Advertencia de pandeo:')}</strong>{' '}
              {t('structural_calc.buckling.warning_body', 'El factor de seguridad está por debajo del mínimo recomendado de 2.0. Revisar dimensiones, arriostramiento o reducir carga.')}
            </p>
          </div>
        )}

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {t('structural_calc.buckling.note', 'P_cr = π²·E·I / (K·L)². Modelo elástico ideal (Euler 1744). No aplica para imperfecciones grandes ni régimen inelástico.')}
        </p>
      </div>
    </div>
  );
};
