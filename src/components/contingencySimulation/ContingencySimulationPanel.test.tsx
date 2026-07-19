// @vitest-environment jsdom
//
// Bloque D Rama 2 — ContingencySimulationPanel render + submit tests (hook mocked).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const buildMock = vi.fn(async (..._args: unknown[]) => ({
  scenario: {
    id: 'fire_moderate_1',
    kind: 'fire',
    severity: 'moderate',
    title: 'Incendio en bodega de materiales — turno día',
    initialConditions: { time: 'day', staffPresent: 45, criticalSystemsDown: [] },
    triggerEvents: [{ minute: 0, event: 'Alarma de humo en bodega central' }],
    decisionPoints: [
      {
        minute: 5,
        question: '¿Evacuar toda la faena?',
        options: ['Sí', 'No'],
        correctResponses: ['Sí'],
        rationale: 'Humo visible en zona de tránsito.',
      },
    ],
    successCriteria: ['Evacuación completa en menos de 8 minutos'],
    estimatedDurationMin: 45,
  },
}));

vi.mock('../../hooks/useContingencySimulation', () => ({
  buildContingencyScenario: (...args: unknown[]) => buildMock(...args),
}));

import { ContingencySimulationPanel } from './ContingencySimulationPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<ContingencySimulationPanel />', () => {
  it('renders the form with kind/severity selects and an enabled submit', () => {
    render(<ContingencySimulationPanel projectId="proj-1" />);
    expect(screen.getByTestId('contingency-simulation-panel')).toBeInTheDocument();
    expect(screen.getByTestId('contingency-simulation-kind')).toBeInTheDocument();
    expect(screen.getByTestId('contingency-simulation-severity')).toBeInTheDocument();
    expect(screen.getByTestId('contingency-simulation-submit')).toBeEnabled();
  });

  it('submits the selected kind/severity via the hook and renders the scenario', async () => {
    render(<ContingencySimulationPanel projectId="proj-1" />);

    fireEvent.change(screen.getByTestId('contingency-simulation-kind'), { target: { value: 'fire' } });
    fireEvent.change(screen.getByTestId('contingency-simulation-severity'), { target: { value: 'moderate' } });
    fireEvent.click(screen.getByTestId('contingency-simulation-submit'));

    await waitFor(() => expect(buildMock).toHaveBeenCalledTimes(1));
    expect(buildMock.mock.calls[0][0]).toBe('proj-1');
    expect(buildMock.mock.calls[0][1]).toEqual({ kind: 'fire', severity: 'moderate' });

    const result = await screen.findByTestId('contingency-simulation-result');
    expect(result).toHaveTextContent('Incendio en bodega de materiales — turno día');
    expect(result).toHaveTextContent('Duración estimada: 45 min');
    expect(result).toHaveTextContent('Puntos de decisión: 1');
    expect(result).toHaveTextContent('Evacuación completa en menos de 8 minutos');
  });

  it('renders the error state when the hook rejects', async () => {
    buildMock.mockRejectedValueOnce(new Error('http_500'));
    render(<ContingencySimulationPanel projectId="proj-1" />);

    fireEvent.click(screen.getByTestId('contingency-simulation-submit'));

    const error = await screen.findByTestId('contingency-simulation-error');
    expect(error).toHaveTextContent(/servidor tuvo un problema/i);
    expect(screen.queryByTestId('contingency-simulation-result')).toBeNull();
  });
});
