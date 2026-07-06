// Praeventio Guard — Bloque D Rama 1: <RetaliationProtectionPanel />
//
// Self-contained retaliation-risk form (Ley Karin 21.643) over the
// pure-compute endpoints POST /api/sprint-k/:projectId/retaliation/analyze
// and /recommend-actions (src/server/routes/retaliationProtection.ts),
// consumed via the previously-orphaned hook
// src/hooks/useRetaliationProtection.ts. Minimal v1 form: one observed
// signal after a confidential report → risk score + protective actions
// (analyze → recommend-actions chained in a single submit).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, AlertTriangle } from 'lucide-react';
import {
  analyzeRetaliationRiskRemote,
  recommendProtectiveActionsRemote,
} from '../../hooks/useRetaliationProtection';
import type {
  ProtectiveAction,
  RetaliationRiskAssessment,
  RetaliationSignal,
} from '../../services/retaliationProtection/retaliationDetector';

interface RetaliationProtectionPanelProps {
  projectId: string;
}

const KIND_OPTIONS: Array<{ value: RetaliationSignal['kind']; label: string }> = [
  { value: 'salary_change', label: 'Cambio de remuneración' },
  { value: 'shift_change_negative', label: 'Cambio de turno desfavorable' },
  { value: 'role_demoted', label: 'Descenso de cargo' },
  { value: 'isolation', label: 'Aislamiento' },
  { value: 'increased_scrutiny', label: 'Fiscalización excesiva' },
  { value: 'task_reassignment', label: 'Reasignación de tareas' },
];

const SEVERITY_OPTIONS: Array<{ value: RetaliationSignal['severity']; label: string }> = [
  { value: 'low', label: 'Baja' },
  { value: 'medium', label: 'Media' },
  { value: 'high', label: 'Alta' },
];

const LEVEL_LABELS: Record<RetaliationRiskAssessment['level'], string> = {
  low: 'Riesgo bajo',
  moderate: 'Riesgo moderado',
  high: 'Riesgo alto',
};

const LEVEL_TONES: Record<RetaliationRiskAssessment['level'], string> = {
  low: 'text-emerald-600 dark:text-emerald-400',
  moderate: 'text-amber-600 dark:text-amber-400',
  high: 'text-rose-600 dark:text-rose-400',
};

const ACTION_LABELS: Record<ProtectiveAction['kind'], string> = {
  separate_from_supervisor: 'Separación operacional de la jefatura',
  transfer_team: 'Ofrecer traslado a otro equipo',
  external_mediation: 'Mediación externa independiente',
  legal_counsel_referral: 'Derivación a asesoría legal',
  wellbeing_check_in: 'Check-in confidencial de bienestar',
  monitoring_increase: 'Aumentar monitoreo de señales',
};

export function RetaliationProtectionPanel({ projectId }: RetaliationProtectionPanelProps) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  const [reportFiledAt, setReportFiledAt] = useState(today);
  const [reporterUid, setReporterUid] = useState('');
  const [supervisorUid, setSupervisorUid] = useState('');
  const [kind, setKind] = useState<RetaliationSignal['kind']>('salary_change');
  const [severity, setSeverity] = useState<RetaliationSignal['severity']>('medium');
  const [observedAt, setObservedAt] = useState(today);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    assessment: RetaliationRiskAssessment;
    actions: ProtectiveAction[];
  } | null>(null);

  const canSubmit =
    reporterUid.trim().length > 0 && supervisorUid.trim().length > 0 && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      const { assessment } = await analyzeRetaliationRiskRemote(projectId, {
        reportFiledAt,
        signals: [
          {
            kind,
            severity,
            observedAt,
            reporterUid: reporterUid.trim(),
            supervisorUid: supervisorUid.trim(),
          },
        ],
      });
      const { actions } = await recommendProtectiveActionsRemote(projectId, { assessment });
      setResult({ assessment, actions });
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'unknown_error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="retaliation-protection-panel"
      aria-label={t('retaliationProtection.panel.aria', 'Análisis de riesgo de represalias') as string}
    >
      <header className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-rose-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('retaliationProtection.panel.title', 'Riesgo de represalias post-denuncia')}
        </h2>
      </header>

      <p className="text-[11px] text-secondary-token">
        {t(
          'retaliationProtection.panel.disclaimer',
          'Ley Karin 21.643 — señales observadas dentro de la ventana de evaluación (90 días por defecto).',
        )}
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('retaliationProtection.panel.reportFiledAt', 'Fecha de la denuncia')}
          </span>
          <input
            type="date"
            value={reportFiledAt}
            onChange={(e) => setReportFiledAt(e.target.value)}
            data-testid="retaliation-protection-report-date"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('retaliationProtection.panel.reportFiledAt', 'Fecha de la denuncia') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('retaliationProtection.panel.observedAt', 'Fecha de la señal')}
          </span>
          <input
            type="date"
            value={observedAt}
            onChange={(e) => setObservedAt(e.target.value)}
            data-testid="retaliation-protection-observed-at"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('retaliationProtection.panel.observedAt', 'Fecha de la señal') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('retaliationProtection.panel.reporterUid', 'ID denunciante')}
          </span>
          <input
            type="text"
            value={reporterUid}
            onChange={(e) => setReporterUid(e.target.value)}
            data-testid="retaliation-protection-reporter"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('retaliationProtection.panel.reporterUid', 'ID denunciante') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('retaliationProtection.panel.supervisorUid', 'ID jefatura')}
          </span>
          <input
            type="text"
            value={supervisorUid}
            onChange={(e) => setSupervisorUid(e.target.value)}
            data-testid="retaliation-protection-supervisor"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
            aria-label={t('retaliationProtection.panel.supervisorUid', 'ID jefatura') as string}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('retaliationProtection.panel.kind', 'Tipo de señal')}
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as RetaliationSignal['kind'])}
            data-testid="retaliation-protection-kind"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('retaliationProtection.panel.severity', 'Severidad')}
          </span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value as RetaliationSignal['severity'])}
            data-testid="retaliation-protection-severity"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            {SEVERITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={!canSubmit}
          data-testid="retaliation-protection-submit"
          className="col-span-2 rounded-xl bg-rose-600 text-white text-xs font-bold uppercase tracking-wide px-3 py-2 disabled:opacity-50"
        >
          {loading
            ? t('common.loading', 'Cargando…')
            : t('retaliationProtection.panel.submit', 'Analizar riesgo')}
        </button>
      </form>

      {error && (
        <div
          className="flex items-start gap-2 bg-rose-500/10 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px]"
          data-testid="retaliation-protection-error"
          role="alert"
        >
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{t('retaliationProtection.panel.error', 'No se pudo analizar el riesgo.')} ({error})</span>
        </div>
      )}

      {result && (
        <div
          className="bg-surface-elevated rounded p-3 space-y-2"
          data-testid="retaliation-protection-result"
        >
          <p className={`text-sm font-black ${LEVEL_TONES[result.assessment.level]}`}>
            {LEVEL_LABELS[result.assessment.level]}
            <span className="ml-2 tabular-nums">({result.assessment.score}/100)</span>
          </p>
          <p className="text-[11px] text-secondary-token">
            {t('retaliationProtection.panel.signalCount', 'Señales consideradas:')}{' '}
            {result.assessment.signalCount}
          </p>
          <div>
            <p className="text-[10px] uppercase text-secondary-token">
              {t('retaliationProtection.panel.actions', 'Acciones protectoras recomendadas')}
            </p>
            <ul className="text-[11px] text-primary-token list-disc pl-4">
              {result.actions.map((a) => (
                <li key={a.kind}>{ACTION_LABELS[a.kind]}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
