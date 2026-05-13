// Praeventio Guard — Wire UI S44: <WorkerReadinessCard />
//
// Tarjeta presentacional para el score de preparación de un trabajador.
// SOLO ASISTE — NO BLOQUEA (Directiva 2). El padre computa el reporte
// vía computeReadiness y lo pasa como prop.

import { ShieldCheck, ShieldAlert, Activity } from 'lucide-react';
import type { ReadinessReport } from '../../services/workerReadiness/readinessScore.js';

interface WorkerReadinessCardProps {
  report: ReadinessReport;
}

const LEVEL_META: Record<
  ReadinessReport['level'],
  { label: string; tone: string; Icon: typeof ShieldCheck }
> = {
  ready: {
    label: 'Preparado',
    tone: 'bg-teal-50 text-teal-700 border-teal-200',
    Icon: ShieldCheck,
  },
  minor_gaps: {
    label: 'Brechas menores',
    tone: 'bg-teal-50 text-teal-700 border-teal-200',
    Icon: Activity,
  },
  major_gaps: {
    label: 'Brechas mayores',
    tone: 'bg-amber-50 text-amber-700 border-amber-200',
    Icon: ShieldAlert,
  },
  critical_gaps: {
    label: 'Brechas críticas',
    tone: 'bg-rose-50 text-rose-700 border-rose-200',
    Icon: ShieldAlert,
  },
};

export function WorkerReadinessCard({ report }: WorkerReadinessCardProps) {
  const meta = LEVEL_META[report.level];
  const { Icon } = meta;

  return (
    <section
      className={`rounded-2xl border p-4 space-y-2 ${meta.tone}`}
      data-testid="workerReadiness.card"
      aria-label="Score preparación trabajador"
    >
      <header className="flex items-center gap-2">
        <Icon className="w-4 h-4" aria-hidden="true" />
        <h2 className="text-sm font-bold" data-testid="workerReadiness.card.title">
          Trabajador {report.workerUid}
        </h2>
        <span
          className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white/60"
          data-testid="workerReadiness.card.level"
        >
          {meta.label}
        </span>
      </header>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold" data-testid="workerReadiness.card.score">
          {report.score}
        </span>
        <span className="text-[11px] text-slate-500">/ 100</span>
        <span
          className="ml-auto text-[11px] text-slate-600"
          data-testid="workerReadiness.card.category"
        >
          {report.taskCategory}
        </span>
      </div>

      <dl className="grid grid-cols-3 gap-1 text-[10px]">
        <div>
          <dt className="uppercase text-slate-500">Capac.</dt>
          <dd className="font-bold" data-testid="workerReadiness.card.sub.trainings">
            {report.subScores.trainings}
          </dd>
        </div>
        <div>
          <dt className="uppercase text-slate-500">EPP</dt>
          <dd className="font-bold" data-testid="workerReadiness.card.sub.epp">
            {report.subScores.epp}
          </dd>
        </div>
        <div>
          <dt className="uppercase text-slate-500">Médica</dt>
          <dd className="font-bold" data-testid="workerReadiness.card.sub.medical">
            {report.subScores.medical}
          </dd>
        </div>
      </dl>

      {report.gaps.length > 0 && (
        <ul
          className="text-[11px] space-y-1"
          data-testid="workerReadiness.card.gaps"
        >
          {report.gaps.slice(0, 3).map((g, i) => (
            <li key={i} className="flex gap-1">
              <span className="font-bold uppercase">{g.kind}:</span>
              <span>{g.description}</span>
            </li>
          ))}
        </ul>
      )}

      <p
        className="text-[10px] italic text-slate-500"
        data-testid="workerReadiness.card.disclaimer"
      >
        Asiste al supervisor — no bloquea operación.
      </p>
    </section>
  );
}
