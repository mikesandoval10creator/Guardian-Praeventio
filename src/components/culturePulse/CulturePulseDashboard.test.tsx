// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CulturePulseDashboard } from './CulturePulseDashboard.js';
import type { PulseSurveyResponse } from '../../services/culturePulse/safetyCulturePulse.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function response(over: Partial<PulseSurveyResponse> & { responderHash: string }): PulseSurveyResponse {
  return {
    responderHash: over.responderHash,
    workerRole: 'worker',
    area: over.area ?? 'A',
    answers: over.answers ?? {
      felt_safe_today: 4,
      manager_listens: 4,
      free_to_stop: 4,
      reported_incident_safely: 4,
      has_resources_to_be_safe: 4,
    },
    submittedAt: over.submittedAt ?? '2026-05-11T10:00:00Z',
  };
}

describe('<CulturePulseDashboard />', () => {
  it('muestra índice global', () => {
    render(
      <CulturePulseDashboard
        responses={[response({ responderHash: 'h1' }), response({ responderHash: 'h2' })]}
      />,
    );
    expect(screen.getByTestId('culture-pulse-global')).toBeInTheDocument();
  });

  it('flag punitive cuando free_to_stop bajo', () => {
    render(
      <CulturePulseDashboard
        responses={[
          response({
            responderHash: 'h1',
            answers: {
              felt_safe_today: 4,
              manager_listens: 4,
              free_to_stop: 1,
              reported_incident_safely: 4,
              has_resources_to_be_safe: 4,
            },
          }),
        ]}
      />,
    );
    expect(screen.getByTestId('culture-pulse-punitive-flag')).toBeInTheDocument();
  });

  it('drill-down por área cuando hay >1 área', () => {
    render(
      <CulturePulseDashboard
        responses={[
          response({ responderHash: 'h1', area: 'A' }),
          response({ responderHash: 'h2', area: 'B' }),
        ]}
      />,
    );
    expect(screen.getByTestId('culture-area-A')).toBeInTheDocument();
    expect(screen.getByTestId('culture-area-B')).toBeInTheDocument();
  });

  it('onAreaClick recibe el área', () => {
    const onClick = vi.fn();
    render(
      <CulturePulseDashboard
        responses={[
          response({ responderHash: 'h1', area: 'A' }),
          response({ responderHash: 'h2', area: 'B' }),
        ]}
        onAreaClick={onClick}
      />,
    );
    fireEvent.click(screen.getByTestId('culture-area-A'));
    expect(onClick).toHaveBeenCalledWith('A');
  });
});
