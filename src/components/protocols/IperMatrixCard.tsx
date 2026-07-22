// Praeventio Guard — Wire UI #69: <IperMatrixCard />
//
// Calculadora IPER 5x5: probabilidad × severidad → nivel + color +
// recomendación, con opción de aplicar efectividad de controles para
// obtener residual.

import { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid3x3 } from 'lucide-react';
import {
  calculateIper,
  type DisasterHazard,
  type IperGenderLens,
  type IperInput,
} from '../../services/protocols/iper.js';

const DISASTER_OPTIONS: ReadonlyArray<{ value: DisasterHazard; label: string }> = [
  { value: 'sismo', label: 'Sismo' },
  { value: 'tsunami', label: 'Tsunami' },
  { value: 'inundacion', label: 'Inundación' },
  { value: 'incendio_forestal', label: 'Incendio forestal' },
  { value: 'aluvion', label: 'Aluvión' },
  { value: 'erupcion_volcanica', label: 'Erupción volcánica' },
  { value: 'viento_extremo', label: 'Viento extremo' },
];

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

  // DS 44/2024 — enfoque de género + gestión de desastres. These only ADD
  // recommendations; they never change the computed level (see iper.ts).
  const [maternityExposure, setMaternityExposure] = useState(false);
  const [differentiatedBySex, setDifferentiatedBySex] = useState(false);
  const [ppeAnthropometryGap, setPpeAnthropometryGap] = useState(false);
  const [genderedPsychosocial, setGenderedPsychosocial] = useState(false);
  const [disasterHazard, setDisasterHazard] = useState<DisasterHazard | ''>('');
  const [emergencyPlanInPlace, setEmergencyPlanInPlace] = useState(false);

  const input = useMemo<IperInput>(() => {
    const lens: IperGenderLens = {};
    if (maternityExposure) lens.maternityExposure = true;
    if (differentiatedBySex) lens.differentiatedBySex = true;
    if (ppeAnthropometryGap) lens.ppeAnthropometryGap = true;
    if (genderedPsychosocial) lens.genderedPsychosocial = true;

    return {
      probability,
      severity,
      controlEffectiveness,
      // Omitted when empty so records without the DS 44 lens stay identical.
      ...(Object.keys(lens).length > 0 ? { genderLens: lens } : {}),
      ...(disasterHazard ? { disasterHazard, emergencyPlanInPlace } : {}),
    };
  }, [
    probability,
    severity,
    controlEffectiveness,
    maternityExposure,
    differentiatedBySex,
    ppeAnthropometryGap,
    genderedPsychosocial,
    disasterHazard,
    emergencyPlanInPlace,
  ]);

  const result = useMemo(() => calculateIper(input), [input]);

  // Notify listeners AFTER commit, not during render: calling a parent's
  // setState from inside this component's useMemo is a React anti-pattern
  // ("Cannot update a component while rendering a different component").
  useEffect(() => {
    onChange?.(input, result);
  }, [input, result, onChange]);

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

      {/* DS 44/2024 — enfoque de género + gestión de desastres. Marcar un
          factor NO reclasifica el riesgo: agrega una recomendación citando la
          norma, para que el prevencionista decida. */}
      <fieldset className="rounded border border-default-token p-3 space-y-2">
        <legend className="px-1 text-[10px] uppercase text-secondary-token">
          Consideraciones DS 44 (opcional)
        </legend>

        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {([
            ['iper-ds44-maternity', maternityExposure, setMaternityExposure,
              'Hay trabajadoras embarazadas o en lactancia expuestas'],
            ['iper-ds44-differentiated', differentiatedBySex, setDifferentiatedBySex,
              'La exposición difiere según sexo'],
            ['iper-ds44-ppe', ppeAnthropometryGap, setPpeAnthropometryGap,
              'Falta EPP en la talla/antropometría de quienes lo usan'],
            ['iper-ds44-psychosocial', genderedPsychosocial, setGenderedPsychosocial,
              'Riesgo psicosocial con incidencia distinta por sexo'],
          ] as const).map(([testId, checked, setChecked, label]) => (
            <label key={testId} className="flex items-start gap-2 text-[11px] text-secondary-token">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                data-testid={testId}
                className="mt-0.5"
              />
              <span>{label}</span>
            </label>
          ))}
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-secondary-token">
            Amenaza natural evaluada
          </span>
          <select
            value={disasterHazard}
            onChange={(e) => setDisasterHazard(e.target.value as DisasterHazard | '')}
            data-testid="iper-ds44-disaster"
            className="rounded border border-default-token bg-surface px-2 py-1 text-xs"
          >
            <option value="">Ninguna</option>
            {DISASTER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {disasterHazard && (
          <label className="flex items-start gap-2 text-[11px] text-secondary-token">
            <input
              type="checkbox"
              checked={emergencyPlanInPlace}
              onChange={(e) => setEmergencyPlanInPlace(e.target.checked)}
              data-testid="iper-ds44-plan"
              className="mt-0.5"
            />
            <span>Existe un plan de emergencia y evacuación vigente para esta amenaza</span>
          </label>
        )}
      </fieldset>

      {result.ds44Recommendations && (
        <div
          data-testid="iper-ds44-recommendations"
          className="space-y-2 rounded border border-violet-500/30 bg-violet-500/5 p-3"
        >
          <p className="text-[10px] font-bold uppercase tracking-wide text-violet-600">
            Recomendaciones según normativa — la decisión es tuya
          </p>
          <ul className="space-y-2">
            {result.ds44Recommendations.map((rec) => (
              <li key={rec.basis + rec.text.slice(0, 24)} className="space-y-1">
                <p className="text-[11px] text-primary-token">{rec.text}</p>
                <p className="text-[10px] italic text-secondary-token">{rec.basis}</p>
                {rec.suggestedLevel && (
                  <p className="text-[10px] font-bold uppercase text-violet-600">
                    Nivel sugerido para la población expuesta: {rec.suggestedLevel}
                    <span className="ml-1 font-normal normal-case italic text-secondary-token">
                      (sugerencia: no se aplicó a la clasificación)
                    </span>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

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
