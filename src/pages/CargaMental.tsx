// Praeventio Guard — Carga Mental (NASA-TLX) self-assessment.
//
// Self-contained occupational WORKLOAD self-assessment: the worker scores the
// 6 NASA Task Load Index dimensions; the REAL pure engine `scoreMentalLoad`
// computes the overall load, level, dominant factor and operational
// recommendations. Mounts the previously-orphan MentalLoadSurveyForm.
//
// PRIVACY: runs entirely on-device — nothing is sent or stored, and no login is
// required (público sin-login). This is an ergonomics WORKLOAD screen, NOT a
// clinical or mental-health diagnosis (ADR 0012); the recommendations are
// operational (planning, ergonomics, talk to your lead). It is GUIDANCE — it
// stops nothing and authorises nothing.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain } from 'lucide-react';
import { MentalLoadSurveyForm } from '../components/mentalLoad/MentalLoadSurveyForm';
import type { MentalLoadScore } from '../services/mentalLoad/mentalLoadTracker';

// Level → display label + token-aware colour. Hardcoded Spanish (es-CL default),
// consistent with the engine's Spanish-only recommendations and the KIND_LABELS
// pattern in sibling self-assessment pages.
const LEVEL_LABEL: Record<MentalLoadScore['level'], string> = {
  low: 'Baja',
  moderate: 'Moderada',
  high: 'Alta',
  critical: 'Crítica',
};
const LEVEL_CLASS: Record<MentalLoadScore['level'], string> = {
  low: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
  moderate: 'text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/30',
  high: 'text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/30',
  critical: 'text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/30',
};
const FACTOR_LABEL: Record<MentalLoadScore['dominantFactor'], string> = {
  mentalDemand: 'Demanda mental',
  physicalDemand: 'Demanda física',
  temporalDemand: 'Presión de tiempo',
  effort: 'Esfuerzo',
  frustration: 'Frustración',
  performance: 'Sensación de mal desempeño',
};

export function CargaMental() {
  const { t } = useTranslation();
  const [result, setResult] = useState<MentalLoadScore | null>(null);

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shrink-0">
          <Brain className="w-6 h-6 text-emerald-500" />
        </div>
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-primary-token leading-tight">
            {t('cargaMental.title', 'Carga Mental del Día')}
          </h1>
          <p className="text-xs sm:text-sm text-secondary-token font-medium mt-1">
            {t(
              'cargaMental.subtitle',
              'Autoevaluación de carga de trabajo (NASA-TLX). Puntúa las 6 dimensiones; el sistema calcula tu nivel y te sugiere acciones. Es una guía — no detiene nada.',
            )}
          </p>
        </div>
      </header>

      <MentalLoadSurveyForm workerUid="self" onSubmit={(_survey, score) => setResult(score)} />

      {result && (
        <section
          data-testid="carga-mental-result"
          className="rounded-2xl border border-default-token bg-surface p-4 space-y-3 shadow-mode"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-bold uppercase tracking-widest text-secondary-token">
              {t('cargaMental.resultLabel', 'Carga total estimada')}
            </span>
            <span
              data-testid="carga-mental-level"
              className={`px-3 py-1 rounded-full border text-xs font-black uppercase tracking-wide ${LEVEL_CLASS[result.level]}`}
            >
              {LEVEL_LABEL[result.level]} · {result.overallLoad}/100
            </span>
          </div>

          <p className="text-sm text-primary-token">
            {t('cargaMental.dominantLabel', 'Factor dominante')}:{' '}
            <span className="font-bold">{FACTOR_LABEL[result.dominantFactor]}</span>
          </p>

          {result.recommendations.length > 0 ? (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-secondary-token mb-1">
                {t('cargaMental.recommendationsLabel', 'Sugerencias')}
              </p>
              <ul className="list-disc pl-5 space-y-1">
                {result.recommendations.map((r) => (
                  <li key={r} className="text-sm text-primary-token">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-secondary-token">
              {t(
                'cargaMental.noRecs',
                'Carga dentro de un rango manejable. Mantén pausas y comunica cualquier cambio a tu jefatura preventiva.',
              )}
            </p>
          )}
        </section>
      )}

      <p className="text-[10px] text-secondary-token leading-relaxed">
        {t(
          'cargaMental.disclaimer',
          'Esta autoevaluación de carga de trabajo (NASA Task Load Index) se calcula en tu dispositivo: no se guarda ni se envía. No es un diagnóstico médico ni de salud mental.',
        )}
      </p>
    </div>
  );
}
