// Praeventio Guard — Wire UI S45: <RepeatingRiskRadarCard />
//
// Tarjeta presentacional para el radar de patrones repetidos
// (F.13). El padre computa el reporte vía buildRepeatingRiskRadar
// y pasa el resultado como prop. SOLO ASISTE — NO BLOQUEA.

import { Radar, AlertTriangle } from 'lucide-react';
import type { RadarReport } from '../../services/riskRadar/repeatingRiskRadar.js';

interface RepeatingRiskRadarCardProps {
  report: RadarReport;
  /** Máximo de patrones a renderizar (default 6). */
  maxItems?: number;
}

const SEVERITY_TONE: Record<RadarReport['maxSeverity'], string> = {
  low: 'bg-teal-50 text-teal-700 border-teal-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  critical: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function RepeatingRiskRadarCard({
  report,
  maxItems = 6,
}: RepeatingRiskRadarCardProps) {
  const visible = report.patterns.slice(0, maxItems);
  const tone = SEVERITY_TONE[report.maxSeverity];

  return (
    <section
      className={`rounded-2xl border p-4 space-y-3 ${tone}`}
      data-testid="riskRadar.card"
      aria-label="Radar de riesgos repetidos"
    >
      <header className="flex items-center gap-2">
        <Radar className="w-4 h-4" aria-hidden="true" />
        <h2 className="text-sm font-black uppercase tracking-wide">
          Radar de riesgos repetidos
        </h2>
        <span
          className="ml-auto text-[10px] font-bold uppercase"
          data-testid="riskRadar.totalPatterns"
        >
          {report.totalPatterns} patrón(es)
        </span>
      </header>

      <p className="text-[11px] opacity-80">
        Ventana {report.windowDays}d · {report.consideredIncidents} incidente(s)
        considerados · severidad máx <strong>{report.maxSeverity}</strong>
      </p>

      {visible.length === 0 ? (
        <p
          className="text-xs italic opacity-70"
          data-testid="riskRadar.empty"
        >
          Sin patrones detectados en la ventana actual.
        </p>
      ) : (
        <ul className="space-y-1" data-testid="riskRadar.list">
          {visible.map((p) => (
            <li
              key={p.id}
              data-testid={`riskRadar.item.${p.id}`}
              className="flex items-start gap-2 text-xs p-2 rounded bg-white/60"
            >
              {p.severity === 'critical' && (
                <AlertTriangle
                  className="w-3 h-3 text-rose-600 mt-0.5"
                  aria-hidden="true"
                />
              )}
              <div className="flex-1">
                <p className="font-bold">{p.label}</p>
                <p className="text-[10px] opacity-70">
                  {p.occurrences} ocurrencia(s) · {p.recommendedAction}
                </p>
              </div>
              <span className="text-[10px] uppercase font-black tabular-nums">
                {p.severity}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
