// Praeventio Guard — PREXOR management page (B-protocols).
//
// Gives the prevencionista a full in-app workflow over the pure engine
// `src/services/protocols/prexor.ts` (Protocolo de Exposición Ocupacional a
// Ruido — DS 594 Art. 75, Q = 3 dB): noise measurements form → server-side
// dose compute (stateless preview) → audited persistence into
// `protocol_assessments` → per-project history.
//
// ADR 0012: this page evaluates noise EXPOSURE per the MINSAL protocol; it
// never renders a clinical judgment (no audiometry interpretation). The
// critical/alto verdicts mandate surveillance-program referral — the health
// qualification belongs to the médico del organismo administrador.

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Ear,
  Loader2,
  Save,
  Scale,
  History,
  Plus,
  Trash2,
  AlertTriangle,
  Stethoscope,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import type { PrexorMeasurement, PrexorResult } from '../services/protocols/prexor';
import {
  calculatePrexorRemote,
  recordPrexorAssessment,
  listProtocolAssessments,
  type ProtocolAssessment,
} from '../hooks/useProtocols';

const RISK_BADGE: Record<PrexorResult['riskLevel'], string> = {
  bajo: 'bg-emerald-500/10 text-emerald-500',
  significativo: 'bg-amber-500/10 text-amber-500',
  alto: 'bg-orange-500/10 text-orange-500',
  critico: 'bg-rose-500/10 text-rose-500',
};

interface MeasurementRow {
  durationHours: string;
  levelDbA: string;
}

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

export function PrexorEvaluation() {
  const { t } = useTranslation();
  const { selectedProject } = useProject();

  const [taskName, setTaskName] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [rows, setRows] = useState<MeasurementRow[]>([
    { durationHours: '8', levelDbA: '85' },
  ]);

  const [result, setResult] = useState<PrexorResult | null>(null);
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
      const { assessments } = await listProtocolAssessments(projectId, 'PREXOR');
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
      <div className="p-8 max-w-3xl mx-auto" data-testid="prexor-page-empty">
        <p className="text-muted-token text-sm">
          {t('protocols_minsal.select_project', 'Selecciona un proyecto para gestionar el protocolo.')}
        </p>
      </div>
    );
  }

  const parseMeasurements = (): PrexorMeasurement[] | null => {
    const parsed = rows.map((r) => ({
      durationHours: Number(r.durationHours),
      levelDbA: Number(r.levelDbA),
    }));
    if (
      parsed.length === 0 ||
      parsed.some(
        (m) =>
          !Number.isFinite(m.durationHours) ||
          !Number.isFinite(m.levelDbA) ||
          m.durationHours < 0 ||
          m.levelDbA < 0,
      )
    ) {
      return null;
    }
    return parsed;
  };

  const updateRow = (idx: number, field: keyof MeasurementRow, value: string) => {
    setResult(null);
    setStatus(null);
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const addRow = () => {
    setResult(null);
    setRows((prev) => [...prev, { durationHours: '', levelDbA: '' }]);
  };

  const removeRow = (idx: number) => {
    setResult(null);
    setRows((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleCalculate = async () => {
    setError(null);
    setStatus(null);
    const measurements = parseMeasurements();
    if (!measurements) {
      setError(t('prexor.measurements_required', 'Agrega al menos una medición.'));
      return;
    }
    setCalculating(true);
    try {
      const { result: r } = await calculatePrexorRemote(selectedProject.id, { measurements });
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
    const measurements = parseMeasurements();
    if (!measurements) {
      setError(t('prexor.measurements_required', 'Agrega al menos una medición.'));
      return;
    }
    setSaving(true);
    try {
      await recordPrexorAssessment(selectedProject.id, {
        measurements,
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
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6" data-testid="prexor-page">
      <div>
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight flex items-center gap-3">
          <Ear className="w-8 h-8 text-sky-400" />
          {t('prexor.title', 'PREXOR')}
        </h1>
        <p className="text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] mt-2">
          {t('prexor.subtitle', 'Protocolo de exposición ocupacional a ruido — D.S. 594 Art. 75')}
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
        data-testid="prexor-legal-frame"
        className="bg-sky-500/10 border border-sky-500/20 rounded-xl p-4 flex items-start gap-3"
      >
        <Scale className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-xs text-sky-200/90 leading-relaxed">{t('prexor.legal_frame')}</p>
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
                  data-testid="prexor-task-input"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder={t('protocols_minsal.task_placeholder', 'Ej: Ensacado manual línea 2')}
                  className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2.5 px-3 text-sm text-primary-token placeholder:text-muted-token focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-secondary-token uppercase tracking-widest">
                  {t('protocols_minsal.worker_label', 'Trabajador o GES (opcional)')}
                </span>
                <input
                  type="text"
                  data-testid="prexor-worker-input"
                  value={workerId}
                  onChange={(e) => setWorkerId(e.target.value)}
                  placeholder={t('protocols_minsal.worker_placeholder', 'ID del trabajador o grupo de exposición similar')}
                  className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2.5 px-3 text-sm text-primary-token placeholder:text-muted-token focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              </label>
            </div>

            <h3 className="text-sm font-bold text-primary-token pt-2">
              {t('prexor.measurements_title', 'Mediciones de la jornada')}
            </h3>

            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div
                  key={idx}
                  data-testid={`prexor-measurement-row-${idx}`}
                  className="flex flex-col sm:flex-row gap-2 sm:items-end"
                >
                  <label className="block flex-1">
                    <span className="text-[10px] font-bold text-muted-token uppercase tracking-widest">
                      {t('prexor.duration_hours', 'Duración (horas)')}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      step={0.25}
                      data-testid={`prexor-duration-input-${idx}`}
                      value={row.durationHours}
                      onChange={(e) => updateRow(idx, 'durationHours', e.target.value)}
                      className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2 px-3 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                    />
                  </label>
                  <label className="block flex-1">
                    <span className="text-[10px] font-bold text-muted-token uppercase tracking-widest">
                      {t('prexor.level_dba', 'Nivel de ruido dB(A)')}
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={200}
                      step={0.5}
                      data-testid={`prexor-level-input-${idx}`}
                      value={row.levelDbA}
                      onChange={(e) => updateRow(idx, 'levelDbA', e.target.value)}
                      className="mt-1 w-full bg-surface border border-default-token rounded-xl py-2 px-3 text-sm text-primary-token focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={t('prexor.remove_measurement', 'Quitar')}
                    data-testid={`prexor-remove-row-${idx}`}
                    onClick={() => removeRow(idx)}
                    disabled={rows.length === 1}
                    className="flex items-center justify-center gap-1 text-rose-400 hover:text-rose-300 disabled:opacity-30 border border-default-token rounded-xl px-3 py-2 text-xs"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              data-testid="prexor-add-row-btn"
              onClick={addRow}
              className="flex items-center gap-2 text-sky-400 hover:text-sky-300 text-xs font-bold uppercase tracking-widest"
            >
              <Plus className="w-4 h-4" />
              {t('prexor.add_measurement', 'Agregar medición')}
            </button>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                type="button"
                data-testid="prexor-calculate-btn"
                onClick={handleCalculate}
                disabled={calculating}
                className="flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-zinc-950 px-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
              >
                {calculating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
                {t('protocols_minsal.calculate', 'Calcular')}
              </button>
              <button
                type="button"
                data-testid="prexor-save-btn"
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
              <p data-testid="prexor-status" className="text-xs text-emerald-400">{status}</p>
            )}
            {error && (
              <p data-testid="prexor-error" className="text-xs text-rose-400">{error}</p>
            )}
          </div>

          {/* Result */}
          {result && (
            <div data-testid="prexor-result" className="bg-surface border border-default-token rounded-2xl p-4 sm:p-6 space-y-3">
              <h3 className="text-sm font-bold text-primary-token">
                {t('protocols_minsal.result_title', 'Resultado')}
              </h3>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  data-testid="prexor-risk-badge"
                  className={`inline-block text-xs font-black px-3 py-1.5 rounded-lg ${RISK_BADGE[result.riskLevel]}`}
                >
                  {t(`prexor.risk_${result.riskLevel}`)}
                </span>
                <span className="text-xs text-secondary-token">
                  <span className="font-bold">{t('prexor.dose', 'Dosis diaria')}:</span>{' '}
                  {formatNumber(result.dosePercent)}%
                </span>
                <span className="text-xs text-secondary-token">
                  <span className="font-bold">{t('prexor.laeq', 'LAeq,8h equivalente')}:</span>{' '}
                  {formatNumber(result.leqEq8hDbA)} dB(A)
                </span>
              </div>
              <p
                data-testid="prexor-legal-limit"
                className={`flex items-start gap-2 text-xs rounded-lg p-3 border ${
                  result.exceedsLegalLimit
                    ? 'text-rose-300 bg-rose-500/10 border-rose-500/20'
                    : 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20'
                }`}
              >
                <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
                {result.exceedsLegalLimit
                  ? t('prexor.exceeds_limit', 'Supera el límite legal D.S. 594 (dosis > 100%)')
                  : t('prexor.within_limit', 'Dentro del límite legal D.S. 594')}
              </p>
              <div>
                <p className="text-[10px] font-black text-muted-token uppercase tracking-widest mb-1">
                  {t('protocols_minsal.mandated_action', 'Acción que exige el protocolo')}
                </p>
                {/* Engine recommendation is es-CL by design (MINSAL protocol). */}
                <p className="text-xs text-secondary-token leading-relaxed">{result.recommendation}</p>
              </div>
            </div>
          )}
        </div>

        {/* History */}
        <div data-testid="prexor-history" className="bg-surface border border-default-token rounded-2xl p-4 sm:p-6">
          <h3 className="text-sm font-bold text-primary-token mb-4 flex items-center gap-2">
            <History className="w-4 h-4 text-sky-400" />
            {t('protocols_minsal.history_title', 'Historial del proyecto')}
          </h3>
          {historyLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
            </div>
          ) : history.length === 0 ? (
            <p data-testid="prexor-history-empty" className="text-xs text-muted-token">
              {t('protocols_minsal.history_empty', 'Aún no hay evaluaciones registradas en este proyecto.')}
            </p>
          ) : (
            <ul className="space-y-3">
              {history.map((a) => {
                const r = a.result as PrexorResult;
                return (
                  <li
                    key={a.id}
                    data-testid={`prexor-history-item-${a.id}`}
                    className="border border-default-token rounded-xl p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-primary-token line-clamp-1">{a.taskName}</span>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded ${RISK_BADGE[r.riskLevel] ?? 'bg-elevated text-muted-token'}`}>
                        {t(`prexor.risk_${r.riskLevel}`)}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-token">
                      {t('protocols_minsal.history_date', 'Fecha')}: {formatDate(a.computedAt)} ·{' '}
                      {t('prexor.dose', 'Dosis diaria')}: {formatNumber(r.dosePercent)}%
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
