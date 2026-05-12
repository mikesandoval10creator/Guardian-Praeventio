// Praeventio Guard — Wire UI #65: <MeasurementQualityCard />
//
// Score agregado de calidad de mediciones ocupacionales (ruido, polvo,
// gases, iluminación...). Lista failures más frecuentes.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertCircle } from 'lucide-react';
import {
  buildQualityReport,
  type ChainValidationResult,
} from '../../services/measurements/measurementChain.js';

interface MeasurementQualityCardProps {
  results: ChainValidationResult[];
}

export function MeasurementQualityCard({ results }: MeasurementQualityCardProps) {
  const { t } = useTranslation();
  const report = useMemo(() => buildQualityReport(results), [results]);

  const tone =
    report.qualityScore >= 80
      ? 'text-emerald-500'
      : report.qualityScore >= 50
        ? 'text-amber-500'
        : 'text-rose-500';

  const sortedFailures = useMemo(
    () =>
      Object.entries(report.failureBreakdown)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    [report.failureBreakdown],
  );

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="measurement-quality-card"
      aria-label={t('measurements.qualityAria', 'Calidad mediciones') as string}
    >
      <header className="flex items-center gap-2">
        <Activity className={`w-4 h-4 ${tone}`} aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('measurements.qualityTitle', 'Calidad cadena de medición')}
        </h2>
        <span className="ml-auto text-[10px] text-secondary-token tabular-nums">
          {report.total} {t('measurements.measurements', 'mediciones')}
        </span>
      </header>

      <div className="flex items-baseline gap-2">
        <p
          className={`text-3xl font-black tabular-nums ${tone}`}
          data-testid="measurement-quality-score"
        >
          {report.qualityScore}
        </p>
        <p className="text-xs text-secondary-token">/ 100</p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-emerald-500/10 rounded p-2" data-testid="measurement-quality-valid">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('measurements.valid', 'Válidas')}
          </p>
          <p className="text-lg font-black tabular-nums text-emerald-600">{report.valid}</p>
        </div>
        <div className="bg-rose-500/10 rounded p-2" data-testid="measurement-quality-invalid">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('measurements.invalid', 'Inválidas')}
          </p>
          <p className="text-lg font-black tabular-nums text-rose-600">{report.invalid}</p>
        </div>
        <div className="bg-amber-500/10 rounded p-2" data-testid="measurement-quality-warnings">
          <p className="text-[10px] uppercase text-secondary-token">
            {t('measurements.warnings', 'Con avisos')}
          </p>
          <p className="text-lg font-black tabular-nums text-amber-600">
            {report.withWarnings}
          </p>
        </div>
      </div>

      {sortedFailures.length > 0 && (
        <div data-testid="measurement-quality-failures">
          <h3 className="flex items-center gap-1 text-[10px] uppercase font-bold text-secondary-token mb-1">
            <AlertCircle className="w-3 h-3" aria-hidden="true" />
            {t('measurements.topFailures', 'Top motivos de rechazo')}
          </h3>
          <ul className="space-y-1">
            {sortedFailures.map(([reason, count], i) => (
              <li
                key={i}
                data-testid={`measurement-quality-failure-${i}`}
                className="flex justify-between text-[11px] bg-rose-500/5 rounded px-2 py-1"
              >
                <span className="truncate">{reason}</span>
                <span className="tabular-nums font-bold ml-2">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
