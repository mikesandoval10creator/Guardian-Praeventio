// Praeventio Guard — Wire UI #53: <DeviationRadarPanel />
//
// Lista los patrones detectados por buildNormalizationRadar +
// summarizeRadar. Marca escalamiento a gerencia y permite drill-down.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Radar, Crown, AlertTriangle } from 'lucide-react';
import {
  summarizeRadar,
  type NormalizationPattern,
  type NormalizationSeverity,
} from '../../services/governance/deviationNormalizationRadar.js';

interface DeviationRadarPanelProps {
  patterns: NormalizationPattern[];
  onEscalate?: (pattern: NormalizationPattern) => void;
}

const SEVERITY_TONE: Record<NormalizationSeverity, string> = {
  critical: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  info: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
};

export function DeviationRadarPanel({ patterns, onEscalate }: DeviationRadarPanelProps) {
  const { t } = useTranslation();
  const summary = useMemo(() => summarizeRadar(patterns), [patterns]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="deviation-radar-panel"
      aria-label={t('deviationRadar.aria', 'Radar de desvíos normalizados') as string}
    >
      <header className="flex items-center gap-2">
        <Radar className="w-4 h-4 text-violet-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('deviationRadar.title', 'Radar de normalización')}
        </h2>
        <span className="ml-auto text-[10px] uppercase text-secondary-token tabular-nums">
          {summary.totalPatterns} {t('deviationRadar.patterns', 'patrones')}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-rose-500/10 rounded p-2" data-testid="deviation-radar-critical">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('deviationRadar.critical', 'Crítico')}
          </p>
          <p className="text-xl font-black tabular-nums text-rose-600">
            {summary.bySeverity.critical}
          </p>
        </div>
        <div className="bg-amber-500/10 rounded p-2" data-testid="deviation-radar-warning">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('deviationRadar.warning', 'Advertencia')}
          </p>
          <p className="text-xl font-black tabular-nums text-amber-600">
            {summary.bySeverity.warning}
          </p>
        </div>
        <div className="bg-sky-500/10 rounded p-2" data-testid="deviation-radar-info">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('deviationRadar.info', 'Informativo')}
          </p>
          <p className="text-xl font-black tabular-nums text-sky-600">
            {summary.bySeverity.info}
          </p>
        </div>
      </div>

      {summary.pendingEscalations > 0 && (
        <div
          className="flex items-center gap-2 text-[11px] bg-amber-500/10 text-amber-700 dark:text-amber-300 p-2 rounded"
          data-testid="deviation-radar-pending-escalations"
        >
          <Crown className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>
            {summary.pendingEscalations} {t('deviationRadar.pendingEscalation', 'escalamientos a gerencia pendientes')}
          </span>
        </div>
      )}

      <ul className="space-y-2" data-testid="deviation-radar-list">
        {patterns.length === 0 && (
          <li className="text-[11px] text-secondary-token italic">
            {t('deviationRadar.empty', 'Sin patrones detectados en la ventana actual.')}
          </li>
        )}
        {patterns.map((p, i) => (
          <li
            key={i}
            data-testid={`deviation-pattern-${i}`}
            className="rounded p-2 bg-surface-elevated"
          >
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded ${SEVERITY_TONE[p.severity]}`}
              >
                {p.severity.toUpperCase()}
              </span>
              <span className="text-[10px] uppercase font-bold text-secondary-token">
                {p.kind}
              </span>
              {p.escalateToManagement && (
                <span
                  className="ml-auto flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300 font-bold"
                  data-testid={`deviation-pattern-escalate-${i}`}
                >
                  <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                  {t('deviationRadar.escalate', 'Escala gerencia')}
                </span>
              )}
            </div>
            <p className="text-[11px]">{p.description}</p>
            <p className="text-[10px] text-secondary-token mt-1">{p.suggestedAction}</p>
            {onEscalate && p.escalateToManagement && (
              <button
                type="button"
                onClick={() => onEscalate(p)}
                data-testid={`deviation-pattern-action-${i}`}
                className="mt-1 text-[10px] font-bold text-amber-700 dark:text-amber-300 underline"
              >
                {t('deviationRadar.escalateNow', 'Escalar ahora')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
