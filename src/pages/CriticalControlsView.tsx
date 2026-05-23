// Praeventio Guard — Sprint K vidas críticas wire UI (2026-05-22).
//
// Page `/critical-controls`. Service `criticalControlsLibrary.ts`
// (CRITICAL_CONTROLS_LIBRARY catálogo + validatePreTask) + card
// `BarrierAnalysisCard` existían sin page consumidor. Aquí se wire.
//
// UX: el supervisor elige una `riskCategory` (altura / electric /
// confinado / caliente / quimico), revisa los controles del catálogo,
// marca cuáles están presentes en terreno (válida en vivo Firestore),
// y ve el resultado de `validatePreTask` + análisis de barreras (HCA).

import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Shield,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Filter,
} from 'lucide-react';

import { useFirebase } from '../contexts/FirebaseContext';
import { useProject } from '../contexts/ProjectContext';
import { BarrierAnalysisCard } from '../components/criticalControls/BarrierAnalysisCard';
import {
  CRITICAL_CONTROLS_LIBRARY,
  getControlsForRisk,
  validatePreTask,
  type CriticalControl,
  type ControlValidation,
} from '../services/criticalControls/criticalControlsLibrary';
import {
  saveControlValidation,
  subscribeControlValidations,
} from '../services/criticalControls/controlValidationsStore';
import { logger } from '../utils/logger';

const RISK_CATEGORIES: Array<{ id: string; label: string }> = [
  { id: 'altura', label: 'Trabajo en altura' },
  { id: 'electric', label: 'Riesgo eléctrico' },
  { id: 'confinado', label: 'Espacio confinado' },
  { id: 'caliente', label: 'Trabajo en caliente' },
  { id: 'quimico', label: 'Productos químicos / Hazmat' },
];

const LEVEL_LABELS: Record<string, string> = {
  elimination: 'Eliminación',
  substitution: 'Sustitución',
  engineering: 'Ingeniería',
  administrative: 'Administrativo',
  epp: 'EPP',
};

export function CriticalControlsView() {
  const { user } = useFirebase();
  const { selectedProject } = useProject();

  const [riskCategory, setRiskCategory] = useState<string>('altura');
  const [validations, setValidations] = useState<ControlValidation[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingControlId, setSavingControlId] = useState<string | null>(null);

  useEffect(() => {
    const projectId = selectedProject?.id;
    if (!projectId) {
      setValidations([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const unsub = subscribeControlValidations(
      projectId,
      (list) => {
        setValidations(list);
        setLoading(false);
      },
      (err) => {
        logger.warn('control_validations_sub_error', { err: String(err) });
        setLoading(false);
      },
    );
    return () => unsub();
  }, [selectedProject?.id]);

  const controlsForCategory: CriticalControl[] = useMemo(
    () => getControlsForRisk(riskCategory),
    [riskCategory],
  );

  // Solo las validaciones aplicables a esta categoría (filtramos por
  // controlId que existe en CRITICAL_CONTROLS_LIBRARY[riskCategory]).
  const validationsForCategory = useMemo(() => {
    const ids = new Set(controlsForCategory.map((c) => c.id));
    return validations.filter((v) => ids.has(v.controlId));
  }, [validations, controlsForCategory]);

  const preTaskResult = useMemo(
    () =>
      user
        ? validatePreTask(riskCategory, validationsForCategory, user.uid)
        : null,
    [riskCategory, validationsForCategory, user],
  );

  const togglePresence = useCallback(
    async (control: CriticalControl) => {
      if (!user || !selectedProject) return;
      const existing = validationsForCategory.find((v) => v.controlId === control.id);
      const newPresent = !existing?.present;
      const validation: ControlValidation = {
        controlId: control.id,
        present: newPresent,
        validatedByUid: user.uid,
        validatedAt: new Date().toISOString(),
      };
      setSavingControlId(control.id);
      try {
        await saveControlValidation(selectedProject.id, 'project', validation);
      } catch (err) {
        logger.warn('saveControlValidation failed', { err: String(err) });
      } finally {
        setSavingControlId(null);
      }
    },
    [user, selectedProject, validationsForCategory],
  );

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header>
          <h1 className="text-2xl font-black text-zinc-900 dark:text-white tracking-tight flex items-center gap-2">
            <Shield className="w-6 h-6 text-emerald-500" /> Controles críticos por riesgo
          </h1>
          <p className="text-xs text-zinc-500 mt-1 max-w-2xl">
            Catálogo HCA (Hierarchy of Controls) ISO 45001 § 8.1.2. Marca los controles
            presentes en terreno; el sistema valida cobertura + balance jerárquico antes
            de autorizar inicio de tarea.
          </p>
        </header>

        {/* Selector de categoría de riesgo. */}
        <section className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-4">
          <div className="flex items-center gap-2 mb-3 text-xs font-black text-zinc-500 uppercase tracking-widest">
            <Filter className="w-3.5 h-3.5" />
            Tipo de riesgo
          </div>
          <div className="flex flex-wrap gap-2">
            {RISK_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setRiskCategory(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  riskCategory === cat.id
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </section>

        {!selectedProject ? (
          <div className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-6 text-center text-sm text-zinc-500">
            Seleccioná un proyecto para registrar validaciones.
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-16 text-zinc-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          <>
            {/* Análisis de barreras (HCA) por categoría. */}
            <BarrierAnalysisCard
              riskCategory={riskCategory}
              catalog={CRITICAL_CONTROLS_LIBRARY}
              validations={validationsForCategory}
            />

            {/* Resultado pre-task. */}
            {preTaskResult && (
              <section
                className={`rounded-2xl border p-4 space-y-2 ${
                  preTaskResult.authorizedToStart
                    ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700'
                    : 'border-rose-300 bg-rose-50 dark:bg-rose-900/20 dark:border-rose-700'
                }`}
              >
                <header className="flex items-center justify-between">
                  <h2 className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                    {preTaskResult.authorizedToStart ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span className="text-emerald-700 dark:text-emerald-300">Autorizado para iniciar</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4 text-rose-600" />
                        <span className="text-rose-700 dark:text-rose-300">NO autorizado</span>
                      </>
                    )}
                  </h2>
                  <span className="text-xs font-mono">
                    {preTaskResult.controlsPresent}/{preTaskResult.controlsRequired} · {preTaskResult.coveragePercent}%
                  </span>
                </header>
                {!preTaskResult.isHierarchyBalanced && (
                  <p className="text-xs text-rose-700 dark:text-rose-300">
                    Jerarquía desequilibrada: solo se reportan controles de bajo nivel (EPP).
                    Sumá controles de ingeniería o eliminación antes de iniciar.
                  </p>
                )}
                {preTaskResult.missing.length > 0 && (
                  <div className="text-xs text-zinc-700 dark:text-zinc-300">
                    <strong>Faltantes:</strong>
                    <ul className="mt-1 space-y-0.5 ml-4 list-disc">
                      {preTaskResult.missing.map((m) => (
                        <li key={m.id}>
                          {m.label} <span className="text-zinc-500">({LEVEL_LABELS[m.level] ?? m.level})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}

            {/* Tabla de controles del catálogo con toggle de presencia. */}
            <section className="rounded-2xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-zinc-900/60 p-4 space-y-2">
              <h2 className="text-xs font-black text-zinc-500 uppercase tracking-widest mb-2">
                Catálogo HCA — {RISK_CATEGORIES.find((c) => c.id === riskCategory)?.label}
              </h2>
              <ul className="space-y-1">
                {controlsForCategory.map((control) => {
                  const validation = validationsForCategory.find((v) => v.controlId === control.id);
                  const isPresent = validation?.present === true;
                  return (
                    <li
                      key={control.id}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-white/5"
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-bold ${isPresent ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-700 dark:text-zinc-300'}`}>
                          {isPresent ? '✓ ' : '○ '}{control.label}
                        </p>
                        <p className="text-[10px] text-zinc-500 mt-0.5">
                          {LEVEL_LABELS[control.level] ?? control.level} · {control.verificationMethod}
                          {control.normReference ? ` · ${control.normReference}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => togglePresence(control)}
                        disabled={savingControlId === control.id}
                        className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${
                          isPresent
                            ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                            : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600'
                        } disabled:opacity-50 transition-colors min-w-[88px]`}
                      >
                        {savingControlId === control.id ? (
                          <Loader2 className="w-3 h-3 animate-spin mx-auto" />
                        ) : isPresent ? (
                          'Presente'
                        ) : (
                          'Marcar'
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

export default CriticalControlsView;
