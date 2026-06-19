// Praeventio Guard — Matriz IPER 5x5 self-assessment tool.
//
// Self-contained risk tool: the user picks probability × severity (+ optional
// control effectiveness) and the REAL pure engine `calculateIper` returns the
// risk level + raw score + residual + recommendation. No fetch / no aggregation
// — pure client compute over the user's input. (Mounts the previously-orphan
// IperMatrixCard over the real, mutation-tested `calculateIper` engine.)
//
// DIRECTIVE: this is GUIDANCE, never an operational block — it estimates risk;
// the supervisor/team decides.

import { useTranslation } from 'react-i18next';
import { Grid3x3 } from 'lucide-react';
import { IperMatrixCard } from '../components/protocols/IperMatrixCard';

export function MatrizIper() {
  const { t } = useTranslation();
  return (
    <div
      data-testid="matriz-iper-page"
      className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6"
    >
      <header className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-violet-500/10 border border-violet-500/20 shrink-0">
          <Grid3x3 className="w-6 h-6 text-violet-500" />
        </div>
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-primary-token leading-tight">
            {t('iper.page.title', 'Matriz IPER 5x5')}
          </h1>
          <p className="text-xs sm:text-sm text-secondary-token font-medium mt-1">
            {t(
              'iper.page.subtitle',
              'Estima el nivel de riesgo (probabilidad × severidad) y el residual al aplicar controles. Es una guía — la decisión es del equipo.',
            )}
          </p>
        </div>
      </header>

      <IperMatrixCard />
    </div>
  );
}

export default MatrizIper;
