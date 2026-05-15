// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EngineeringInventoryCard } from './EngineeringInventoryCard.js';
import type { EngineeringControl } from '../../services/engineeringControls/engineeringControlsInventory.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function ctrl(
  id: string,
  risk: string,
  status: EngineeringControl['status'] = 'operativo',
): EngineeringControl {
  return {
    id,
    kind: 'physical_barrier',
    label: `Control ${id}`,
    mitigatesRiskCategory: risk,
    location: `loc-${id}`,
    status,
    maintainedByUid: 'm1',
  };
}

describe('<EngineeringInventoryCard />', () => {
  it('renderiza total + sin gaps si todo cubierto', () => {
    render(
      <EngineeringInventoryCard
        controls={[ctrl('1', 'caida_altura'), ctrl('2', 'atrapamiento')]}
        projectRiskCategories={['caida_altura', 'atrapamiento']}
      />,
    );
    expect(screen.getByTestId('engineering-total').textContent).toMatch(/2/);
    expect(screen.queryByTestId('engineering-uncovered')).toBeNull();
    expect(screen.getByTestId('engineering-covered').textContent).toMatch(/2/);
  });

  it('marca gap si riesgo no tiene control físico', () => {
    render(
      <EngineeringInventoryCard
        controls={[ctrl('1', 'caida_altura')]}
        projectRiskCategories={['caida_altura', 'atrapamiento', 'electrocucion']}
      />,
    );
    expect(screen.getByTestId('engineering-uncovered')).toBeInTheDocument();
    expect(screen.getByTestId('engineering-gap-atrapamiento')).toBeInTheDocument();
    expect(screen.getByTestId('engineering-gap-electrocucion')).toBeInTheDocument();
  });

  it('lista controles fuera de servicio', () => {
    render(
      <EngineeringInventoryCard
        controls={[
          ctrl('a', 'r1', 'operativo'),
          ctrl('b', 'r2', 'fuera_servicio'),
          ctrl('c', 'r3', 'fuera_servicio'),
        ]}
        projectRiskCategories={['r1', 'r2', 'r3']}
      />,
    );
    expect(screen.getByTestId('engineering-out-of-service')).toBeInTheDocument();
    expect(screen.getByTestId('engineering-out-count').textContent).toMatch(/2/);
    expect(screen.getByTestId('engineering-down-b')).toBeInTheDocument();
  });
});
