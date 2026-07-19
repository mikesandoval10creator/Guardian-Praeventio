// @vitest-environment jsdom
//
// Bloque D Rama 4 — PricingSimulatorPanel render + submit tests (hook mocked).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const estimateMock = vi.fn(async (..._args: unknown[]) => ({
  estimate: {
    tier: 'starter',
    baseClp: 29_990,
    overage: {
      workers: { excess: 0, clp: 0 },
      projects: { excess: 0, clp: 0 },
      aiCalls: { excess: 0, clp: 0 },
      storage: { excess: 0, clp: 0 },
    },
    totalOverageClp: 0,
    totalClp: 29_990,
    fitsWithoutOverage: true,
  },
}));

vi.mock('../../hooks/usePricingSimulator', () => ({
  estimateBillFor: (...args: unknown[]) => estimateMock(...args),
}));

import { PricingSimulatorPanel } from './PricingSimulatorPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<PricingSimulatorPanel />', () => {
  it('renders the form with the submit control enabled', () => {
    render(<PricingSimulatorPanel projectId="proj-1" />);
    expect(screen.getByTestId('pricing-simulator-panel')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-simulator-submit')).toBeEnabled();
  });

  it('submits the form via the hook and renders the bill estimate', async () => {
    render(<PricingSimulatorPanel projectId="proj-1" />);

    fireEvent.change(screen.getByTestId('pricing-simulator-workers'), { target: { value: '25' } });
    fireEvent.change(screen.getByTestId('pricing-simulator-projects'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('pricing-simulator-submit'));

    await waitFor(() => expect(estimateMock).toHaveBeenCalledTimes(1));
    // Hook receives the projectId + the minimal tier/usage payload.
    expect(estimateMock.mock.calls[0][0]).toBe('proj-1');
    const input = estimateMock.mock.calls[0][1] as {
      tier: string;
      usage: { workers: number; projects: number };
    };
    expect(input.tier).toBe('starter');
    expect(input.usage.workers).toBe(25);
    expect(input.usage.projects).toBe(3);

    const result = await screen.findByTestId('pricing-simulator-result');
    expect(result).toHaveTextContent('Total estimado / mes');
    expect(result).toHaveTextContent('Tu uso cabe en el plan sin excedentes.');
  });

  it('renders the error state when the hook rejects', async () => {
    estimateMock.mockRejectedValueOnce(new Error('http_403'));
    render(<PricingSimulatorPanel projectId="proj-1" />);

    fireEvent.click(screen.getByTestId('pricing-simulator-submit'));

    const error = await screen.findByTestId('pricing-simulator-error');
    expect(error).toHaveTextContent(/no tienes permiso/i);
    expect(screen.queryByTestId('pricing-simulator-result')).toBeNull();
  });
});
