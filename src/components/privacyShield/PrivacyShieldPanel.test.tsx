// @vitest-environment jsdom
//
// Bloque D Rama 1 — PrivacyShieldPanel render + submit tests (hook mocked).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const classifyMock = vi.fn(async (..._args: unknown[]) => ({
  report: {
    fieldPath: 'workers.rut',
    category: 'identity',
    sensitivity: 'medium',
    retentionDays: 730,
    requiresExplicitConsent: false,
    mustEncryptAtRest: false,
    mustMaskInLogs: true,
  },
}));

vi.mock('../../hooks/usePrivacyShield', () => ({
  classifyPiiField: (...args: unknown[]) => classifyMock(...args),
}));

import { PrivacyShieldPanel } from './PrivacyShieldPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<PrivacyShieldPanel />', () => {
  it('renders the form with submit disabled until fieldPath is set', () => {
    render(<PrivacyShieldPanel projectId="proj-1" />);
    expect(screen.getByTestId('privacy-shield-panel')).toBeInTheDocument();
    expect(screen.getByTestId('privacy-shield-submit')).toBeDisabled();
  });

  it('submits the field via the hook and renders the classification report', async () => {
    render(<PrivacyShieldPanel projectId="proj-1" />);

    fireEvent.change(screen.getByTestId('privacy-shield-field-path'), { target: { value: 'workers.rut' } });
    fireEvent.click(screen.getByTestId('privacy-shield-submit'));

    await waitFor(() => expect(classifyMock).toHaveBeenCalledTimes(1));
    expect(classifyMock.mock.calls[0][0]).toBe('proj-1');
    expect(classifyMock.mock.calls[0][1]).toEqual({
      field: { fieldPath: 'workers.rut', category: 'identity', encrypted: false },
    });

    const result = await screen.findByTestId('privacy-shield-result');
    expect(result).toHaveTextContent('Sensibilidad: Media');
    expect(result).toHaveTextContent('730');
    expect(result).toHaveTextContent('Mascarado en logs obligatorio: Sí');
  });

  it('renders the error state when the hook rejects', async () => {
    classifyMock.mockRejectedValueOnce(new Error('http_500'));
    render(<PrivacyShieldPanel projectId="proj-1" />);

    fireEvent.change(screen.getByTestId('privacy-shield-field-path'), { target: { value: 'workers.rut' } });
    fireEvent.click(screen.getByTestId('privacy-shield-submit'));

    const error = await screen.findByTestId('privacy-shield-error');
    expect(error).toHaveTextContent('http_500');
    expect(screen.queryByTestId('privacy-shield-result')).toBeNull();
  });
});
