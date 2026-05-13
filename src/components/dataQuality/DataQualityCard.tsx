// Praeventio Guard — Wire UI S43: <DataQualityCard />
//
// Tarjeta presentacional con el reporte de calidad de datos (gaps en
// dominios principales). El padre llama scanAll() y pasa el reporte +
// los topGaps como props.

import { Database, AlertCircle, Gauge } from 'lucide-react';
import type {
  DataQualityReport,
  Gap,
} from '../../services/dataQuality/incompletenessScanner.js';

interface DataQualityCardProps {
  report: DataQualityReport;
  topGaps?: Gap[];
}

const SEVERITY_TONE: Record<Gap['severity'], string> = {
  high: 'bg-rose-50 text-rose-700 border-rose-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-50 text-slate-700 border-slate-200',
};

export function DataQualityCard({ report, topGaps }: DataQualityCardProps) {
  const scoreTone =
    report.qualityScore >= 80
      ? 'text-teal-700 bg-teal-50 border-teal-200'
      : report.qualityScore >= 50
        ? 'text-amber-700 bg-amber-50 border-amber-200'
        : 'text-rose-700 bg-rose-50 border-rose-200';

  return (
    <section
      className="rounded-2xl border border-teal-200 bg-white p-4 space-y-3"
      data-testid="dataQuality.card"
      aria-label="Calidad de datos"
    >
      <header className="flex items-center gap-2">
        <Database className="w-4 h-4 text-teal-600" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-800" data-testid="dataQuality.card.title">
          Calidad de datos
        </h2>
        <span
          className={`ml-auto inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded border ${scoreTone}`}
          data-testid="dataQuality.card.score"
        >
          <Gauge className="w-3 h-3" aria-hidden="true" />
          {report.qualityScore}/100
        </span>
      </header>

      <div className="grid grid-cols-4 gap-2 text-center">
        <div className="rounded bg-teal-50 border border-teal-200 p-2" data-testid="dataQuality.card.totalGaps">
          <p className="text-[9px] uppercase text-teal-700 font-bold">Total gaps</p>
          <p className="text-sm font-black text-teal-800">{report.totalGaps}</p>
        </div>
        <div className="rounded bg-rose-50 border border-rose-200 p-2" data-testid="dataQuality.card.high">
          <p className="text-[9px] uppercase text-rose-700 font-bold">Alta</p>
          <p className="text-sm font-black text-rose-800">{report.bySeverity.high}</p>
        </div>
        <div className="rounded bg-amber-50 border border-amber-200 p-2" data-testid="dataQuality.card.medium">
          <p className="text-[9px] uppercase text-amber-700 font-bold">Media</p>
          <p className="text-sm font-black text-amber-800">{report.bySeverity.medium}</p>
        </div>
        <div className="rounded bg-slate-50 border border-slate-200 p-2" data-testid="dataQuality.card.low">
          <p className="text-[9px] uppercase text-slate-600 font-bold">Baja</p>
          <p className="text-sm font-black text-slate-800">{report.bySeverity.low}</p>
        </div>
      </div>

      {topGaps && topGaps.length > 0 && (
        <div data-testid="dataQuality.card.topGaps">
          <h3 className="flex items-center gap-1 text-[10px] uppercase font-bold text-slate-600 mb-1">
            <AlertCircle className="w-3 h-3" aria-hidden="true" />
            Gaps prioritarios
          </h3>
          <ul className="space-y-1">
            {topGaps.map((g, i) => (
              <li
                key={`${g.docId}-${g.field}-${i}`}
                className={`text-[11px] px-2 py-1 rounded border ${SEVERITY_TONE[g.severity]}`}
                data-testid={`dataQuality.card.gap.${i}`}
              >
                <span className="font-bold">[{g.domain}]</span> {g.field}: {g.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
