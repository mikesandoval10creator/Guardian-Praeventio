// Praeventio Guard — Wire UI S44: <OperationalChangeCard />
//
// Tarjeta presentacional para un cambio operacional (MOC). Muestra qué
// cambió, impacto, y progreso de confirmación de lectura. El padre
// computa summary vía summarizeAcknowledgments y lo pasa como prop.

import { GitCompare, AlertCircle, CheckCircle2, Undo2 } from 'lucide-react';
import type {
  OperationalChange,
  ChangeAcknowledgementSummary,
} from '../../services/changeMgmt/operationalChangeService.js';

interface OperationalChangeCardProps {
  change: OperationalChange;
  summary: ChangeAcknowledgementSummary;
}

const IMPACT_TONE: Record<OperationalChange['impact'], string> = {
  low: 'bg-teal-50 text-teal-700 border-teal-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-rose-50 text-rose-700 border-rose-200',
};

const IMPACT_LABEL: Record<OperationalChange['impact'], string> = {
  low: 'Bajo',
  medium: 'Medio',
  high: 'Alto',
};

export function OperationalChangeCard({ change, summary }: OperationalChangeCardProps) {
  const tone = IMPACT_TONE[change.impact];
  const ackPct = summary.coveragePercent;
  const reverted = !!change.revertedAt;

  return (
    <section
      className={`rounded-2xl border p-4 space-y-2 ${tone}`}
      data-testid="changeMgmt.card"
      aria-label="Cambio operacional"
    >
      <header className="flex items-center gap-2">
        {reverted ? (
          <Undo2 className="w-4 h-4" aria-hidden="true" />
        ) : (
          <GitCompare className="w-4 h-4" aria-hidden="true" />
        )}
        <h2 className="text-sm font-bold" data-testid="changeMgmt.card.title">
          {change.whatChanged}
        </h2>
        <span
          className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white/60"
          data-testid="changeMgmt.card.impact"
        >
          {IMPACT_LABEL[change.impact]}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <dt className="uppercase text-slate-500">Tipo</dt>
          <dd className="font-bold" data-testid="changeMgmt.card.kind">
            {change.kind}
          </dd>
        </div>
        <div>
          <dt className="uppercase text-slate-500">Vigencia</dt>
          <dd data-testid="changeMgmt.card.effectiveFrom">
            {new Date(change.effectiveFrom).toLocaleDateString()}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="uppercase text-slate-500">Antes → Después</dt>
          <dd className="text-[11px]" data-testid="changeMgmt.card.delta">
            <span className="line-through opacity-60">{change.previousValue}</span>
            {' → '}
            <span className="font-bold">{change.newValue}</span>
          </dd>
        </div>
      </dl>

      <div
        className="rounded bg-white/70 border border-current/20 p-2 text-[11px]"
        data-testid="changeMgmt.card.ackProgress"
      >
        <div className="flex items-center gap-2">
          {ackPct === 100 ? (
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
          ) : (
            <AlertCircle className="w-3 h-3" aria-hidden="true" />
          )}
          <span className="font-bold">
            {summary.acknowledged}/{summary.totalAffected} confirmaron lectura
          </span>
          <span className="ml-auto">{ackPct}%</span>
        </div>
      </div>

      {reverted && change.revertedReason && (
        <p className="text-[11px]" data-testid="changeMgmt.card.revertedReason">
          Revertido: {change.revertedReason}
        </p>
      )}
    </section>
  );
}
