// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MentalLoadSurveyForm } from './MentalLoadSurveyForm.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

describe('<MentalLoadSurveyForm />', () => {
  it('renderiza las 6 dimensiones', () => {
    render(<MentalLoadSurveyForm workerUid="w1" onSubmit={vi.fn()} />);
    expect(screen.getByTestId('mental-load-dim-mentalDemand')).toBeInTheDocument();
    expect(screen.getByTestId('mental-load-dim-physicalDemand')).toBeInTheDocument();
    expect(screen.getByTestId('mental-load-dim-temporalDemand')).toBeInTheDocument();
    expect(screen.getByTestId('mental-load-dim-effort')).toBeInTheDocument();
    expect(screen.getByTestId('mental-load-dim-frustration')).toBeInTheDocument();
    expect(screen.getByTestId('mental-load-dim-performance')).toBeInTheDocument();
  });

  it('submit envía survey + score computed', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<MentalLoadSurveyForm workerUid="w1" onSubmit={onSubmit} />);
    fireEvent.submit(screen.getByTestId('mental-load-survey-form'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const [survey, score] = onSubmit.mock.calls[0];
    expect(survey.workerUid).toBe('w1');
    expect(score.overallLoad).toBe(50);
  });

  it('slider cambia valor', () => {
    render(<MentalLoadSurveyForm workerUid="w1" onSubmit={vi.fn()} />);
    const slider = screen.getByTestId('mental-load-slider-frustration') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '90' } });
    expect(slider.value).toBe('90');
  });

  it('error se muestra si onSubmit rechaza', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('quota_exceeded'));
    render(<MentalLoadSurveyForm workerUid="w1" onSubmit={onSubmit} />);
    fireEvent.submit(screen.getByTestId('mental-load-survey-form'));
    const err = await screen.findByTestId('mental-load-error');
    expect(err).toHaveTextContent('quota_exceeded');
  });
});
