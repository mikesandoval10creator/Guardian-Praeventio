// Praeventio Guard — Wire UI #61: <EvacuationStatusBoard />
//
// Tablero de evacuación en tiempo real: % cobertura + lista de
// safe vs missing + tiempo transcurrido. Crítico en emergencias.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, AlertOctagon, CheckCheck, Clock } from 'lucide-react';
import {
  computeStatus,
  type EvacuationDrill,
} from '../../services/evacuation/evacuationHeadcount.js';

interface EvacuationStatusBoardProps {
  drill: EvacuationDrill;
  now?: Date;
}

function formatElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function EvacuationStatusBoard({ drill, now }: EvacuationStatusBoardProps) {
  const { t } = useTranslation();
  const status = useMemo(() => computeStatus(drill, now), [drill, now]);

  const coverageTone =
    status.coveragePercent >= 100
      ? 'bg-emerald-500'
      : status.coveragePercent >= 80
        ? 'bg-amber-500'
        : 'bg-rose-500';

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid={`evacuation-board-${drill.id}`}
      aria-label={t('evacuation.aria.board', 'Tablero evacuación') as string}
    >
      <header className="flex items-center gap-2">
        <Users className="w-4 h-4 text-rose-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {drill.kind === 'real' ? (
            <span className="text-rose-600">
              {t('evacuation.real', 'EMERGENCIA REAL')}
            </span>
          ) : (
            t('evacuation.drill', 'Simulacro')
          )}
        </h2>
        <span
          className="ml-auto flex items-center gap-1 text-[10px] text-secondary-token tabular-nums"
          data-testid={`evacuation-elapsed-${drill.id}`}
        >
          <Clock className="w-3 h-3" aria-hidden="true" />
          {formatElapsed(status.elapsedSec)}
        </span>
      </header>

      <div>
        <div className="flex justify-between text-[10px] mb-1">
          <span className="uppercase font-bold">
            {t('evacuation.coverage', 'Cobertura')}
          </span>
          <span className="tabular-nums font-bold" data-testid={`evacuation-coverage-${drill.id}`}>
            {status.coveragePercent}%
          </span>
        </div>
        <div className="h-2 bg-surface-elevated rounded overflow-hidden">
          <div
            className={`h-full ${coverageTone}`}
            style={{ width: `${status.coveragePercent}%` }}
            data-testid={`evacuation-coverage-bar-${drill.id}`}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-emerald-500/10 rounded p-2" data-testid={`evacuation-safe-${drill.id}`}>
          <div className="flex items-center gap-1 text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-300 mb-1">
            <CheckCheck className="w-3 h-3" aria-hidden="true" />
            {t('evacuation.safe', 'Seguros')} ({status.safe.length})
          </div>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {status.safe.map((w) => (
              <li
                key={w.uid}
                className="text-[11px] truncate"
                data-testid={`evacuation-safe-${w.uid}`}
              >
                ✓ {w.fullName}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-rose-500/10 rounded p-2" data-testid={`evacuation-missing-${drill.id}`}>
          <div className="flex items-center gap-1 text-[10px] uppercase font-bold text-rose-700 dark:text-rose-300 mb-1">
            <AlertOctagon className="w-3 h-3" aria-hidden="true" />
            {t('evacuation.missing', 'Faltan')} ({status.missing.length})
          </div>
          <ul className="space-y-0.5 max-h-32 overflow-y-auto">
            {status.missing.map((w) => (
              <li
                key={w.uid}
                className="text-[11px] truncate"
                data-testid={`evacuation-missing-${w.uid}`}
              >
                ? {w.fullName}
                {w.lastKnownLocation && (
                  <span className="text-[9px] text-secondary-token ml-1">
                    ({w.lastKnownLocation.lat.toFixed(3)}, {w.lastKnownLocation.lng.toFixed(3)})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {status.isComplete && (
        <p
          className="text-[11px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 p-2 rounded font-bold text-center"
          data-testid={`evacuation-complete-${drill.id}`}
        >
          {t('evacuation.complete', 'Todos seguros — drill puede cerrarse.')}
        </p>
      )}
    </section>
  );
}
