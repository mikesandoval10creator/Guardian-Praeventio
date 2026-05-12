// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PdcaSummaryCard } from './PdcaSummaryCard.js';
import type { NonConformity } from '../../services/pdca/pdcaCycle.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function nc(id: string, status: NonConformity['status']): NonConformity {
  return {
    id,
    category: 'epp',
    severity: 'minor',
    description: 'test',
    detectedAt: '2026-05-01T00:00:00Z',
    location: 'zona A',
    responsibleUid: 'u1',
    status,
  };
}

describe('<PdcaSummaryCard />', () => {
  it('renderiza 4 fases', () => {
    render(<PdcaSummaryCard items={[nc('1', 'open'), nc('2', 'verified_effective')]} />);
    expect(screen.getByTestId('pdca-summary-card')).toBeInTheDocument();
    expect(screen.getByTestId('pdca-phase-plan')).toBeInTheDocument();
    expect(screen.getByTestId('pdca-phase-do')).toBeInTheDocument();
    expect(screen.getByTestId('pdca-phase-check')).toBeInTheDocument();
    expect(screen.getByTestId('pdca-phase-act')).toBeInTheDocument();
  });

  it('muestra tasa de eficacia', () => {
    render(
      <PdcaSummaryCard
        items={[nc('1', 'closed'), nc('2', 'verified_effective'), nc('3', 'verified_effective')]}
      />,
    );
    // verified_effective=2, closed=1 → 2/3 = 67%
    expect(screen.getByTestId('pdca-effectiveness-rate').textContent).toMatch(/67/);
  });

  it('flag reincidencias', () => {
    render(<PdcaSummaryCard items={[nc('1', 'reoccurred')]} />);
    expect(screen.getByTestId('pdca-reoccurrences')).toBeInTheDocument();
  });

  it('sin flag reincidencias si todo limpio', () => {
    render(<PdcaSummaryCard items={[nc('1', 'verified_effective')]} />);
    expect(screen.queryByTestId('pdca-reoccurrences')).toBeNull();
  });
});
