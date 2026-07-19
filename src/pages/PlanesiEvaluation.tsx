// Praeventio Guard — PLANESI management page (B-protocols, módulo sílice).
//
// Gives the prevencionista a full in-app workflow over the pure engine
// `src/services/protocols/planesi.ts` (exposición a sílice cristalina
// respirable — DS 594 Art. 66 + protocolo de vigilancia sílice MINSAL
// Res. Ex. 268/2015): measurement form → server-side compute (stateless
// preview) → audited persistence into `protocol_assessments` → per-project
// history.
//
// ADR 0012: this page evaluates ENVIRONMENTAL silica exposure per the MINSAL
// protocol; it never renders a clinical judgment (no Rx-tórax / espirometría
// interpretation). The output is the surveillance periodicity the protocol
// mandates — the health qualification belongs to the médico del organismo
// administrador.
//
// TODO(next-sprint): VigilanciaScheduler (src/components/medicine/) sources
// from legal-calendar obligations (kind 'medical_exam'), not from
// protocol_assessments — feeding the persisted exposureGrade into the
// Rx-tórax due-date calendar requires generating a LegalObligation from the
// assessment (a write flow, not a small read). Left out of this PR by design.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Wind,
  Loader2,
  Save,
  Scale,
  History,
  AlertTriangle,
  Stethoscope,
  CalendarClock,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import type { PlanesiInput, PlanesiResult, SilicaType } from '../services/protocols/planesi';
import {
  evaluatePlanesiRemote,
  recordPlanesiAssessment,
  listProtocolAssessments,
  type ProtocolAssessment,
} from '../hooks/useProtocols';
import { humanErrorMessage } from '../lib/humanError';


// Badge styling keyed by Grado de Exposición (Tabla 7-1; 0 = bajo 50% LPP).
const GRADE_BADGE: Record<PlanesiResult['exposureGrade'], string> = {
  0: 'bg-emerald-500/10 text-emerald-500',
  1: 'bg-amber-500/10 text-amber-500',
  2: 'bg-orange-500/10 text-orange-500',
  3: 'bg-rose-500/10 text-rose-500',
};

const SILICA_TYPES: SilicaType[] = ['cuarzo', 'cristobalita', 'tridimita'];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-CL');
}

function formatNumber(n: number, decimals = 1): string {
  return n.toLocaleString('es-CL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

export function PlanesiEvaluation() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();

  const [taskName, setTaskName] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [concentration, setConcentration] = useState('0,05');
  const [hoursPerDay, setHoursPerDay] = useState('8');
  const [weeklyHours, setWeeklyHours] = useState('');
  const [silicaType, setSilicaType] = useState<SilicaType>('cuarzo');
  const [criticalTask, setCriticalTask] = useState(false);

  const [result, setResult] = useState<PlanesiResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<ProtocolAssessment[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const projectId = selectedProject?.id ?? null;

  const refreshHistory = useCallback(async () => {
    if (!projectId) return;
    setHistoryLoading(true);
    try {
      const { assessments } = await listProtocolAssessments(projectId, 'PLANESI');
      setHistory(assessments);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  if (!selectedProject) {
    return (
      <div className="p-8 max-w-3xl mx-auto" data-testid="planesi-page-empty">
        <p className="text-muted-token text-sm">
          {t('protocols_minsal.select_project', 'Selecciona un proyecto para gestionar el protocolo.')}
        </p>
      </div>
    );
  }

  // Chilean decimal comma is accepted in the concentration field.
  const parseInput = (): PlanesiInput | null => {
    const conc = Number(concentration.replace(',', '.'));
    const hours = Number(hoursPerDay.replace(',', '.'));
    const weekly = weeklyHours.trim() === '' ? undefined : Number(weeklyHours.replace(',', '.'));
    if (
      !Number.isFinite(conc) ||
      conc < 0 ||
      !Number.isFinite(hours) ||
      hours < 0 ||
      hours > 24 ||
      (weekly !== undefined && (!Number.isFinite(weekly) || weekly <= 0 || weekly > 168))
    ) {
      return null;
    }
    return {
      concentrationMgM3: conc,
      exposureHoursPerDay: hours,
      ...(weekly !== undefined ? { weeklyHours: weekly } : {}),
      silicaType,
      ...(criticalTask ? { criticalSilicaTask: true } : {}),
    };
  };

  const onFieldChange = <T,>(setter: (v: T) => void) => (value: T) => {
    setResult(null);
    setStatus(null);
    setter(value);
  };

  const handleCalculate = async () => {
    setError(null);
    setStatus(null);
    const input = parseInput();
    if (!input) {
      setError(t('planesi.input_required', 'Revisa la concentración y las horas de exposición.'));
      return;
    }
    setCalculating(true);
    try {
      const { result: r } = await evaluatePlanesiRemote(selectedProject.id, { input });
      setResult(r);
    } catch {
      setError(t('protocols_minsal.calc_error', 'No se pudo calcular. Revisa los datos ingresados.'));
    } finally {
      setCalculating(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    setStatus(null);
    if (!taskName.trim()) {
      setError(t('protocols_minsal.task_required', 'Ingresa el puesto de trabajo o tarea evaluada.'));
      return;
    }
    const input = parseInput();
    if (!input) {
      setError(t('planesi.input_required', 'Revisa la concentración y las horas de exposición.'));
      return;
    }
    setSaving(true);
    try {
      await recordPlanesiAssessment(selectedProject.id, {
        input,
        taskName: taskName.trim(),
        ...(workerId.trim() ? { workerId: workerId.trim() } : {}),
      });
      setStatus(t('protocols_minsal.saved', 'Evaluación guardada en el historial del proyecto.'));
      await refreshHistory();
    } catch {
      setError(t('protocols_minsal.save_error', 'No se pudo guardar la evaluación. Reintenta.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6" data-testid="planesi-page">
      <div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight flex items-center gap-3">
          <Wind className="w-8 h-8 text-orange-400" />
          {t('planesi.title', 'PLANESI')}
        </h1>
        <p className="text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] mt-2">
          {t('planesi.subtitle', 'Sílice cristalina respirable — D.S. 594 Art. 66 + protocolo MINSAL')}
        </p>
      </div>

      {/* ADR 0012 — exposure evaluation, never a diagnosis. */}
      <div
        role="note"
        aria-label="Aviso protocolo MINSAL"
        data-testid="protocols-disclaimer"
        className="bg-teal-50/10 border border-teal-500/20 rounded-xl p-3 flex items-start gap-2"
      >
        <Stethoscope className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-teal-200/80 leading-relaxed">
          {t('protocols_minsal.disclaimer')}
        </p>
      </div>

      <div
        data-testid="planesi-legal-frame"
        className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 flex items-start gap-3"
      >
        <Scale className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-orange-200/90 leading-relaxed">{t('planesi.legal_frame')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-surface border border-default-token rounded-2xl p-4 sm:p-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-xs font-bold text-secondary-token uppercase tracking-widest">
                  {t('protocols_minsal.task_label', 'Puesto de trabajo / tarea evaluada')}
                </span>
                <input
                  type="text"
                  data-testid="planesi-task-input"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder={t('planesi.task_placeholder', 'Ej: Perforación frente 3')}
                  className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2.5 px-3 text-sm text-primary-token placeholder:text-muted-token focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-secondary-token uppercase tracking-widest">
                  {t('protocols_minsal.worker_label', 'Trabajador o GES (opcional)')}
                </span>
                <input
                  type="text"
                  data-testid="planesi-worker-input"
                  value={workerId}
                  onChange={(e) => setWorkerId(e.target.value)}
                  placeholder={t('protocols_minsal.worker_placeholder', 'ID del trabajador o grupo de exposición similar')}
                  className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2.5 px-3 text-sm text-primary-token placeholder:text-muted-token focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
              </label>
            </div>

            <h3 className="text-sm font-bold text-primary-token pt-2">
              {t('planesi.measurement_title', 'Medición ambiental (muestreo personal)')}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="text-[10px] font-bold text-muted-token uppercase tracking-widest">
                  {t('planesi.concentration', 'Concentración medida (mg/m³)')}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  data-testid="planesi-concentration-input"
                  value={concentration}
                  onChange={(e) => onFieldChange(setConcentration)(e.target.value)}
                  className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2 px-3 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold text-muted-token uppercase tracking-widest">
                  {t('planesi.silica_type', 'Tipo de sílice cristalizada')}
                </span>
                <select
                  data-testid="planesi-silica-type-select"
                  value={silicaType}
                  onChange={(e) => onFieldChange(setSilicaType)(e.target.value as SilicaType)}
                  className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2 px-3 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                >
                  {SILICA_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {t(`planesi.silica_${s}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] font-bold text-muted-token uppercase tracking-widest">
                  {t('planesi.hours_per_day', 'Horas de exposición por día')}
                </span>
                <input
                  type="number"
                  min={0}
                  max={24}
                  step={0.5}
                  data-testid="planesi-hours-input"
                  value={hoursPerDay}
                  onChange={(e) => onFieldChange(setHoursPerDay)(e.target.value)}
                  className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2 px-3 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold text-muted-token uppercase tracking-widest">
                  {t('planesi.weekly_hours', 'Jornada semanal en horas (opcional)')}
                </span>
                <input
                  type="number"
                  min={1}
                  max={168}
                  step={1}
                  data-testid="planesi-weekly-input"
                  value={weeklyHours}
                  onChange={(e) => onFieldChange(setWeeklyHours)(e.target.value)}
                  placeholder={t('planesi.weekly_placeholder', 'Ej: 48 — aplica Fj = 0,90')}
                  className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2 px-3 text-sm text-primary-token placeholder:text-muted-token focus:outline-none focus:ring-2 focus:ring-orange-500/50"
                />
              </label>
            </div>

            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                data-testid="planesi-critical-checkbox"
                checked={criticalTask}
                onChange={(e) => onFieldChange(setCriticalTask)(e.target.checked)}
                className="mt-0.5 accent-orange-500"
              />
              <span className="text-xs text-secondary-token leading-relaxed">
                {t('planesi.critical_task', 'Tarea de exposición aguda: limpieza abrasiva con chorro de arena u operación de chancador de cuarzo (control anual, Tabla 7-1 nota 1)')}
              </span>
            </label>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                data-testid="planesi-calculate-btn"
                onClick={handleCalculate}
                disabled={calculating}
                className="flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-zinc-950 px-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
              >
                {calculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
                {t('protocols_minsal.calculate', 'Calcular')}
              </button>
              <button
                type="button"
                data-testid="planesi-save-btn"
                onClick={handleSave}
                disabled={saving || !result}
                className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {saving
                  ? t('protocols_minsal.saving', 'Guardando…')
                  : t('protocols_minsal.save', 'Guardar evaluación')}
              </button>
            </div>

            {status && (
              <p data-testid="planesi-status" className="text-xs text-emerald-400">{status}</p>
            )}
            {error && (
              <p data-testid="planesi-error" className="text-xs text-rose-400">{humanErrorMessage(error)}</p>
            )}
          </div>

          {/* Result */}
          {result && (
            <div data-testid="planesi-result" className="bg-surface border border-default-token rounded-2xl p-4 sm:p-6 space-y-3">
              <h3 className="text-sm font-bold text-primary-token">
                {t('protocols_minsal.result_title', 'Resultado')}
              </h3>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  data-testid="planesi-grade-badge"
                  className={`inline-block text-xs font-black px-3 py-1.5 rounded-lg ${GRADE_BADGE[result.exposureGrade]}`}
                >
                  {t(`planesi.grade_${result.exposureGrade}`)}
                </span>
                <span className="text-xs text-secondary-token">
                  <span className="font-bold">{t('planesi.percent_lpp', '% del LPP corregido')}:</span>{' '}
                  {formatNumber(result.percentOfLpp)}%
                </span>
                <span className="text-xs text-secondary-token">
                  <span className="font-bold">{t('planesi.corrected_lpp', 'LPP corregido')}:</span>{' '}
                  {formatNumber(result.correctedLppMgM3, 4)} mg/m³
                </span>
                {result.jornadaFactor !== 1 && (
                  <span className="text-xs text-muted-token">
                    Fj = {formatNumber(result.jornadaFactor, 2)}
                  </span>
                )}
              </div>

              <p
                data-testid="planesi-legal-limit"
                className={`flex items-start gap-2 text-xs rounded-lg p-3 border ${
                  result.exceedsLegalLimit
                    ? 'text-rose-300 bg-rose-500/10 border-rose-500/20'
                    : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                }`}
              >
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                {result.exceedsLegalLimit
                  ? t('planesi.exceeds_limit', 'Supera el límite permisible ponderado del D.S. 594 Art. 66')
                  : t('planesi.within_limit', 'Dentro del límite permisible ponderado del D.S. 594 Art. 66')}
              </p>

              {result.planesiActivated && (
                <p
                  data-testid="planesi-activated"
                  className="flex items-start gap-2 text-xs rounded-lg p-3 border text-amber-300 bg-amber-500/10 border-amber-500/20"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {t('planesi.activated', 'Concentración sobre 0,1 mg/m³ de sílice libre cristalizada: activar programa PLANESI (procedimiento interno).')}
                </p>
              )}

              <div data-testid="planesi-surveillance" className="flex items-start gap-2 text-xs text-secondary-token rounded-lg p-3 border border-default-token bg-elevated">
                <CalendarClock className="w-4 h-4 shrink-0 text-orange-400" aria-hidden="true" />
                <span>
                  {/* Engine strings are es-CL by design (MINSAL protocol). */}
                  <span className="block">{result.surveillancePeriodicity}</span>
                  <span className="block mt-1 text-muted-token">{result.ambientReevaluation}</span>
                </span>
              </div>

              <div>
                <p className="text-[10px] font-black text-muted-token uppercase tracking-widest mb-1">
                  {t('protocols_minsal.mandated_action', 'Acción que exige el protocolo')}
                </p>
                <p className="text-xs text-secondary-token leading-relaxed">{result.recommendation}</p>
              </div>
            </div>
          )}
        </div>

        {/* History */}
        <div data-testid="planesi-history" className="bg-surface border border-default-token rounded-2xl p-4 sm:p-6">
          <h3 className="text-sm font-bold text-primary-token mb-4 flex items-center gap-2">
            <History className="w-4 h-4 text-orange-400" />
            {t('protocols_minsal.history_title', 'Historial del proyecto')}
          </h3>
          {historyLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p data-testid="planesi-history-empty" className="text-xs text-muted-token">
              {t('protocols_minsal.history_empty', 'Aún no hay evaluaciones registradas en este proyecto.')}
            </p>
          ) : (
            <ul className="space-y-3">
              {history.map((a) => {
                const r = a.result as PlanesiResult;
                return (
                  <li
                    key={a.id}
                    data-testid={`planesi-history-item-${a.id}`}
                    className="border border-default-token rounded-xl p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-primary-token line-clamp-1">{a.taskName}</span>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded ${GRADE_BADGE[r.exposureGrade] ?? 'bg-elevated text-muted-token'}`}>
                        {t(`planesi.grade_${r.exposureGrade}`)}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-token">
                      {t('protocols_minsal.history_date', 'Fecha')}: {formatDate(a.computedAt)} ·{' '}
                      {t('planesi.percent_lpp', '% del LPP corregido')}: {formatNumber(r.percentOfLpp)}%
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
