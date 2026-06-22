// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiRow } from '../components/dashboard/KpiRow';
import { DensityToggle } from '../components/shared/DensityToggle';
import { useDensityStore } from '../store/densityStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }) }));

describe('Dashboard KPI/density wiring (unit-level)', () => {
  beforeEach(() => useDensityStore.setState({ density: 'comfortable' }));
  it('KpiRow + DensityToggle se renderizan juntos sin romper', () => {
    render(
      <>
        <DensityToggle />
        <KpiRow items={[{ id: 'c', label: 'Cumplimiento', value: '0%' }]} />
      </>,
    );
    expect(screen.getByRole('group', { name: /Densidad/i })).toBeInTheDocument();
    expect(screen.getByTestId('kpi-row')).toBeInTheDocument();
  });
});
