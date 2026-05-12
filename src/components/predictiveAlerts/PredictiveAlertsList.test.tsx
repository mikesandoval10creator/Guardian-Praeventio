// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PredictiveAlertsList } from './PredictiveAlertsList.js';
import type { ScheduledAlert } from '../../services/predictiveAlerts/alertScheduler.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function alert(id: string): ScheduledAlert {
  return {
    generatorId: id,
    decision: {
      fire: true,
      leadTimeMin: 30,
      recommendedAction: 'Reevaluar tarea',
      forecastValue: 12.5,
    },
    body: 'Alerta predictiva (30 min): Reevaluar tarea',
    scheduledAt: '2026-05-12T10:00:00Z',
  };
}

describe('<PredictiveAlertsList />', () => {
  it('renderiza lista con alertas', () => {
    render(<PredictiveAlertsList alerts={[alert('scaffold-uplift'), alert('uv-extreme')]} />);
    expect(screen.getByTestId('predictive-alerts-list')).toBeInTheDocument();
    expect(screen.getByTestId('predictive-alert-scaffold-uplift')).toBeInTheDocument();
    expect(screen.getByTestId('predictive-alert-uv-extreme')).toBeInTheDocument();
  });

  it('empty state cuando sin alertas', () => {
    render(<PredictiveAlertsList alerts={[]} />);
    expect(screen.getByTestId('predictive-alerts-empty')).toBeInTheDocument();
  });

  it('dispara onAcknowledge', () => {
    const onAck = vi.fn();
    render(<PredictiveAlertsList alerts={[alert('test-gen')]} onAcknowledge={onAck} />);
    fireEvent.click(screen.getByTestId('predictive-alert-ack-test-gen'));
    expect(onAck).toHaveBeenCalled();
  });
});
