// Praeventio Guard — Wire UI #40: <MentalLoadSurveyForm />
//
// Formulario NASA-TLX adaptado para que el trabajador puntúe carga
// mental + física en las 6 dimensiones. Score se calcula on submit.

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Calculator } from 'lucide-react';
import {
  scoreMentalLoad,
  type MentalLoadSurvey,
  type MentalLoadScore,
} from '../../services/mentalLoad/mentalLoadTracker.js';

interface MentalLoadSurveyFormProps {
  workerUid: string;
  onSubmit: (survey: MentalLoadSurvey, score: MentalLoadScore) => Promise<void> | void;
}

type Dimension = keyof Omit<MentalLoadSurvey, 'workerUid' | 'surveyedAt'>;

const DIMENSIONS: Array<{ key: Dimension; label: string; helpText: string }> = [
  {
    key: 'mentalDemand',
    label: 'Demanda mental',
    helpText: 'Cuánto pensamiento, decisión y memoria requirió',
  },
  {
    key: 'physicalDemand',
    label: 'Demanda física',
    helpText: 'Esfuerzo físico (levantar, empujar, caminar)',
  },
  {
    key: 'temporalDemand',
    label: 'Presión de tiempo',
    helpText: 'Cuánta prisa para terminar',
  },
  {
    key: 'effort',
    label: 'Esfuerzo',
    helpText: 'Cuánto debiste esforzarte para lograrlo',
  },
  {
    key: 'frustration',
    label: 'Frustración',
    helpText: 'Cuánto te molestaron obstáculos / desencuentros',
  },
  {
    key: 'performance',
    label: 'Sensación de mal desempeño',
    helpText: '100 = sentiste que no rendiste; 0 = lo lograste con facilidad',
  },
];

export function MentalLoadSurveyForm({ workerUid, onSubmit }: MentalLoadSurveyFormProps) {
  const { t } = useTranslation();
  const initialValues = Object.fromEntries(
    DIMENSIONS.map((d) => [d.key, 50]),
  ) as Record<Dimension, number>;
  const [values, setValues] = useState<Record<Dimension, number>>(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const survey: MentalLoadSurvey = {
        workerUid,
        ...values,
        surveyedAt: new Date().toISOString(),
      };
      const score = scoreMentalLoad(survey);
      await onSubmit(survey, score);
      // Intentionally do NOT reset the sliders: the values that produced the
      // result stay visible so the worker can see what drove the verdict and
      // adjust from there — no dissociation between inputs and the shown result.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit_failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="mental-load-survey-form"
      className="rounded-2xl border border-default-token bg-surface p-4 shadow-mode space-y-3"
      aria-label={t('mentalLoad.aria', 'Encuesta carga mental') as string}
    >
      <header className="flex items-center gap-2">
        <Brain className="w-4 h-4 text-emerald-500" aria-hidden="true" />
        <h2 className="text-sm font-black text-primary-token uppercase tracking-wide">
          {t('mentalLoad.title', 'Carga del día')}
        </h2>
      </header>
      <p className="text-xs text-secondary-token">
        {t('mentalLoad.subtitle', 'Desliza cada dimensión 0 (nada) → 100 (extremo).')}
      </p>

      <ul className="space-y-3">
        {DIMENSIONS.map((d) => (
          <li key={d.key} data-testid={`mental-load-dim-${d.key}`}>
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={`mlf-${d.key}`} className="text-xs font-bold text-primary-token">
                {d.label}
              </label>
              <span className="text-sm font-black tabular-nums">{values[d.key]}</span>
            </div>
            <p id={`mlf-${d.key}-help`} className="text-[10px] text-secondary-token mb-1">{d.helpText}</p>
            <input
              id={`mlf-${d.key}`}
              type="range"
              min={0}
              max={100}
              step={5}
              value={values[d.key]}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [d.key]: Number(e.target.value) }))
              }
              aria-describedby={`mlf-${d.key}-help`}
              data-testid={`mental-load-slider-${d.key}`}
              className="w-full"
            />
          </li>
        ))}
      </ul>

      {error && (
        <p
          role="alert"
          data-testid="mental-load-error"
          className="text-xs text-rose-700 dark:text-rose-300 bg-rose-500/10 px-2 py-1 rounded"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        data-testid="mental-load-submit"
        className="inline-flex items-center gap-1 px-4 py-1.5 rounded-md bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 disabled:opacity-50"
      >
        <Calculator className="w-3 h-3" aria-hidden="true" />
        {submitting
          ? t('mentalLoad.calculating', 'Calculando...')
          : t('mentalLoad.calculate', 'Calcular carga')}
      </button>
    </form>
  );
}
