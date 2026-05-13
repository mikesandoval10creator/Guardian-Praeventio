// Praeventio Guard — Wire UI S43: <LoneWorkerCard />
//
// Tarjeta presentacional para una sesión de trabajo solitario. Muestra
// estado derivado, último check-in y escalamiento sugerido. El padre
// computa el estado vía deriveLoneWorkerStatus/decideEscalation y pasa
// los resultados como props.

import { UserCheck, AlertTriangle, Siren, Clock } from 'lucide-react';
import type {
  LoneWorkerSession,
  LoneWorkerStatus,
  EscalationDecision,
} from '../../services/loneWorker/loneWorkerService.js';

interface LoneWorkerCardProps {
  session: LoneWorkerSession;
  status: LoneWorkerStatus;
  escalation?: EscalationDecision | null;
}

const STATUS_META: Record<
  LoneWorkerStatus,
  { label: string; tone: string; Icon: typeof UserCheck }
> = {
  active: {
    label: 'Activo',
    tone: 'bg-teal-50 text-teal-700 border-teal-200',
    Icon: UserCheck,
  },
  overdue_warning: {
    label: 'Sin check-in (aviso)',
    tone: 'bg-amber-50 text-amber-700 border-amber-200',
    Icon: Clock,
  },
  overdue_critical: {
    label: 'Sin check-in (crítico)',
    tone: 'bg-rose-50 text-rose-700 border-rose-200',
    Icon: AlertTriangle,
  },
  help_requested: {
    label: 'Pidió ayuda',
    tone: 'bg-rose-50 text-rose-800 border-rose-300',
    Icon: Siren,
  },
  ended: {
    label: 'Finalizada',
    tone: 'bg-slate-50 text-slate-600 border-slate-200',
    Icon: UserCheck,
  },
};

export function LoneWorkerCard({ session, status, escalation }: LoneWorkerCardProps) {
  const meta = STATUS_META[status];
  const { Icon } = meta;
  const last = session.checkIns[session.checkIns.length - 1];

  return (
    <section
      className={`rounded-2xl border p-4 space-y-2 ${meta.tone}`}
      data-testid="loneWorker.card"
      aria-label="Sesión trabajo solitario"
    >
      <header className="flex items-center gap-2">
        <Icon className="w-4 h-4" aria-hidden="true" />
        <h2 className="text-sm font-bold" data-testid="loneWorker.card.title">
          Trabajador {session.workerUid}
        </h2>
        <span
          className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-white/60"
          data-testid="loneWorker.card.status"
        >
          {meta.label}
        </span>
      </header>

      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <div>
          <dt className="uppercase text-slate-500">Intervalo</dt>
          <dd className="font-bold" data-testid="loneWorker.card.interval">
            {session.checkInIntervalMin} min
          </dd>
        </div>
        <div>
          <dt className="uppercase text-slate-500">Check-ins</dt>
          <dd className="font-bold" data-testid="loneWorker.card.checkIns">
            {session.checkIns.length}
          </dd>
        </div>
      </dl>

      {last && (
        <p className="text-[11px] text-slate-600" data-testid="loneWorker.card.last">
          Último: {new Date(last.at).toLocaleString()} · {last.status}
        </p>
      )}

      {escalation && (
        <div
          className="rounded bg-white/70 border border-current/20 p-2 text-[11px]"
          data-testid="loneWorker.card.escalation"
        >
          <p className="font-bold uppercase">Escalar → {escalation.level}</p>
          <p>{escalation.message}</p>
        </div>
      )}
    </section>
  );
}
