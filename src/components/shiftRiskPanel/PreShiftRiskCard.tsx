// Praeventio Guard — Wire UI Sprint 41 F.21: Pre-shift risk panel.
//
// Renderiza el ShiftRiskReport: score 0-100, badge level (green/amber/
// red), factores con tooltip, top recommendations, banner si delay
// recomendado.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertOctagon, AlertTriangle, Calendar } from 'lucide-react';
import {
  composeShiftRiskPanel,
  type ShiftRiskInputs,
  type ShiftRiskReport,
} from '../../services/shiftRiskPanel/preShiftRiskComposer.js';

interface PreShiftRiskCardProps {
  /** Pasa inputs raw para que el componente compute el reporte... */
  inputs?: ShiftRiskInputs;
  /** ...O pasa el reporte ya compuesto (server-side render path). */
  report?: ShiftRiskReport;
  onAcknowledge?: () => void;
}

const LEVEL_TONE = {
  green: {
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    badge: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-500',
    color: 'text-emerald-600',
  },
  amber: {
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    badge: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-500',
    color: 'text-amber-600',
  },
  red: {
    bg: 'bg-rose-500/10',
    border: 'border-rose-500/30',
    badge: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    bar: 'bg-rose-500',
    color: 'text-rose-600',
  },
} as const;

export function PreShiftRiskCard({
  inputs,
  report: passedReport,
  onAcknowledge,
}: PreShiftRiskCardProps) {
  const { t } = useTranslation();

  const report = useMemo(() => {
    if (passedReport) return passedReport;
    if (inputs) return composeShiftRiskPanel(inputs);
    return null;
  }, [inputs, passedReport]);

  if (!report) {
    return (
      <section
        className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
        data-testid="pre-shift-risk-empty"
      >
        <p className="text-xs text-secondary-token">
          {t('shiftRisk.noData', 'Sin datos de turno para evaluar')}
        </p>
      </section>
    );
  }

  const tone = LEVEL_TONE[report.level];
  const Icon =
    report.level === 'red' ? AlertOctagon : report.level === 'amber' ? AlertTriangle : Activity;

  return (
    <section
      className={`rounded-2xl border ${tone.border} ${tone.bg} p-4 shadow-mode space-y-3`}
      data-testid={`pre-shift-risk-${report.projectId}-${report.shift}`}
      aria-label={t('shiftRisk.aria', 'Panel de riesgo pre-turno') as string}
    >
      <header className="flex items-center gap-2">
        <Icon className={`w-5 h-5 ${tone.color}`} aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('shiftRisk.title', 'Riesgo pre-turno')}
        </h2>
        <span
          className={`ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded ${tone.badge}`}
          data-testid={`pre-shift-risk-level-${report.projectId}`}
        >
          {report.level}
        </span>
      </header>

      <div className="flex items-center gap-3 text-[10px] text-secondary-token">
        <Calendar className="w-3 h-3" aria-hidden="true" />
        <span className="tabular-nums">{report.date}</span>
        <span className="uppercase font-bold">{report.shift}</span>
      </div>

      {/* Score gauge */}
      <div>
        <div className="flex items-baseline gap-2">
          <p
            className={`text-3xl font-black tabular-nums ${tone.color}`}
            data-testid={`pre-shift-risk-score-${report.projectId}`}
          >
            {report.riskScore}
          </p>
          <p className="text-xs text-secondary-token">/ 100</p>
        </div>
        <div className="h-2 bg-surface rounded overflow-hidden mt-2">
          <div
            className={`h-full ${tone.bar}`}
            style={{ width: `${report.riskScore}%` }}
            data-testid={`pre-shift-risk-bar-${report.projectId}`}
          />
        </div>
      </div>

      {/* Delay banner */}
      {report.recommendDelayShiftStart && (
        <div
          className="flex items-start gap-2 bg-rose-500/15 text-rose-700 dark:text-rose-300 p-2 rounded text-[11px] font-bold"
          data-testid={`pre-shift-risk-delay-${report.projectId}`}
        >
          <AlertOctagon className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {t(
              'shiftRisk.delayRecommended',
              'Recomendación: postergar arranque hasta mitigar factores críticos.',
            )}
          </span>
        </div>
      )}

      {/* Top recommendations */}
      {report.topRecommendations.length > 0 && (
        <div data-testid={`pre-shift-risk-recommendations-${report.projectId}`}>
          <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
            {t('shiftRisk.topRecs', 'Acciones priorizadas')}
          </h3>
          <ul className="space-y-1">
            {report.topRecommendations.map((r, i) => (
              <li
                key={i}
                className="text-[11px] bg-surface rounded px-2 py-1"
                data-testid={`pre-shift-risk-rec-${report.projectId}-${i}`}
              >
                → {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Factors detail */}
      <details data-testid={`pre-shift-risk-factors-${report.projectId}`}>
        <summary className="text-[10px] uppercase font-bold text-secondary-token cursor-pointer">
          {t('shiftRisk.factors', 'Factores')} ({report.factors.length})
        </summary>
        <ul className="mt-1 space-y-1">
          {report.factors.map((f) => (
            <li
              key={f.id}
              className="flex justify-between text-[11px] bg-surface rounded px-2 py-1"
              data-testid={`pre-shift-risk-factor-${f.id}`}
            >
              <span>{f.label}</span>
              <span className="font-bold tabular-nums text-secondary-token">+{f.weight}</span>
            </li>
          ))}
        </ul>
      </details>

      {onAcknowledge && (
        <button
          type="button"
          onClick={onAcknowledge}
          data-testid={`pre-shift-risk-ack-${report.projectId}`}
          className="w-full text-[11px] font-bold text-sky-600 underline"
        >
          {t('shiftRisk.ack', 'Reconocer y arrancar turno')}
        </button>
      )}
    </section>
  );
}
