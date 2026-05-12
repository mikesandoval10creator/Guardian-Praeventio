// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OccupationalContextBundleCard } from './OccupationalContextBundleCard.js';
import { MedicalDisclaimer } from './MedicalDisclaimer';
import { buildOccupationalContextBundle } from '../../services/health/occupationalContext.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<OccupationalContextBundleCard />', () => {
  it('disclaimer médico renderizado standalone', () => {
    render(<MedicalDisclaimer variant="compact" />);
    // MedicalDisclaimer presente vía ADR 0012 (no diagnostica).
    expect(document.body.textContent).toBeTruthy();
  });

  it('renderiza con bundle vacío', () => {
    const bundle = buildOccupationalContextBundle('w1', [], [], []);
    render(<OccupationalContextBundleCard bundle={bundle} />);
    expect(screen.getByTestId('occ-bundle-w1')).toBeInTheDocument();
    expect(screen.getByTestId('occ-bundle-disclaimer-w1').textContent).toMatch(
      /Praeventio no diagnostica/,
    );
  });

  it('muestra agentes riesgo + zonas ergonómicas', () => {
    const bundle = buildOccupationalContextBundle(
      'w2',
      [
        {
          yearFrom: 2015,
          yearTo: 2025,
          employer: 'Codelco',
          role: 'minero',
          physicalDemands: ['manual_lifting'],
          riskAgents: ['silica', 'noise'],
          workplaceCountry: 'CL',
        },
      ],
      [
        {
          date: '2026-05-01',
          rebaScore: 8,
          rulaScore: 6,
          affectedZones: ['lumbar', 'shoulder'],
          minutesObserved: 120,
        },
      ],
      [
        {
          date: '2026-05-10',
          bodyPart: 'lumbar',
          severity: 4,
          description: 'dolor agudo',
          triggeredByWork: true,
        },
      ],
    );
    render(<OccupationalContextBundleCard bundle={bundle} />);
    expect(screen.getByTestId('occ-risk-w2-silica')).toBeInTheDocument();
    expect(screen.getByTestId('occ-hotspot-w2-lumbar')).toBeInTheDocument();
    expect(screen.getByTestId('occ-symptom-w2-lumbar')).toBeInTheDocument();
    expect(screen.getByTestId('occ-years-w2').textContent).toMatch(/10/);
  });
});
