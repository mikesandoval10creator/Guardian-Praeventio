// SPDX-License-Identifier: MIT
//
// Sprint 25 — MedicalDisclaimer (ADR 0012)
//
// Componente obligatorio en TODA vista del módulo médico. Cumple Ley
// 20.584 + 21.719 al dejar visible permanentemente que la app NO
// diagnostica. PRs que rendericen vistas médicas sin este componente
// son rechazados en code review.

import React from 'react';
import { Stethoscope, ShieldCheck } from 'lucide-react';

export interface MedicalDisclaimerProps {
  /** Variante visual: 'banner' (sticky), 'card' (inline), 'compact' (small footer). */
  variant?: 'banner' | 'card' | 'compact';
  /** className extra para overrides Tailwind. */
  className?: string;
}

const DISCLAIMER_TEXT_PRIMARY =
  'Praeventio nunca diagnostica.';

const DISCLAIMER_TEXT_BODY =
  'Esta es tu cartera médica portable. La información se organiza para que la compartas con tu médico tratante — él hará el diagnóstico, tratamiento y calificación legal correspondiente.';

const DISCLAIMER_LEGAL =
  'Cumple Ley 20.584 (derechos del paciente) + Ley 21.719 (datos personales) + Ley 16.744. Praeventio NO es dispositivo médico.';

export function MedicalDisclaimer({
  variant = 'banner',
  className = '',
}: MedicalDisclaimerProps) {
  if (variant === 'compact') {
    return (
      <p
        role="note"
        aria-label="Aviso médico"
        className={`text-xs text-zinc-500 italic ${className}`}
      >
        <Stethoscope className="inline w-3 h-3 mr-1" aria-hidden="true" />
        {DISCLAIMER_TEXT_PRIMARY} Conversa con tu médico tratante.
      </p>
    );
  }

  if (variant === 'card') {
    return (
      <div
        role="note"
        aria-label="Aviso médico permanente"
        className={`bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800/50 rounded-xl p-4 ${className}`}
      >
        <div className="flex items-start gap-3">
          <Stethoscope
            className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-teal-900 dark:text-teal-200 mb-1">
              {DISCLAIMER_TEXT_PRIMARY}
            </p>
            <p className="text-xs text-teal-800 dark:text-teal-300/80 leading-relaxed">
              {DISCLAIMER_TEXT_BODY}
            </p>
            <p className="text-[10px] text-teal-700/70 dark:text-teal-400/60 mt-2">
              <ShieldCheck className="inline w-3 h-3 mr-1" aria-hidden="true" />
              {DISCLAIMER_LEGAL}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Default: 'banner' — sticky top
  return (
    <div
      role="note"
      aria-label="Aviso médico permanente"
      className={`sticky top-0 z-30 bg-teal-50/95 dark:bg-teal-950/90 backdrop-blur-sm border-b border-teal-200 dark:border-teal-800/50 px-4 py-2 ${className}`}
    >
      <div className="flex items-center gap-2 max-w-5xl mx-auto">
        <Stethoscope
          className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0"
          aria-hidden="true"
        />
        <p className="text-xs text-teal-900 dark:text-teal-200 leading-tight">
          <span className="font-bold">{DISCLAIMER_TEXT_PRIMARY}</span>{' '}
          <span className="text-teal-800 dark:text-teal-300/80">
            Esta es tu cartera médica portable. Conversa con tu médico tratante.
          </span>
        </p>
      </div>
    </div>
  );
}

/**
 * Helper para tests automatizados — verifica que un componente renderiza
 * el disclaimer en su árbol DOM. Ver ADR 0012 §"Tests obligatorios".
 *
 * @example
 * import { render, screen } from '@testing-library/react';
 * import { findMedicalDisclaimer } from './MedicalDisclaimer';
 *
 * it('shows disclaimer', () => {
 *   render(<HealthVault />);
 *   expect(findMedicalDisclaimer(screen)).toBeInTheDocument();
 * });
 */
export const MEDICAL_DISCLAIMER_TEXT = DISCLAIMER_TEXT_PRIMARY;
