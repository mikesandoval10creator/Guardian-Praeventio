// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrivacyRegimeCard } from './PrivacyRegimeCard.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<PrivacyRegimeCard />', () => {
  it('renderiza régimen Chile (Ley 19.628)', () => {
    render(<PrivacyRegimeCard context={{ country: 'CL' }} />);
    expect(screen.getByTestId('privacy-regime-card')).toBeInTheDocument();
    expect(screen.getByTestId('privacy-regime-LEY-19628-CL')).toBeInTheDocument();
  });

  it('renderiza régimen UE (GDPR-EU) con deadline 30d', () => {
    render(<PrivacyRegimeCard context={{ country: 'DE' }} />);
    expect(screen.getByTestId('privacy-regime-GDPR-EU')).toBeInTheDocument();
    expect(screen.getByTestId('privacy-deadline').textContent).toMatch(/30d/);
  });

  it('marca data residency requerida para Russia (152-FZ)', () => {
    render(<PrivacyRegimeCard context={{ country: 'RU' }} />);
    expect(screen.getByTestId('privacy-regime-152-FZ-RU')).toBeInTheDocument();
    expect(screen.getByTestId('privacy-residency').textContent).toMatch(
      /Requerido/,
    );
  });

  it('estado vacío para país no mapeado', () => {
    render(<PrivacyRegimeCard context={{ country: 'ZZ' }} />);
    expect(screen.getByTestId('privacy-regime-empty')).toBeInTheDocument();
  });

  it('lista al menos rights de access + erasure cuando aplica GDPR', () => {
    render(<PrivacyRegimeCard context={{ country: 'FR' }} />);
    expect(screen.getByTestId('privacy-right-access')).toBeInTheDocument();
    expect(screen.getByTestId('privacy-right-erasure')).toBeInTheDocument();
  });
});
