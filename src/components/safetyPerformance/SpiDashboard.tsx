// Praeventio Guard — Wire UI #26: <SpiDashboard />
//
// Dashboard ejecutivo del Safety Performance Index. Combina leading +
// lagging en un solo score visual de 0-100 con foco de mejora.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, AlertTriangle, Award } from 'lucide-react';
import {
  computeSafetyPerformance,
  type LeadingIndicators,
  type LaggingIndicators,
  type SafetyPerformanceReport,
} from '../../services/safetyPerformance/safetyPerformanceIndex.js';

interface SpiDashboardProps {
  leading: LeadingIndicators;
  lagging: LaggingIndicators;
}

const LEVEL_CLASS: Record<SafetyPerformanceReport['level'], string> = {
  critical: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
  poor: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/40',
  fair: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  good: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 border-sky-500/30',
  excellent: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
};

export function SpiDashboard({ leading, lagging }: SpiDashboardProps) {
  const { t } = useTranslation();
  const report = useMemo(() => computeSafetyPerformance(leading, lagging), [leading, lagging]);

  return (
    <section
      className={`rounded-2xl border-2 p-4 shadow-mode space-y-3 ${LEVEL_CLASS[report.level]}`}
      data-testid="spi-dashboard"
      aria-label={t('spi.aria', 'Safety Performance Index') as string}
    >
      <header className="flex items-center gap-2">
        <Award className="w-5 h-5" aria-hidden="true" />
        <h2 className="text-sm font-black uppercase tracking-wide">
          {t('spi.title', 'Safety Performance Index')}
        </h2>
        <span className="ml-auto text-3xl font-black tabular-nums" data-testid="spi-score">
          {report.spiScore}
        </span>
      </header>

      <p className="text-[10px] uppercase opacity-80">
        {t('spi.level', 'Nivel')}: <strong>{report.level}</strong>
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg p-2 bg-current/10">
          <p className="text-[10px] uppercase opacity-70">{t('spi.leading', 'Leading (prev.)')}</p>
          <p className="text-2xl font-black tabular-nums" data-testid="spi-leading">
            {report.leadingScore}
          </p>
          <p className="text-[10px] opacity-60">{t('spi.weight40', '40% del SPI')}</p>
        </div>
        <div className="rounded-lg p-2 bg-current/10">
          <p className="text-[10px] uppercase opacity-70">{t('spi.lagging', 'Lagging (react.)')}</p>
          <p className="text-2xl font-black tabular-nums" data-testid="spi-lagging">
            {report.laggingScore}
          </p>
          <p className="text-[10px] opacity-60">{t('spi.weight60', '60% del SPI')}</p>
        </div>
      </div>

      {report.improvementFocusAreas.length > 0 && (
        <div data-testid="spi-focus-areas">
          <h3 className="text-xs font-bold uppercase mb-1 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" aria-hidden="true" />
            {t('spi.focusOn', 'Foco de mejora')}
          </h3>
          <ul className="text-[11px] space-y-0.5">
            {report.improvementFocusAreas.map((a, i) => (
              <li key={i} className="opacity-85">
                • {a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.level === 'critical' && (
        <div
          className="flex items-center gap-2 text-xs font-bold p-2 rounded bg-rose-500/20"
          data-testid="spi-critical-alert"
        >
          <AlertTriangle className="w-4 h-4" aria-hidden="true" />
          {t('spi.criticalAction', 'SPI crítico — revisar plan preventivo de gerencia.')}
        </div>
      )}
    </section>
  );
}
