// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalmRecommendationCard } from './CalmRecommendationCard.js';
import type { CalmRecommendation } from '../../services/external/recommendationBuilder.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function rec(over: Partial<CalmRecommendation> = {}): CalmRecommendation {
  return {
    title: 'Considerar evento natural en zona',
    body: 'Se detectó actividad natural en proximidad.',
    severity: 'caution',
    citation: { source: 'natural-event-feed', refId: 'EONET-12345' },
    actions: [
      { kind: 'review_protocols', label: 'Revisar protocolos' },
      { kind: 'consult_weather', label: 'Consultar pronóstico' },
    ],
    blockOperation: false,
    ...over,
  };
}

describe('<CalmRecommendationCard />', () => {
  it('renderiza title/body/severity', () => {
    render(<CalmRecommendationCard recommendation={rec()} />);
    expect(screen.getByTestId('calm-rec-EONET-12345')).toBeInTheDocument();
    expect(screen.getByTestId('calm-rec-severity-EONET-12345').textContent).toBe('caution');
  });

  it('lista acciones', () => {
    render(<CalmRecommendationCard recommendation={rec()} />);
    expect(screen.getByTestId('calm-rec-action-EONET-12345-0')).toBeInTheDocument();
    expect(screen.getByTestId('calm-rec-action-EONET-12345-1')).toBeInTheDocument();
  });

  it('expande detalle técnico opt-in', () => {
    render(
      <CalmRecommendationCard
        recommendation={rec({ expandableDetail: 'Fuente: NASA EONET id EONET-12345' })}
      />,
    );
    expect(screen.queryByTestId('calm-rec-detail-EONET-12345')).toBeNull();
    fireEvent.click(screen.getByTestId('calm-rec-toggle-EONET-12345'));
    expect(screen.getByTestId('calm-rec-detail-EONET-12345')).toBeInTheDocument();
  });

  it('citation genérica sin nombre de organismo', () => {
    render(<CalmRecommendationCard recommendation={rec()} />);
    expect(screen.getByTestId('calm-rec-citation-EONET-12345').textContent).toMatch(
      /natural-event-feed/,
    );
    expect(screen.getByTestId('calm-rec-citation-EONET-12345').textContent).not.toMatch(/NASA/);
  });
});
