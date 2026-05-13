// Praeventio Guard — Wire UI S43: <RoleViewCards />
//
// Render presentacional de las tarjetas por rol. El padre llama
// buildRoleView() con el estado consolidado y pasa el array de
// RoleCard como prop.

import { ChevronRight, Info, AlertTriangle, Siren } from 'lucide-react';
import type { RoleCard, UserRole } from '../../services/roleViews/roleViewBuilder.js';

interface RoleViewCardsProps {
  role: UserRole;
  cards: RoleCard[];
  onAction?: (card: RoleCard) => void;
}

const SEVERITY_TONE: Record<RoleCard['severity'], { tone: string; Icon: typeof Info }> = {
  info: {
    tone: 'bg-teal-50 border-teal-200 text-teal-800',
    Icon: Info,
  },
  action_required: {
    tone: 'bg-amber-50 border-amber-200 text-amber-800',
    Icon: AlertTriangle,
  },
  urgent: {
    tone: 'bg-rose-50 border-rose-300 text-rose-800',
    Icon: Siren,
  },
};

const ROLE_LABEL: Record<UserRole, string> = {
  worker: 'Trabajador',
  site_chief: 'Jefe de Terreno',
  prevention: 'Prevencionista',
  management: 'Gerencia',
};

export function RoleViewCards({ role, cards, onAction }: RoleViewCardsProps) {
  return (
    <section
      className="space-y-3"
      data-testid="roleViews.cards"
      aria-label={`Tarjetas para ${ROLE_LABEL[role]}`}
    >
      <header className="flex items-center gap-2">
        <h2
          className="text-sm font-bold text-teal-700 uppercase tracking-wide"
          data-testid="roleViews.cards.title"
        >
          Vista · {ROLE_LABEL[role]}
        </h2>
        <span
          className="ml-auto text-[10px] font-bold bg-teal-50 text-teal-700 px-2 py-0.5 rounded border border-teal-200"
          data-testid="roleViews.cards.count"
        >
          {cards.length} tarjetas
        </span>
      </header>

      {cards.length === 0 && (
        <p
          className="text-[12px] text-slate-500 italic p-4 bg-slate-50 rounded border border-slate-200"
          data-testid="roleViews.cards.empty"
        >
          Sin tarjetas para mostrar.
        </p>
      )}

      <ul className="space-y-2">
        {cards.map((card) => {
          const meta = SEVERITY_TONE[card.severity];
          const { Icon } = meta;
          return (
            <li key={card.id}>
              <article
                className={`rounded-xl border p-3 ${meta.tone}`}
                data-testid={`roleViews.cards.item.${card.id}`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <h3 className="text-[13px] font-bold flex-1">{card.title}</h3>
                  {typeof card.count === 'number' && (
                    <span
                      className="text-[10px] font-black bg-white/70 px-1.5 py-0.5 rounded"
                      data-testid={`roleViews.cards.item.${card.id}.count`}
                    >
                      {card.count}
                    </span>
                  )}
                </div>
                <p className="text-[11px] mt-1 opacity-90">{card.body}</p>
                {card.primaryAction && (
                  <button
                    type="button"
                    onClick={() => onAction?.(card)}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold underline"
                    data-testid={`roleViews.cards.item.${card.id}.action`}
                  >
                    {card.primaryAction.label}
                    <ChevronRight className="w-3 h-3" aria-hidden="true" />
                  </button>
                )}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
