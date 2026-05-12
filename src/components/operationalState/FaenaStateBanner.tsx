// Praeventio Guard — Wire UI: <FaenaStateBanner />
//
// Banner top-of-dashboard que muestra el estado operacional consolidado.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, AlertOctagon, AlertTriangle, OctagonAlert, Siren } from 'lucide-react';
import {
  computeFaenaState,
  type FaenaStateInput,
  type FaenaOperationalState,
} from '../../services/operationalState/faenaStateEngine.js';

interface FaenaStateBannerProps {
  input: FaenaStateInput;
  now?: Date;
}

const STATE_STYLES: Record<
  FaenaOperationalState,
  { bg: string; text: string; label: string; icon: typeof Activity }
> = {
  operativa: {
    bg: 'bg-emerald-500/15 border-emerald-500/40',
    text: 'text-emerald-700 dark:text-emerald-300',
    label: 'Operativa',
    icon: Activity,
  },
  restringida: {
    bg: 'bg-amber-500/15 border-amber-500/40',
    text: 'text-amber-700 dark:text-amber-300',
    label: 'Restringida',
    icon: AlertTriangle,
  },
  parcialmente_detenida: {
    bg: 'bg-orange-500/15 border-orange-500/40',
    text: 'text-orange-700 dark:text-orange-300',
    label: 'Parcialmente detenida',
    icon: OctagonAlert,
  },
  detenida: {
    bg: 'bg-rose-500/15 border-rose-500/40',
    text: 'text-rose-700 dark:text-rose-300',
    label: 'Detenida',
    icon: AlertOctagon,
  },
  emergencia: {
    bg: 'bg-red-600/20 border-red-600/60',
    text: 'text-red-700 dark:text-red-300',
    label: 'Emergencia',
    icon: Siren,
  },
};

export function FaenaStateBanner({ input, now }: FaenaStateBannerProps) {
  const { t } = useTranslation();
  const result = useMemo(() => computeFaenaState(input, now), [input, now]);
  const style = STATE_STYLES[result.state];
  const Icon = style.icon;

  return (
    <section
      className={`rounded-2xl border ${style.bg} p-4 shadow-mode space-y-2`}
      data-testid="faena-state-banner"
      data-state={result.state}
      aria-label={t('faenaState.aria', 'Estado operacional de faena') as string}
    >
      <header className="flex items-center gap-2">
        <Icon className={`w-5 h-5 ${style.text}`} aria-hidden="true" />
        <h2
          className={`text-sm font-black uppercase tracking-wide ${style.text}`}
          data-testid="faena-state-label"
        >
          {t(`faenaState.label.${result.state}`, style.label)}
        </h2>
        <span className="ml-auto text-[10px] text-secondary-token">
          {t('faenaState.activePermits', 'Permisos activos')}: {input.activeWorkPermits}
        </span>
      </header>

      <p
        className="text-xs text-primary-token"
        data-testid="faena-state-reason"
      >
        {result.reason}
      </p>

      {result.affectedModules.length > 0 && (
        <ul
          className="flex flex-wrap gap-1"
          data-testid="faena-state-modules"
        >
          {result.affectedModules.map((m) => (
            <li
              key={m}
              className="text-[10px] font-bold px-2 py-0.5 rounded bg-surface-elevated text-secondary-token"
            >
              {t(`faenaState.module.${m}`, m)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
