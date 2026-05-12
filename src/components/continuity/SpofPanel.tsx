// Praeventio Guard — Wire UI #34: <SpofPanel />
//
// Panel de Single Points of Failure detectados con mitigaciones.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { User, Wrench, Truck, FileText, AlertOctagon, Key } from 'lucide-react';
import {
  detectSPOFs,
  type ContinuityInput,
  type SpofKind,
} from '../../services/continuity/continuityPlanning.js';

interface SpofPanelProps {
  input: ContinuityInput;
  onMitigateClick?: (kind: SpofKind, id: string) => void;
}

const KIND_ICON: Record<SpofKind, typeof User> = {
  person: User,
  equipment: Wrench,
  supplier: Truck,
  document: FileText,
  permit: Key,
};

const KIND_LABEL: Record<SpofKind, string> = {
  person: 'Persona',
  equipment: 'Equipo',
  supplier: 'Proveedor',
  document: 'Documento',
  permit: 'Permiso',
};

export function SpofPanel({ input, onMitigateClick }: SpofPanelProps) {
  const { t } = useTranslation();
  const spofs = useMemo(() => detectSPOFs(input), [input]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
      data-testid="spof-panel"
      aria-label={t('spof.aria', 'Puntos únicos de falla') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <AlertOctagon className="w-4 h-4 text-rose-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('spof.title', 'Puntos Únicos de Falla')}
        </h2>
        <span className="ml-auto text-xs text-secondary-token">{spofs.length}</span>
      </header>

      {spofs.length === 0 ? (
        <p className="text-xs text-secondary-token italic text-center" data-testid="spof-empty">
          {t('spof.empty', 'Sin SPOFs detectados — sistema robusto.')}
        </p>
      ) : (
        <ul className="space-y-2">
          {spofs.map((s) => {
            const Icon = KIND_ICON[s.kind];
            return (
              <li
                key={`${s.kind}-${s.id}`}
                data-testid={`spof-${s.kind}-${s.id}`}
                className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-2.5"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Icon
                    className="w-3 h-3 text-rose-600 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="text-[10px] font-bold uppercase opacity-80">
                    {KIND_LABEL[s.kind]}
                  </span>
                  <span className="text-xs font-bold text-primary-token flex-1 truncate">
                    {s.label}
                  </span>
                </div>
                {s.dependentTasks.length > 0 && (
                  <p className="text-[10px] text-secondary-token mb-1">
                    {t('spof.dependent', 'Tareas dependientes:')}{' '}
                    <strong>{s.dependentTasks.length}</strong>
                  </p>
                )}
                <p className="text-[11px] text-rose-700 dark:text-rose-300 leading-snug">
                  {s.mitigation}
                </p>
                <div className="flex gap-1 mt-1.5 flex-wrap">
                  {s.impactScopes.map((scope) => (
                    <span
                      key={scope}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-700 dark:text-rose-300 uppercase font-bold"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
                {onMitigateClick && (
                  <button
                    type="button"
                    onClick={() => onMitigateClick(s.kind, s.id)}
                    data-testid={`spof-mitigate-${s.kind}-${s.id}`}
                    className="text-[11px] font-bold text-rose-700 dark:text-rose-300 underline mt-1"
                  >
                    {t('spof.startMitigation', 'Iniciar mitigación →')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
