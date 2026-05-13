// Praeventio Guard — Wire UI S44: <PreventionROIWidget />
//
// Widget presentacional que muestra el estimado de ROI preventivo y/o
// costo de no-cumplimiento. El padre computa las estimaciones vía
// estimateNonComplianceCost / estimatePreventionROI y las pasa como
// props. Formatos CLP con Intl.NumberFormat.

import { TrendingUp, AlertOctagon, Scale } from 'lucide-react';
import type {
  NonComplianceEstimate,
  PreventionROIEstimate,
} from '../../services/costCalculator/preventionCostCalculator.js';

interface PreventionROIWidgetProps {
  nonCompliance?: NonComplianceEstimate;
  roi?: PreventionROIEstimate;
}

const formatClp = (n: number) =>
  new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    maximumFractionDigits: 0,
  }).format(n);

export function PreventionROIWidget({ nonCompliance, roi }: PreventionROIWidgetProps) {
  return (
    <section
      className="rounded-2xl border border-teal-200 bg-teal-50 p-4 space-y-3"
      data-testid="costCalculator.widget"
      aria-label="Calculadora de costo preventivo"
    >
      <header className="flex items-center gap-2">
        <Scale className="w-4 h-4 text-teal-600" aria-hidden="true" />
        <h2
          className="text-sm font-bold text-teal-700"
          data-testid="costCalculator.widget.title"
        >
          Costo preventivo
        </h2>
      </header>

      {nonCompliance && (
        <div
          className="rounded bg-white border border-rose-200 p-3 space-y-1"
          data-testid="costCalculator.widget.nonCompliance"
        >
          <div className="flex items-center gap-2 text-rose-700">
            <AlertOctagon className="w-3 h-3" aria-hidden="true" />
            <span className="text-[11px] font-bold uppercase">Si no se cumple</span>
          </div>
          <p
            className="text-sm font-bold"
            data-testid="costCalculator.widget.nonCompliance.range"
          >
            {formatClp(nonCompliance.totalEstimatedClpMin)} —{' '}
            {formatClp(nonCompliance.totalEstimatedClpMax)}
          </p>
          <dl className="grid grid-cols-2 gap-1 text-[11px] text-slate-600">
            <div>
              <dt>Multa</dt>
              <dd data-testid="costCalculator.widget.nonCompliance.fine">
                {formatClp(nonCompliance.estimatedFineClpMin)}+
              </dd>
            </div>
            <div>
              <dt>Paralización</dt>
              <dd data-testid="costCalculator.widget.nonCompliance.stoppage">
                {formatClp(nonCompliance.stoppageCostClp)}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {roi && (
        <div
          className="rounded bg-white border border-teal-200 p-3 space-y-1"
          data-testid="costCalculator.widget.roi"
        >
          <div className="flex items-center gap-2 text-teal-700">
            <TrendingUp className="w-3 h-3" aria-hidden="true" />
            <span className="text-[11px] font-bold uppercase">ROI preventivo</span>
          </div>
          <p
            className="text-sm font-bold"
            data-testid="costCalculator.widget.roi.totalSavings"
          >
            {formatClp(roi.totalSavingsClp)}
          </p>
          {roi.topContributors[0] && (
            <p
              className="text-[11px] text-slate-600"
              data-testid="costCalculator.widget.roi.topContributor"
            >
              Principal: {roi.topContributors[0].source} (
              {roi.topContributors[0].percent}%)
            </p>
          )}
        </div>
      )}
    </section>
  );
}
