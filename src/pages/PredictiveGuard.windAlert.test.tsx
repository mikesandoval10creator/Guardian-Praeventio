// @vitest-environment jsdom
//
// [P0][VIDA] The adverse-weather card asked "¿Deseas enviar una alerta para
// suspender trabajos en altura?" over two buttons with NO onClick. A supervisor
// seeing 60+ km/h winds pressed "Sí, Enviar Alerta" and nothing left the screen.
//
// Praeventio recommends; the human decides; the decision is recorded and
// reaches the crew. These tests pin that the decision actually travels, that
// the reading that motivated it travels with it, and that a failure is told to
// the user in words rather than as a status code.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'p1', name: 'Faena' } }),
}));
vi.mock('../hooks/useRiskEngine', () => ({ useRiskEngine: () => ({ nodes: [] }) }));
vi.mock('../contexts/UniversalKnowledgeContext', () => ({
  useUniversalKnowledge: () => ({
    environment: { weather: { windSpeed: 62, temp: 12, humidity: 40, condition: 'Ventoso' } },
  }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaders: async () => ({ 'Content-Type': 'application/json' }),
}));
vi.mock('../services/geminiService', () => ({ generatePredictiveForecast: vi.fn() }));
vi.mock('../lib/structuralLoadProbesClient', () => ({
  fetchStructuralLoadProbes: vi.fn(async () => []),
}));
vi.mock('../components/predictive/AlertSchedulerMount', () => ({ ackPredictiveAlert: vi.fn() }));
vi.mock('../components/predictiveAlerts/PredictiveAlertsList', () => ({
  PredictiveAlertsList: () => null,
}));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { PredictiveGuard } from './PredictiveGuard';

beforeEach(() => cleanup());
afterEach(() => vi.unstubAllGlobals());

describe('PredictiveGuard — adverse wind recommendation', () => {
  it('sends the recommendation with the wind reading that motivated it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ notificationId: 'n1' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<PredictiveGuard />);
    fireEvent.click(screen.getByTestId('wind-alert-send'));

    await waitFor(() => expect(screen.getByTestId('wind-alert-sent')).toBeInTheDocument());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/predictive-alerts/issue-recommendation');
    const sent = JSON.parse(init.body);
    expect(sent.source).toBe('weather.wind');
    expect(sent.metric).toEqual({ kind: 'wind', value: 62, unit: 'km/h' });
    expect(sent.recommendedAction).toMatch(/suspender trabajos en altura/i);
  });

  it('tells the user in words when the send fails — never a status code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: 'forbidden' }),
      }),
    );

    render(<PredictiveGuard />);
    fireEvent.click(screen.getByTestId('wind-alert-send'));

    const msg = await screen.findByTestId('wind-alert-error');
    expect(msg.textContent ?? '').not.toMatch(/\b403\b/);
    expect(msg.textContent ?? '').not.toMatch(/forbidden/i);
    expect((msg.textContent ?? '').length).toBeGreaterThan(10);
  });

  it('dismissing hides the card instead of leaving a dead button', async () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<PredictiveGuard />);
    expect(screen.getByTestId('wind-alert-send')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('wind-alert-dismiss'));

    await waitFor(() =>
      expect(screen.queryByTestId('wind-alert-send')).not.toBeInTheDocument(),
    );
  });
});
