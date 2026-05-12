// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PymeMaturityWizard } from './PymeMaturityWizard.js';
import type { PymeWizardInput } from '../../services/pymeOnboarding/pymeWizard.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const baseInput: PymeWizardInput = {
  industry: 'construction',
  workerCount: 30,
  hasSupervisor: false,
  hasCphs: false,
  hasRiohs: false,
  hasTrainingProgram: false,
  registersIncidents: false,
  hasMutualidad: false,
  usesNormedEpp: false,
};

describe('<PymeMaturityWizard />', () => {
  it('PYME vacía → level 1', () => {
    render(<PymeMaturityWizard input={baseInput} />);
    expect(screen.getByTestId('pyme-maturity-card')).toHaveTextContent(/Nivel 1/i);
    expect(screen.getByTestId('pyme-missing-capabilities')).toBeInTheDocument();
  });

  it('plan 30 días visible', () => {
    render(<PymeMaturityWizard input={baseInput} />);
    expect(screen.getByTestId('pyme-thirty-day-plan')).toBeInTheDocument();
    expect(screen.getByTestId('pyme-action-day-30')).toBeInTheDocument();
  });

  it('PYME completa → level 5', () => {
    render(
      <PymeMaturityWizard
        input={{
          industry: 'construction',
          workerCount: 30,
          hasSupervisor: true,
          hasCphs: true,
          hasRiohs: true,
          hasTrainingProgram: true,
          registersIncidents: true,
          hasMutualidad: true,
          usesNormedEpp: true,
        }}
      />,
    );
    expect(screen.getByTestId('pyme-maturity-card')).toHaveTextContent(/Nivel 5/i);
  });
});
