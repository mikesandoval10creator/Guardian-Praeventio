// Praeventio Guard — Wire UI #55: <OperationalPressureGauge />
//
// Muestra el score 0-100 de presión operacional + nivel + top drivers.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import {
  computeOperationalPressure,
  type PressureSignals,
} from '../../services/orgMetrics/organizationalMetrics.js';

interface OperationalPressureGaugeProps {
  signals: PressureSignals;
}

export function OperationalPressureGauge({ signals }: OperationalPressureGaugeProps) {
  const { t } = useTranslation();
  const report = useMemo(() => computeOperationalPressure(signals), [signals]);

  const tone =
    report.level === 'critical'
      ? { color: 'text-rose-500', bg: 'bg-rose-500/10', track: 'bg-rose-500' }
      : report.level === 'high'
        ? { color: 'text-orange-500', bg: 'bg-orange-500/10', track: 'bg-orange-500' }
        : report.level === 'medium'
          ? { color: 'text-amber-500', bg: 'bg-amber-500/10', track: 'bg-amber-500' }
          : { color: 'text-emerald-500', bg: 'bg-emerald-500/10', track: 'bg-emerald-500' };

  return (
    <section
      className={`rounded-2xl border border-default-token p-4 shadow-mode space-y-3 ${tone.bg}`}
      data-testid="operational-pressure-gauge"
      aria-label={t('orgMetrics.pressureAria', 'Presión operacional') as string}
    >
      <header className="flex items-center gap-2">
        <Gauge className={`w-4 h-4 ${tone.color}`} aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('orgMetrics.pressureTitle', 'Presión operacional')}
        </h2>
        <span
          className={`ml-auto text-[10px] font-bold uppercase ${tone.color}`}
          data-testid="operational-pressure-level"
        >
          {report.level}
        </span>
      </header>

      <div className="flex items-baseline gap-2">
        <p
          className={`text-3xl font-black tabular-nums ${tone.color}`}
          data-testid="operational-pressure-score"
        >
          {report.pressureScore}
        </p>
        <p className="text-xs text-secondary-token">/ 100</p>
      </div>

      <div className="h-2 bg-surface rounded overflow-hidden">
        <div
          className={`h-full ${tone.track}`}
          style={{ width: `${report.pressureScore}%` }}
          data-testid="operational-pressure-bar"
        />
      </div>

      {report.topDrivers.length > 0 && (
        <div data-testid="operational-pressure-drivers">
          <h3 className="text-[10px] uppercase font-bold text-secondary-token mb-1">
            {t('orgMetrics.topDrivers', 'Drivers principales')}
          </h3>
          <ul className="space-y-0.5">
            {report.topDrivers.map((d, i) => (
              <li
                key={i}
                className="text-[11px]"
                data-testid={`operational-pressure-driver-${i}`}
              >
                • {d}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
