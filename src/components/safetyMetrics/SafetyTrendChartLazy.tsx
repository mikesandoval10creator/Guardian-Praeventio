// Praeventio Guard — Sprint 47 D.7: lazy wrapper para SafetyTrendChart.

import { lazy, Suspense } from 'react';
import type { SafetyTrendChartProps } from './SafetyTrendChart.js';

const SafetyTrendChart = lazy(() =>
  import('./SafetyTrendChart.js').then((m) => ({ default: m.SafetyTrendChart })),
);

export function SafetyTrendChartLazy(props: SafetyTrendChartProps) {
  return (
    <Suspense
      fallback={
        <div
          data-testid="safety-trend-lazy.loading"
          className="flex h-72 w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-sm text-slate-500"
        >
          Cargando tendencia métricas…
        </div>
      }
    >
      <SafetyTrendChart {...props} />
    </Suspense>
  );
}
