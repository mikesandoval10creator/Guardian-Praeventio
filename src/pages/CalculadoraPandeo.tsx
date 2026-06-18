// Praeventio Guard — Calculadora de Pandeo (Euler) page.
//
// Thin host for the self-contained BucklingCalculatorCard (form + the real pure
// `calculateCriticalLoad` Euler engine + result). Lets a worker/engineer check
// the critical buckling load + safety factor of a column/strut/scaffold leg on
// site. Engineering GUIDANCE — does not replace the formal structural calc nor
// authorize a load. Mounts the previously-orphan BucklingCalculatorCard.

import { useTranslation } from 'react-i18next';
import { Construction } from 'lucide-react';
import { BucklingCalculatorCard } from '../components/euler/BucklingCalculatorCard';

export function CalculadoraPandeo() {
  const { t } = useTranslation();
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 shrink-0">
          <Construction className="w-6 h-6 text-amber-500" />
        </div>
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tighter text-primary-token leading-tight">
            {t('calcPandeo.title', 'Calculadora de Pandeo (Euler)')}
          </h1>
          <p className="text-xs sm:text-sm text-secondary-token font-medium mt-1">
            {t(
              'calcPandeo.subtitle',
              'Carga crítica de pandeo de columnas/puntales según Euler. Guía de ingeniería — no reemplaza el cálculo estructural formal ni autoriza una carga.',
            )}
          </p>
        </div>
      </header>

      <BucklingCalculatorCard />
    </div>
  );
}
