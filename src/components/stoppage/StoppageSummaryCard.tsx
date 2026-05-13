// Praeventio Guard — Wire UI S43: <StoppageSummaryCard />
//
// Tarjeta presentacional que resume el estado de paralizaciones en
// curso. El padre calcula StoppageSummary vía summarize() y lo pasa
// como prop. Componente puro.

import { OctagonAlert, PauseCircle, CheckCircle2, Ban, Clock } from 'lucide-react';
import type { StoppageSummary } from '../../services/stoppage/stoppageEngine.js';

interface StoppageSummaryCardProps {
  summary: StoppageSummary;
  projectLabel?: string;
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
  testid,
}: {
  icon: typeof OctagonAlert;
  label: string;
  value: number | string;
  tone: string;
  testid: string;
}) {
  return (
    <div
      className={`rounded-lg border p-2 flex items-center gap-2 ${tone}`}
      data-testid={testid}
    >
      <Icon className="w-4 h-4" aria-hidden="true" />
      <div className="flex flex-col">
        <span className="text-[9px] uppercase font-bold opacity-80">{label}</span>
        <span className="text-sm font-black leading-none">{value}</span>
      </div>
    </div>
  );
}

export function StoppageSummaryCard({ summary, projectLabel }: StoppageSummaryCardProps) {
  const hasActive = summary.active + summary.pendingResumption > 0;
  return (
    <section
      className={`rounded-2xl border p-4 space-y-3 ${
        hasActive ? 'border-rose-300 bg-rose-50' : 'border-teal-200 bg-teal-50'
      }`}
      data-testid="stoppage.card"
      aria-label="Resumen paralizaciones"
    >
      <header className="flex items-center gap-2">
        <OctagonAlert
          className={`w-4 h-4 ${hasActive ? 'text-rose-700' : 'text-teal-700'}`}
          aria-hidden="true"
        />
        <h2 className="text-sm font-bold text-slate-800" data-testid="stoppage.card.title">
          Paralizaciones {projectLabel ? `· ${projectLabel}` : ''}
        </h2>
        <span
          className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded bg-white/70"
          data-testid="stoppage.card.total"
        >
          Total: {summary.total}
        </span>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat
          icon={PauseCircle}
          label="Activas"
          value={summary.active}
          tone="bg-rose-100 text-rose-800 border-rose-200"
          testid="stoppage.card.active"
        />
        <Stat
          icon={Clock}
          label="Pend. reanudación"
          value={summary.pendingResumption}
          tone="bg-amber-50 text-amber-800 border-amber-200"
          testid="stoppage.card.pending"
        />
        <Stat
          icon={CheckCircle2}
          label="Reanudadas"
          value={summary.resumed}
          tone="bg-teal-100 text-teal-800 border-teal-200"
          testid="stoppage.card.resumed"
        />
        <Stat
          icon={Ban}
          label="Canceladas"
          value={summary.cancelled}
          tone="bg-slate-100 text-slate-700 border-slate-200"
          testid="stoppage.card.cancelled"
        />
      </div>

      <p className="text-[11px] text-slate-600" data-testid="stoppage.card.longest">
        Más larga activa: <span className="font-bold">{summary.longestActiveHours.toFixed(1)} h</span>
      </p>
    </section>
  );
}
