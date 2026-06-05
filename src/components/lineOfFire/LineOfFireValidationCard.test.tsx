// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LineOfFireValidationCard } from './LineOfFireValidationCard.js';
import {
  validateLineOfFire,
  getRequiredMitigationsForKind,
} from '../../services/lineOfFire/lineOfFireChecker.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<LineOfFireValidationCard />', () => {
  it('renderiza badge BLOQUEO si blockTask', () => {
    const result = validateLineOfFire(
      {
        kind: 'suspended_load',
        description: 'Carga pesada sobre cuadrilla',
        proximityMeters: 3,
        personnelInPath: true,
      },
      [],
    );
    render(<LineOfFireValidationCard result={result} />);
    expect(screen.getByTestId('lof-card-suspended_load')).toBeInTheDocument();
    expect(screen.getByTestId('lof-status-suspended_load').textContent).toBe('BLOQUEO');
    expect(screen.getByTestId('lof-missing-suspended_load')).toBeInTheDocument();
  });

  it('renderiza badge CUMPLE cuando todas las mitigaciones declaradas', () => {
    const result = validateLineOfFire(
      {
        kind: 'projection',
        description: 'Esmerilado',
        proximityMeters: 5,
        personnelInPath: false,
      },
      getRequiredMitigationsForKind('projection'),
    );
    render(<LineOfFireValidationCard result={result} />);
    expect(screen.getByTestId('lof-status-projection').textContent).toBe('CUMPLE');
  });

  it('expande lista de mitigaciones esperadas', () => {
    const result = validateLineOfFire(
      {
        kind: 'electric_arc',
        description: 'Trabajo eléctrico baja tensión',
        proximityMeters: 1,
        personnelInPath: false,
      },
      [],
    );
    render(<LineOfFireValidationCard result={result} />);
    expect(screen.getByTestId('lof-expected-electric_arc')).toBeInTheDocument();
  });
});
