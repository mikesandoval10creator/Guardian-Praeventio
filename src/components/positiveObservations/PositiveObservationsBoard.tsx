// Praeventio Guard — Wire UI #42: <PositiveObservationsBoard />
//
// Board de observaciones positivas con balance positivas vs correctivas
// y ranking de workers reconocidos.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ThumbsUp, Award, Heart } from 'lucide-react';
import {
  computeBalance,
  buildRecognitionStats,
  type PositiveObservation,
} from '../../services/positiveObservations/positiveObservationsService.js';

interface PositiveObservationsBoardProps {
  observations: PositiveObservation[];
  correctiveCount: number;
  onWorkerClick?: (workerUid: string) => void;
}

const KIND_LABEL: Record<PositiveObservation['kind'], string> = {
  safe_behavior: 'Comportamiento seguro',
  improvement_idea: 'Mejora propuesta',
  helpful_intervention: 'Intervención útil',
  creative_workaround: 'Solución creativa',
  mentoring_action: 'Mentoría',
};

const LEVEL_CLASS = {
  punitive: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
  imbalanced: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  balanced: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  positive_skew: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
};

export function PositiveObservationsBoard({
  observations,
  correctiveCount,
  onWorkerClick,
}: PositiveObservationsBoardProps) {
  const { t } = useTranslation();
  const balance = useMemo(
    () =>
      computeBalance({ positiveCount: observations.length, correctiveCount }),
    [observations.length, correctiveCount],
  );
  const recognitions = useMemo(() => buildRecognitionStats(observations), [observations]);

  return (
    <section
      className="space-y-3"
      data-testid="positive-obs-board"
      aria-label={t('positiveObs.aria', 'Board observaciones positivas') as string}
    >
      {/* Balance card */}
      <div
        className={`rounded-2xl border-2 p-4 shadow-mode ${LEVEL_CLASS[balance.level]}`}
        data-testid="positive-obs-balance"
      >
        <header className="flex items-center gap-2 mb-2">
          <Heart className="w-4 h-4" aria-hidden="true" />
          <h2 className="text-sm font-black uppercase tracking-wide">
            {t('positiveObs.balance', 'Balance cultura')}
          </h2>
          <span className="ml-auto text-xs uppercase font-bold">{balance.level}</span>
        </header>
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1">
            <p className="text-[10px] uppercase opacity-70">{t('positiveObs.positives', 'Positivas')}</p>
            <p className="text-2xl font-black tabular-nums" data-testid="positive-count">
              {observations.length}
            </p>
          </div>
          <div className="flex-1">
            <p className="text-[10px] uppercase opacity-70">{t('positiveObs.correctives', 'Correctivas')}</p>
            <p className="text-2xl font-black tabular-nums" data-testid="corrective-count">
              {correctiveCount}
            </p>
          </div>
          <div className="flex-1">
            <p className="text-[10px] uppercase opacity-70">{t('positiveObs.ratio', 'Ratio')}</p>
            <p className="text-xl font-black tabular-nums">
              {Math.round(balance.positiveRatio * 100)}%
            </p>
          </div>
        </div>
        <p className="text-[11px] opacity-85">{balance.message}</p>
      </div>

      {/* Recognitions ranking */}
      <div
        className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
        data-testid="positive-obs-recognitions"
      >
        <header className="flex items-center gap-2 mb-2">
          <Award className="w-4 h-4 text-emerald-500" aria-hidden="true" />
          <h3 className="text-sm font-black text-primary-token uppercase tracking-wide">
            {t('positiveObs.recognitionRank', 'Top reconocidos')}
          </h3>
        </header>
        {recognitions.length === 0 ? (
          <p className="text-xs text-secondary-token italic">
            {t('positiveObs.noRecognitions', 'Sin reconocimientos registrados.')}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {recognitions.slice(0, 5).map((r, idx) => (
              <li key={r.workerUid}>
                <button
                  type="button"
                  onClick={() => onWorkerClick?.(r.workerUid)}
                  disabled={!onWorkerClick}
                  data-testid={`positive-recognition-${r.workerUid}`}
                  className={`w-full text-left flex items-center gap-2 p-2 rounded ${onWorkerClick ? 'hover:bg-surface-elevated' : ''} bg-emerald-500/5`}
                >
                  <span className="text-xs font-bold w-5 text-emerald-700 dark:text-emerald-300 tabular-nums">
                    #{idx + 1}
                  </span>
                  <ThumbsUp className="w-3 h-3 text-emerald-500" aria-hidden="true" />
                  <span className="text-xs flex-1 truncate font-bold">{r.workerUid}</span>
                  <span className="text-xs font-black tabular-nums">
                    {r.positiveObservationCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recent observations */}
      {observations.length > 0 && (
        <div
          className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode"
          data-testid="positive-obs-recent"
        >
          <h3 className="text-xs font-bold text-primary-token uppercase mb-2">
            {t('positiveObs.recent', 'Observaciones recientes')}
          </h3>
          <ul className="space-y-1.5 max-h-48 overflow-y-auto">
            {observations.slice(0, 8).map((o) => (
              <li
                key={o.id}
                data-testid={`positive-obs-${o.id}`}
                className="flex items-start gap-2 text-xs p-1.5 rounded bg-surface-elevated"
              >
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 shrink-0">
                  {KIND_LABEL[o.kind]}
                </span>
                <span className="flex-1 min-w-0 text-secondary-token">{o.description}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
