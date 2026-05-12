// Praeventio Guard — Wire UI #13: <ROICalculatorWidget />
//
// Widget de cálculo de ROI preventivo: beneficios (incidentes prevenidos
// + multas evitadas + tiempo admin ahorrado) vs costos (plan + safety
// investment). Use case: vista gerencial de cuánto vale Praeventio.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, TrendingDown, DollarSign, Clock } from 'lucide-react';
import {
  computeROI,
  type ROIInputs,
} from '../../services/pricingCalculator/pricingCalculator.js';

interface ROICalculatorWidgetProps {
  inputs: ROIInputs;
}

const LEVEL_CLASS = {
  underwater: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/40',
  breakeven: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40',
  positive: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/40',
  excellent: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border-emerald-500/50',
};

function formatClp(n: number): string {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(n);
}

export function ROICalculatorWidget({ inputs }: ROICalculatorWidgetProps) {
  const { t } = useTranslation();
  const report = useMemo(() => computeROI(inputs), [inputs]);
  const isPositive = report.level !== 'underwater';
  const Icon = isPositive ? TrendingUp : TrendingDown;

  return (
    <section
      className={`rounded-2xl border-2 p-4 shadow-mode ${LEVEL_CLASS[report.level]}`}
      data-testid="roi-calculator-widget"
      aria-label={t('roi.aria', 'Calculadora de ROI preventivo') as string}
    >
      <header className="flex items-center gap-2 mb-3">
        <Icon className="w-5 h-5" aria-hidden="true" />
        <h2 className="text-sm font-black uppercase tracking-wide">
          {t('roi.title', 'ROI Preventivo')}
        </h2>
        <span className="ml-auto text-xs font-bold opacity-80">{report.level.toUpperCase()}</span>
      </header>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="flex items-start gap-2">
          <DollarSign className="w-4 h-4 mt-0.5 opacity-70 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[10px] opacity-70 uppercase">{t('roi.benefits', 'Beneficios')}</p>
            <p className="text-sm font-bold" data-testid="roi-benefits">
              {formatClp(report.benefitsClp)}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <DollarSign className="w-4 h-4 mt-0.5 opacity-70 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[10px] opacity-70 uppercase">{t('roi.costs', 'Costos')}</p>
            <p className="text-sm font-bold" data-testid="roi-costs">
              {formatClp(report.costsClp)}
            </p>
          </div>
        </div>
      </div>

      <div className="border-t border-current/20 pt-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold">
            {t('roi.ratio', 'Ratio Beneficio/Costo')}
          </span>
          <span className="text-xl font-black tabular-nums" data-testid="roi-ratio">
            {report.benefitCostRatio === Infinity ? '∞' : `${report.benefitCostRatio}x`}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden="true" />
            {t('roi.payback', 'Payback')}
          </span>
          <span className="text-sm font-bold tabular-nums" data-testid="roi-payback">
            {report.paybackMonths === Infinity
              ? '∞'
              : t('roi.months', '{{n}} meses', { n: report.paybackMonths }).replace(
                  '{{n}}',
                  String(report.paybackMonths),
                )}
          </span>
        </div>
      </div>

      <p className="text-xs opacity-85 mt-3" data-testid="roi-message">
        {report.message}
      </p>
    </section>
  );
}
