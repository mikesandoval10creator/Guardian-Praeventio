// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KpiRow } from '../components/dashboard/KpiRow';
import { useDensityStore } from '../store/densityStore';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k }) }));

describe('Dashboard KPI/density wiring (unit-level)', () => {
  beforeEach(() => useDensityStore.setState({ density: 'comfortable' }));
  it('KpiRow se renderiza con el density store sin romper', () => {
    render(<KpiRow items={[{ id: 'c', label: 'Cumplimiento', value: '0%' }]} />);
    expect(screen.getByTestId('kpi-row')).toBeInTheDocument();
  });
});
