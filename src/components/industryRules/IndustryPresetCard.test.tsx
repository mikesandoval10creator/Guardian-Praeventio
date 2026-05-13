// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IndustryPresetCard } from './IndustryPresetCard.js';
import type { PresetApplication } from '../../services/industryRules/industryRuleEngine.js';

const preset: PresetApplication = {
  projectId: 'p-001',
  industryPrefix: 'GP-MIN',
  risksToCreate: [
    { riskType: 'silice', severity: 'high' },
    { riskType: 'ruido', severity: 'medium' },
  ],
  documentsToGenerate: ['Plan Emergencia', 'RIOHS'],
  trainingsToSchedule: ['rescate_minero'],
  baseEppToAssign: ['casco', 'mascara_silice'],
  regulationsToLink: ['DS 132', 'DS 594'],
  protocolsToActivate: ['PREXOR_silice'],
};

describe('<IndustryPresetCard />', () => {
  it('muestra título y proyecto', () => {
    render(<IndustryPresetCard preset={preset} label="Minería (GP-MIN)" />);
    expect(screen.getByTestId('industryRules.card.title')).toHaveTextContent('Minería');
    expect(screen.getByTestId('industryRules.card.projectId')).toHaveTextContent('p-001');
  });

  it('renderiza secciones de riesgos, docs y normativa', () => {
    render(<IndustryPresetCard preset={preset} />);
    expect(screen.getByTestId('industryRules.card.risks').textContent).toContain('silice');
    expect(screen.getByTestId('industryRules.card.documents').textContent).toContain('RIOHS');
    expect(screen.getByTestId('industryRules.card.regs').textContent).toContain('DS 132');
  });
});
