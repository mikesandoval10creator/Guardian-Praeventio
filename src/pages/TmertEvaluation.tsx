// Praeventio Guard — TMERT-EESS management page (B-protocols).
//
// Gives the prevencionista a full in-app workflow over the pure engine
// `src/services/protocols/tmert.ts` (Norma Técnica MINSAL TMERT-EESS 2012):
// checklist form → server-side compute (stateless preview) → audited
// persistence into `protocol_assessments` → per-project history.
//
// ADR 0012: this page evaluates EXPOSURE per the MINSAL protocol; it never
// renders a clinical judgment. The high-risk verdict mandates referral —
// the health qualification belongs to the médico del organismo
// administrador. A permanent disclaimer states this.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Hand,
  Loader2,
  Save,
  Scale,
  History,
  AlertTriangle,
  Stethoscope,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import type { TmertConditions, TmertFactor, TmertInput, TmertResult } from '../services/protocols/tmert';
import {
  evaluateTmertRemote,
  recordTmertAssessment,
  listProtocolAssessments,
  type ProtocolAssessment,
} from '../hooks/useProtocols';

const FACTORS: TmertFactor[] = ['repetitividad', 'fuerza', 'posturaForzada', 'otros'];
const CONDITIONS = ['A', 'B', 'C'] as const;

const emptyConditions = (): TmertConditions => ({ A: false, B: false, C: false });

const RISK_BADGE: Record<TmertResult['overallRisk'], string> = {
  bajo: 'bg-emerald-500/10 text-emerald-500',
  medio: 'bg-amber-500/10 text-amber-500',
  alto: 'bg-rose-500/10 text-rose-500',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-CL');
}

export function TmertEvaluation() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();

  const [taskName, setTaskName] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [conditions, setConditions] = useState<Record<TmertFactor, TmertConditions>>({
    repetitividad: emptyConditions(),
    fuerza: emptyConditions(),
    posturaForzada: emptyConditions(),
    otros: emptyConditions(),
  });
  const [exposureHours, setExposureHours] = useState(8);

  const [result, setResult] = useState<TmertResult | null>(null);
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
      const { assessments } = await listProtocolAssessments(projectId, 'TMERT');
      setHistory(assessments);
    } catch {
      // History is non-blocking; the form keeps working offline-ish.
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
      <div className="p-8 max-w-3xl mx-auto" data-testid="tmert-page-empty">
        <p className="text-muted-token text-sm">
          {t('protocols_minsal.select_project', 'Selecciona un proyecto para gestionar el protocolo.')}
        </p>
      </div>
    );
  }

  const buildInput = (): TmertInput => ({
    repetitividad: conditions.repetitividad,
    fuerza: conditions.fuerza,
    posturaForzada: conditions.posturaForzada,
    otros: conditions.otros,
    exposureHoursPerDay: exposureHours,
  });

  const toggle = (factor: TmertFactor, cond: (typeof CONDITIONS)[number]) => {
    setResult(null);
    setStatus(null);
    setConditions((prev) => ({
      ...prev,
      [factor]: { ...prev[factor], [cond]: !prev[factor][cond] },
    }));
  };

  const handleCalculate = async () => {
    setError(null);
    setStatus(null);
    setCalculating(true);
    try {
      const { result: r } = await evaluateTmertRemote(selectedProject.id, { input: buildInput() });
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
    setSaving(true);
    try {
      await recordTmertAssessment(selectedProject.id, {
        input: buildInput(),
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
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6" data-testid="tmert-page">
      <div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight flex items-center gap-3">
          <Hand className="w-8 h-8 text-amber-400" />
          {t('tmert.title', 'TMERT-EESS')}
        </h1>
        <p className="text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] mt-2">
          {t('tmert.subtitle', 'Norma Técnica MINSAL — Trastornos musculoesqueléticos de extremidad superior')}
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
        data-testid="tmert-legal-frame"
        className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3"
      >
        <Scale className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-amber-200/90 leading-relaxed">{t('tmert.legal_frame')}</p>
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
                  data-testid="tmert-task-input"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder={t('protocols_minsal.task_placeholder', 'Ej: Ensacado manual línea 2')}
                  className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2.5 px-3 text-sm text-primary-token placeholder:text-muted-token focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-secondary-token uppercase tracking-widest">
                  {t('protocols_minsal.worker_label', 'Trabajador o GES (opcional)')}
                </span>
                <input
                  type="text"
                  data-testid="tmert-worker-input"
                  value={workerId}
                  onChange={(e) => setWorkerId(e.target.value)}
                  placeholder={t('protocols_minsal.worker_placeholder', 'ID del trabajador o grupo de exposición similar')}
                  className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2.5 px-3 text-sm text-primary-token placeholder:text-muted-token focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                />
              </label>
            </div>

            <h3 className="text-sm font-bold text-primary-token pt-2">
              {t('tmert.factors_title', 'Lista de chequeo de factores de riesgo')}
            </h3>

            {FACTORS.map((factor) => (
              <fieldset
                key={factor}
                data-testid={`tmert-factor-${factor}`}
                className="border border-default-token rounded-xl p-4 space-y-2"
              >
                <legend className="text-xs font-black text-amber-400 uppercase tracking-widest px-1">
                  {t(`tmert.factor_${factor}`)}
                </legend>
                {CONDITIONS.map((cond) => (
                  <label key={cond} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      data-testid={`tmert-cond-${factor}-${cond}`}
                      checked={conditions[factor][cond]}
                      onChange={() => toggle(factor, cond)}
                      className="mt-0.5 h-4 w-4 rounded border-default-token bg-elevated accent-amber-500"
                    />
                    <span className="text-xs text-secondary-token leading-relaxed">
                      {t(`tmert.${factor}_${cond.toLowerCase()}`)}
                    </span>
                  </label>
                ))}
              </fieldset>
            ))}

            <label className="block max-w-xs">
              <span className="text-xs font-bold text-secondary-token uppercase tracking-widest">
                {t('tmert.exposure_hours', 'Horas de exposición efectiva por jornada')}
              </span>
              <input
                type="number"
                min={0}
                max={24}
                step={0.5}
                data-testid="tmert-hours-input"
                value={exposureHours}
                onChange={(e) => {
                  setResult(null);
                  setExposureHours(Number(e.target.value));
                }}
                className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2.5 px-3 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-amber-500/50"
              />
            </label>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                data-testid="tmert-calculate-btn"
                onClick={handleCalculate}
                disabled={calculating}
                className="flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-zinc-950 px-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
              >
                {calculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
                {t('protocols_minsal.calculate', 'Calcular')}
              </button>
              <button
                type="button"
                data-testid="tmert-save-btn"
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
              <p data-testid="tmert-status" className="text-xs text-emerald-400">{status}</p>
            )}
            {error && (
              <p data-testid="tmert-error" className="text-xs text-rose-400">{error}</p>
            )}
          </div>

          {/* Result */}
          {result && (
            <div data-testid="tmert-result" className="bg-surface border border-default-token rounded-2xl p-4 sm:p-6 space-y-3">
              <h3 className="text-sm font-bold text-primary-token">
                {t('protocols_minsal.result_title', 'Resultado')}
              </h3>
              <span
                data-testid="tmert-risk-badge"
                className={`inline-block text-xs font-black px-3 py-1.5 rounded-lg ${RISK_BADGE[result.overallRisk]}`}
              >
                {t(`tmert.risk_${result.overallRisk}`)}
              </span>
              <p className="text-xs text-muted-token">
                <span className="font-bold text-secondary-token">
                  {t('tmert.factors_at_risk', 'Factores en riesgo')}:{' '}
                </span>
                {result.factorsAtRisk.length > 0
                  ? result.factorsAtRisk.map((f) => t(`tmert.factor_${f}`)).join(' · ')
                  : t('tmert.no_factors', 'Sin factores en riesgo')}
              </p>
              <div>
                <p className="text-[10px] font-black text-muted-token uppercase tracking-widest mb-1">
                  {t('protocols_minsal.mandated_action', 'Acción que exige el protocolo')}
                </p>
                {/* Engine recommendation is es-CL by design (MINSAL protocol). */}
                <p className="text-xs text-secondary-token leading-relaxed">{result.recommendation}</p>
              </div>
              {result.requiresMedicalEvaluation && (
                <p
                  data-testid="tmert-medical-referral"
                  className="flex items-start gap-2 text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {t('tmert.requires_medical')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* History */}
        <div data-testid="tmert-history" className="bg-surface border border-default-token rounded-2xl p-4 sm:p-6">
          <h3 className="text-sm font-bold text-primary-token mb-4 flex items-center gap-2">
            <History className="w-4 h-4 text-amber-400" />
            {t('protocols_minsal.history_title', 'Historial del proyecto')}
          </h3>
          {historyLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 text-amber-400 animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p data-testid="tmert-history-empty" className="text-xs text-muted-token">
              {t('protocols_minsal.history_empty', 'Aún no hay evaluaciones registradas en este proyecto.')}
            </p>
          ) : (
            <ul className="space-y-3">
              {history.map((a) => {
                const r = a.result as TmertResult;
                return (
                  <li
                    key={a.id}
                    data-testid={`tmert-history-item-${a.id}`}
                    className="border border-default-token rounded-xl p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-primary-token line-clamp-1">{a.taskName}</span>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded ${RISK_BADGE[r.overallRisk] ?? 'bg-elevated text-muted-token'}`}>
                        {t(`tmert.risk_${r.overallRisk}`)}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-token">
                      {t('protocols_minsal.history_date', 'Fecha')}: {formatDate(a.computedAt)}
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
