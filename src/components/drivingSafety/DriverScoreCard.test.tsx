// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DriverScoreCard } from './DriverScoreCard.js';
import type { DriverProfile } from '../../services/drivingSafety/drivingSafetyService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function profile(over: Partial<DriverProfile> & { workerUid: string }): DriverProfile {
  return {
    workerUid: over.workerUid,
    licenseClass: over.licenseClass ?? 'A4',
    licenseExpiresAt: over.licenseExpiresAt ?? '2027-01-01T00:00:00Z',
    yearsExperience: over.yearsExperience ?? 5,
    incidents12m: over.incidents12m ?? 0,
    speedingEvents30d: over.speedingEvents30d ?? 0,
  };
}

describe('<DriverScoreCard />', () => {
  it('renderiza score y level', () => {
    render(<DriverScoreCard profile={profile({ workerUid: 'd1' })} />);
    expect(screen.getByTestId('driver-score-d1')).toBeInTheDocument();
    expect(Number(screen.getByTestId('driver-score-value').textContent)).toBeGreaterThan(80);
  });

  it('autorizado para operar si limpio', () => {
    render(<DriverScoreCard profile={profile({ workerUid: 'd1' })} />);
    expect(screen.getByTestId('driver-can-operate').textContent).toMatch(/Autorizado/);
  });

  it('blockers visibles si licencia vencida', () => {
    render(
      <DriverScoreCard
        profile={profile({ workerUid: 'd1', licenseExpiresAt: '2020-01-01T00:00:00Z' })}
      />,
    );
    expect(screen.getByTestId('driver-blockers')).toBeInTheDocument();
    expect(screen.getByTestId('driver-can-operate').textContent).toMatch(/NO autorizado/);
  });
});
