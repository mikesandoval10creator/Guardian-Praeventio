// Praeventio Guard — Wire UI #71: <ProcessClosePreviewCard />
//
// Preview de XP que recibirá la cuadrilla al cerrar un proceso.
// Muestra fórmula: baseXp × (compliance/100) × (1 + alerts × 0.05)
// Positiva siempre — nunca XP negativo (regla organic).

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PartyPopper, Trophy } from 'lucide-react';
import {
  baseXpForProcessType,
  computeProcessCloseXp,
} from '../../services/organic/processService.js';
import type { Process } from '../../types/organic.js';

interface ProcessClosePreviewCardProps {
  process: Process;
  onConfirmClose?: (finalComplianceScore: number) => void;
}

export function ProcessClosePreviewCard({
  process,
  onConfirmClose,
}: ProcessClosePreviewCardProps) {
  const { t } = useTranslation();
  const [score, setScore] = useState(process.complianceScore);
  const baseXp = baseXpForProcessType(process.type);
  const xp = useMemo(
    () => computeProcessCloseXp(process.type, score, process.alertsResponded),
    [process.type, score, process.alertsResponded],
  );

  return (
    <section
      className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 shadow-mode space-y-3"
      data-testid={`process-close-preview-${process.id}`}
      aria-label={t('process.closePreviewAria', 'Preview cierre proceso') as string}
    >
      <header className="flex items-center gap-2">
        <PartyPopper className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token truncate">{process.name}</h2>
        <span className="ml-auto text-[10px] uppercase text-secondary-token">
          {process.type}
        </span>
      </header>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase text-secondary-token">
          {t('process.complianceScore', 'Compliance final')}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={score}
          onChange={(e) => setScore(Number(e.target.value))}
          data-testid={`process-close-score-${process.id}`}
          className="w-full"
          aria-label={t('process.complianceScore', 'Compliance final') as string}
        />
        <span className="text-xs tabular-nums font-bold text-center">{score}/100</span>
      </label>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-surface rounded p-2" data-testid={`process-close-base-${process.id}`}>
          <p className="text-[10px] uppercase text-secondary-token">
            {t('process.baseXp', 'Base XP')}
          </p>
          <p className="text-xl font-black tabular-nums">{baseXp}</p>
        </div>
        <div className="bg-surface rounded p-2" data-testid={`process-close-alerts-${process.id}`}>
          <p className="text-[10px] uppercase text-secondary-token">
            {t('process.alerts', 'Alertas atendidas')}
          </p>
          <p className="text-xl font-black tabular-nums text-fuchsia-600">
            {process.alertsResponded}
          </p>
        </div>
        <div
          className="bg-emerald-500/20 rounded p-2"
          data-testid={`process-close-final-xp-${process.id}`}
        >
          <p className="text-[10px] uppercase text-secondary-token flex items-center justify-center gap-1">
            <Trophy className="w-3 h-3" aria-hidden="true" />
            {t('process.xpAward', 'XP cuadrilla')}
          </p>
          <p className="text-2xl font-black tabular-nums text-emerald-600">+{xp}</p>
        </div>
      </div>

      <p className="text-[10px] text-secondary-token text-center">
        {t('process.xpFormulaHint', 'Fórmula: baseXp × (compliance/100) × (1 + alertas × 0.05)')}
      </p>

      {onConfirmClose && (
        <button
          type="button"
          onClick={() => onConfirmClose(score)}
          data-testid={`process-close-confirm-${process.id}`}
          className="w-full px-3 py-1.5 rounded bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600"
        >
          {t('process.closeAndCelebrate', 'Cerrar y celebrar')}
        </button>
      )}
    </section>
  );
}
