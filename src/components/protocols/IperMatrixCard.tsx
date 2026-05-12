// Praeventio Guard — Wire UI #69: <IperMatrixCard />
//
// Calculadora IPER 5x5: probabilidad × severidad → nivel + color +
// recomendación, con opción de aplicar efectividad de controles para
// obtener residual.

import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid3x3 } from 'lucide-react';
import {
  calculateIper,
  type IperInput,
} from '../../services/protocols/iper.js';

interface IperMatrixCardProps {
  /** Initial probability 1-5. */
  initialProbability?: 1 | 2 | 3 | 4 | 5;
  /** Initial severity 1-5. */
  initialSeverity?: 1 | 2 | 3 | 4 | 5;
  /** Si controlado puede aplicar reducción residual. */
  initialControlEffectiveness?: IperInput['controlEffectiveness'];
  onChange?: (input: IperInput, result: ReturnType<typeof calculateIper>) => void;
}

export function IperMatrixCard({
  initialProbability = 3,
  initialSeverity = 3,
  initialControlEffectiveness,
  onChange,
}: IperMatrixCardProps) {
  const { t } = useTranslation();
  const [probability, setProbability] = useState<1 | 2 | 3 | 4 | 5>(initialProbability);
  const [severity, setSeverity] = useState<1 | 2 | 3 | 4 | 5>(initialSeverity);
  const [controlEffectiveness, setControlEffectiveness] = useState<
    IperInput['controlEffectiveness']
  >(initialControlEffectiveness);

  const result = useMemo(() => {
    const r = calculateIper({ probability, severity, controlEffectiveness });
    onChange?.({ probability, severity, controlEffectiveness }, r);
    return r;
  }, [probability, severity, controlEffectiveness, onChange]);

  return (
    <section
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      data-testid="iper-matrix-card"
      aria-label={t('iper.aria', 'Matriz IPER 5x5') as string}
    >
      <header className="flex items-center gap-2">
        <Grid3x3 className="w-4 h-4 text-violet-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('iper.title', 'IPER 5x5')}
        </h2>
        <span
          className="ml-auto text-[10px] font-bold uppercase px-2 py-0.5 rounded"
          style={{ backgroundColor: `${result.color}20`, color: result.color }}
          data-testid="iper-level"
        >
          {result.level}
        </span>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('iper.probability', 'Probabilidad')}
          </span>
          <select
            value={probability}
            onChange={(e) => setProbability(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
            data-testid="iper-probability"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            <option value={1}>1 - Raro</option>
            <option value={2}>2 - Improbable</option>
            <option value={3}>3 - Posible</option>
            <option value={4}>4 - Probable</option>
            <option value={5}>5 - Casi cierto</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('iper.severity', 'Severidad')}
          </span>
          <select
            value={severity}
            onChange={(e) => setSeverity(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}
            data-testid="iper-severity"
            className="text-xs rounded border border-default-token bg-surface px-2 py-1"
          >
            <option value={1}>1 - Insignificante</option>
            <option value={2}>2 - Menor</option>
            <option value={3}>3 - Moderado</option>
            <option value={4}>4 - Mayor</option>
            <option value={5}>5 - Catastrófico</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase text-secondary-token">
          {t('iper.controls', 'Efectividad controles existentes')}
        </span>
        <select
          value={controlEffectiveness ?? ''}
          onChange={(e) =>
            setControlEffectiveness(
              (e.target.value as IperInput['controlEffectiveness']) || undefined,
            )
          }
          data-testid="iper-controls"
          className="text-xs rounded border border-default-token bg-surface px-2 py-1"
        >
          <option value="">{t('iper.noResidual', 'Sin residual')}</option>
          <option value="none">{t('iper.controlNone', 'Sin controles')}</option>
          <option value="low">{t('iper.controlLow', 'Baja')}</option>
          <option value="medium">{t('iper.controlMedium', 'Media')}</option>
          <option value="high">{t('iper.controlHigh', 'Alta')}</option>
        </select>
      </label>

      <div className="bg-surface-elevated rounded p-3 space-y-2">
        <div className="flex justify-between items-baseline">
          <span className="text-[10px] uppercase text-secondary-token">
            {t('iper.rawScore', 'Score bruto')}
          </span>
          <span className="text-2xl font-black tabular-nums" data-testid="iper-score">
            {result.rawScore}
          </span>
        </div>
        {result.residualLevel && (
          <div className="flex justify-between text-[11px]">
            <span className="uppercase text-secondary-token">
              {t('iper.residual', 'Residual')}
            </span>
            <span className="font-bold uppercase" data-testid="iper-residual">
              {result.residualLevel}
            </span>
          </div>
        )}
        <p className="text-[11px] text-secondary-token" data-testid="iper-recommendation">
          {result.recommendation}
        </p>
      </div>
    </section>
  );
}
