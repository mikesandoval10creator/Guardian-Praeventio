// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PreventionROIWidget } from './PreventionROIWidget.js';
import type {
  NonComplianceEstimate,
  PreventionROIEstimate,
} from '../../services/costCalculator/preventionCostCalculator.js';

const sampleNonCompliance: NonComplianceEstimate = {
  estimatedFineClpMin: 500_000,
  estimatedFineClpMax: 5_000_000,
  stoppageCostClp: 2_000_000,
  adminCostClp: 300_000,
  totalEstimatedClpMin: 2_800_000,
  totalEstimatedClpMax: 7_300_000,
  historyMultiplier: 1,
  notes: [],
};

const sampleRoi: PreventionROIEstimate = {
  adminHoursSavingsClp: 600_000,
  documentInsourceSavingsClp: 400_000,
  stoppageAvoidanceSavingsClp: 1_600_000,
  incidentAvoidanceSavingsClp: 3_000_000,
  totalSavingsClp: 5_600_000,
  topContributors: [
    { source: 'Incidentes evitados (near-miss)', amountClp: 3_000_000, percent: 54 },
    { source: 'Detenciones evitadas', amountClp: 1_600_000, percent: 29 },
  ],
};

describe('<PreventionROIWidget />', () => {
  it('renderiza título base sin datos', () => {
    render(<PreventionROIWidget />);
    expect(screen.getByTestId('costCalculator.widget.title')).toHaveTextContent(
      'Costo preventivo',
    );
  });

  it('muestra estimación de no-cumplimiento y ROI cuando se proveen', () => {
    render(
      <PreventionROIWidget nonCompliance={sampleNonCompliance} roi={sampleRoi} />,
    );
    expect(screen.getByTestId('costCalculator.widget.nonCompliance')).toBeInTheDocument();
    expect(screen.getByTestId('costCalculator.widget.roi')).toBeInTheDocument();
    expect(
      screen.getByTestId('costCalculator.widget.roi.topContributor').textContent,
    ).toContain('Incidentes');
  });
});
