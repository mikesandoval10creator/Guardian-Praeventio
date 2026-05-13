// Praeventio Guard — Sprint 47 D.7: lazy wrapper para RiskMatrix5x5.
//
// Recharts es ~80KB gzipped. Diferirlo hasta que el panel se abra.

import { lazy, Suspense } from 'react';
import type { RiskMatrix5x5Props } from './RiskMatrix5x5.js';

const RiskMatrix5x5 = lazy(() =>
  import('./RiskMatrix5x5.js').then((m) => ({ default: m.RiskMatrix5x5 })),
);

export function RiskMatrix5x5Lazy(props: RiskMatrix5x5Props) {
  return (
    <Suspense
      fallback={
        <div
          data-testid="risk-matrix-lazy.loading"
          className="flex h-80 w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500"
        >
          Cargando matriz de riesgos…
        </div>
      }
    >
      <RiskMatrix5x5 {...props} />
    </Suspense>
  );
}
