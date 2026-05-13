// Praeventio Guard — Wire UI S45: <RequirementGatePanel />
//
// Panel presentacional para la decisión de un gate de requisitos
// (soft-blocking). Directiva 2: NUNCA bloquea, sólo informa y permite
// override con justificación. El padre llama a `evaluateGate` y pasa
// la decisión como prop.

import { CheckCircle2, AlertTriangle, ShieldOff } from 'lucide-react';
import type { GateDecision } from '../../services/softBlocking/requirementGate.js';

interface RequirementGatePanelProps {
  decision: GateDecision;
  /** Callback opcional para iniciar el flujo de override. */
  onRequestOverride?: () => void;
}

const LEVEL_META: Record<
  GateDecision['level'],
  { label: string; tone: string; Icon: typeof CheckCircle2 }
> = {
  pass: {
    label: 'Todos los requisitos cumplidos',
    tone: 'bg-teal-50 text-teal-700 border-teal-200',
    Icon: CheckCircle2,
  },
  soft_block: {
    label: 'Requisitos pendientes — override permitido',
    tone: 'bg-amber-50 text-amber-700 border-amber-200',
    Icon: AlertTriangle,
  },
  cannot_override: {
    label: 'Requisito crítico — escalar a supervisor',
    tone: 'bg-rose-50 text-rose-700 border-rose-200',
    Icon: ShieldOff,
  },
};

export function RequirementGatePanel({
  decision,
  onRequestOverride,
}: RequirementGatePanelProps) {
  const meta = LEVEL_META[decision.level];
  const { Icon } = meta;

  return (
    <section
      className={`rounded-2xl border p-4 space-y-3 ${meta.tone}`}
      data-testid="softBlocking.panel"
      aria-label="Panel de requisitos previos"
    >
      <header className="flex items-center gap-2">
        <Icon className="w-4 h-4" aria-hidden="true" />
        <h2
          className="text-sm font-black uppercase tracking-wide"
          data-testid="softBlocking.levelLabel"
        >
          {meta.label}
        </h2>
      </header>

      {decision.unsatisfied.length > 0 && (
        <ul
          className="space-y-1"
          data-testid="softBlocking.unsatisfiedList"
        >
          {decision.unsatisfied.map((c) => (
            <li
              key={c.requirement.id}
              data-testid={`softBlocking.unsatisfied.${c.requirement.id}`}
              className="text-xs p-2 rounded bg-white/60"
            >
              <p className="font-bold">
                {c.requirement.isMandatory ? '[OBLIGATORIO] ' : '[recomendado] '}
                {c.requirement.label}
              </p>
              <p className="text-[10px] opacity-70">
                Estado: <strong>{c.status}</strong>
                {c.requirement.citation ? ` · ${c.requirement.citation}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}

      {decision.canOverride && onRequestOverride && (
        <button
          type="button"
          onClick={onRequestOverride}
          data-testid="softBlocking.overrideBtn"
          className="px-3 py-1.5 rounded-lg bg-white/80 text-amber-900 text-xs font-bold border border-amber-300 hover:bg-white"
        >
          Solicitar override con justificación
        </button>
      )}
    </section>
  );
}
