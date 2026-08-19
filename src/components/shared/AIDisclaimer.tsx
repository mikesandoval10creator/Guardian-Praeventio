// Praeventio Guard — AIDisclaimer
//
// Banner reutilizable para vistas que muestran análisis predictivo IA.
// Garantiza que el usuario SIEMPRE vea el disclaimer "asistencia, no decisión"
// + metadata de provenance (generatedAt + modelVersion) cuando se renderiza
// cualquier insight de `predictGlobalIncidents`.
//
// Variantes:
//   - "banner": bloque visible grande (PredictiveAnalysis, AIInsightsModal)
//   - "compact": una línea pequeña (PredictiveAlertWidget, Dashboard cards)
//
// Por qué existe (ADR informal):
//   - El backend devuelve probabilidades cualitativas del LLM (Alta/Media/Baja)
//     que se muestran como %. Esas probabilidades NO están calibradas.
//   - Ley 16.744 + NCh ISO 45001: las decisiones de prevención tienen
//     implicancias legales — la IA no puede "decidir" por el prevencionista.
//   - Este componente hace explícita esa honestidad en cada render.

import React from 'react';
import { DISCLAIMER_AI_HUB } from '../../services/gemini/types';

export type AIDisclaimerVariant = 'banner' | 'compact';

export interface AIDisclaimerProps {
  /** Override del disclaimer (default: DISCLAIMER_AI_HUB del contrato). */
  disclaimer?: string;
  /** Timestamp ISO-8601 de cuándo se generó el análisis. */
  generatedAt?: string;
  /** Identificador del modelo (ej. 'gemini-2.0-flash'). */
  modelVersion?: string;
  /** Variante visual. */
  variant?: AIDisclaimerVariant;
  /** Clases Tailwind extra. */
  className?: string;
}

export function AIDisclaimer({
  disclaimer = DISCLAIMER_AI_HUB,
  generatedAt,
  modelVersion,
  variant = 'banner',
  className = '',
}: AIDisclaimerProps) {
  const formattedDate = generatedAt
    ? new Date(generatedAt).toLocaleString()
    : null;

  if (variant === 'compact') {
    return (
      <p
        className={`text-[8px] sm:text-[9px] text-zinc-500 dark:text-zinc-500 uppercase tracking-widest ${className}`}
        aria-label="Aviso de IA"
      >
        {disclaimer}
        {modelVersion ? ` · ${modelVersion}` : ''}
      </p>
    );
  }

  return (
    <div
      className={`bg-zinc-100 dark:bg-zinc-800/40 border border-zinc-200 dark:border-white/5 rounded-2xl p-3 sm:p-4 ${className}`}
      role="note"
      aria-label="Aviso de IA"
    >
      <p className="text-[9px] sm:text-[10px] font-black text-zinc-600 dark:text-zinc-400 uppercase tracking-widest leading-tight">
        {disclaimer}
      </p>
      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-[9px] font-bold text-zinc-500 dark:text-zinc-500 uppercase tracking-widest mt-1.5">
        {formattedDate && (
          <span>Generado: {formattedDate}</span>
        )}
        {modelVersion && (
          <>
            {formattedDate && <span className="hidden sm:inline">·</span>}
            <span>Modelo: {modelVersion}</span>
          </>
        )}
      </div>
    </div>
  );
}
