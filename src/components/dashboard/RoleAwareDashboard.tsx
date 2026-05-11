// Praeventio Guard — Wire UI #1: <RoleAwareDashboard />
//
// Renders the home cards for a given user, choosing the correct set
// (worker / site_chief / prevention / management) via `buildRoleView`.
// Owns no state: consumer passes the consolidated `RoleViewState`.
//
// Used in: Dashboard.tsx top section, replacing static widget mix.

import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import {
  buildRoleView,
  type RoleViewState,
  type RoleCard,
} from '../../services/roleViews/roleViewBuilder.js';

interface RoleAwareDashboardProps {
  state: RoleViewState;
  onCardAction?: (card: RoleCard) => void;
}

const SEVERITY_CLASS: Record<RoleCard['severity'], string> = {
  info: 'bg-sky-500/5 border-sky-500/30 text-sky-700 dark:text-sky-300',
  action_required:
    'bg-amber-500/5 border-amber-500/30 text-amber-700 dark:text-amber-300',
  urgent: 'bg-rose-500/5 border-rose-500/30 text-rose-700 dark:text-rose-300',
};

const SEVERITY_ICON: Record<RoleCard['severity'], typeof Info> = {
  info: Info,
  action_required: AlertTriangle,
  urgent: AlertCircle,
};

export function RoleAwareDashboard({ state, onCardAction }: RoleAwareDashboardProps) {
  const { t } = useTranslation();
  const cards = buildRoleView(state);

  if (cards.length === 0) {
    return (
      <div className="rounded-2xl border border-default-token bg-surface p-6 text-center text-secondary-token">
        <p className="text-sm">
          {t('role_dashboard.empty', 'Nada pendiente — buen trabajo 👍')}
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label={t('role_dashboard.aria', 'Tarjetas según rol') as string}
      data-testid="role-aware-dashboard"
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
    >
      {cards.map((card) => {
        const Icon = SEVERITY_ICON[card.severity];
        return (
          <article
            key={card.id}
            className={`rounded-2xl border p-4 ${SEVERITY_CLASS[card.severity]} flex flex-col gap-2`}
            data-testid={`role-card-${card.id}`}
          >
            <header className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-bold leading-tight">{card.title}</h3>
              <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            </header>
            <p className="text-xs opacity-90 leading-snug">{card.body}</p>
            {card.primaryAction && (
              <button
                type="button"
                onClick={() => onCardAction?.(card)}
                className="self-start mt-1 px-3 py-1 rounded-md bg-white/40 dark:bg-black/20 text-xs font-semibold hover:brightness-110 transition-all"
                data-testid={`role-card-action-${card.id}`}
              >
                {card.primaryAction.label}
              </button>
            )}
          </article>
        );
      })}
    </section>
  );
}
