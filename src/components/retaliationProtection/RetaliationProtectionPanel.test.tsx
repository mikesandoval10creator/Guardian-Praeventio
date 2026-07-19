// @vitest-environment jsdom
//
// Bloque D Rama 1 — RetaliationProtectionPanel render + submit tests
// (hook mocked: analyze → recommend-actions chain).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const assessment = {
  reporterUid: 'w-9',
  score: 35,
  level: 'moderate',
  signalCount: 1,
  topKinds: ['salary_change'],
  consideredSignals: [
    {
      kind: 'salary_change',
      severity: 'medium',
      observedAt: '2026-07-06',
      reporterUid: 'w-9',
      supervisorUid: 's-2',
    },
  ],
};

const analyzeMock = vi.fn(async (..._args: unknown[]) => ({ assessment }));
const recommendMock = vi.fn(async (..._args: unknown[]) => ({
  actions: [
    { kind: 'wellbeing_check_in', rationale: 'Moderate risk — schedule confidential wellbeing follow-up.' },
    { kind: 'legal_counsel_referral', rationale: 'Material employment change detected — refer to legal counsel.' },
  ],
}));

vi.mock('../../hooks/useRetaliationProtection', () => ({
  analyzeRetaliationRiskRemote: (...args: unknown[]) => analyzeMock(...args),
  recommendProtectiveActionsRemote: (...args: unknown[]) => recommendMock(...args),
}));

import { RetaliationProtectionPanel } from './RetaliationProtectionPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<RetaliationProtectionPanel />', () => {
  it('renders the form with submit disabled until uids are set', () => {
    render(<RetaliationProtectionPanel projectId="proj-1" />);
    expect(screen.getByTestId('retaliation-protection-panel')).toBeInTheDocument();
    expect(screen.getByTestId('retaliation-protection-submit')).toBeDisabled();
  });

  it('submits, chains analyze → recommend-actions and renders both results', async () => {
    render(<RetaliationProtectionPanel projectId="proj-1" />);

    fireEvent.change(screen.getByTestId('retaliation-protection-reporter'), { target: { value: 'w-9' } });
    fireEvent.change(screen.getByTestId('retaliation-protection-supervisor'), { target: { value: 's-2' } });
    fireEvent.click(screen.getByTestId('retaliation-protection-submit'));

    await waitFor(() => expect(recommendMock).toHaveBeenCalledTimes(1));
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(analyzeMock.mock.calls[0][0]).toBe('proj-1');
    const analyzeInput = analyzeMock.mock.calls[0][1] as {
      signals: Array<{ reporterUid: string; supervisorUid: string }>;
    };
    expect(analyzeInput.signals[0].reporterUid).toBe('w-9');
    expect(analyzeInput.signals[0].supervisorUid).toBe('s-2');
    // recommend-actions receives the assessment produced by analyze.
    expect(recommendMock.mock.calls[0][1]).toEqual({ assessment });

    const result = await screen.findByTestId('retaliation-protection-result');
    expect(result).toHaveTextContent('Riesgo moderado');
    expect(result).toHaveTextContent('(35/100)');
    expect(result).toHaveTextContent('Check-in confidencial de bienestar');
    expect(result).toHaveTextContent('Derivación a asesoría legal');
  });

  it('renders the error state when analyze rejects', async () => {
    analyzeMock.mockRejectedValueOnce(new Error('http_400'));
    render(<RetaliationProtectionPanel projectId="proj-1" />);

    fireEvent.change(screen.getByTestId('retaliation-protection-reporter'), { target: { value: 'w-9' } });
    fireEvent.change(screen.getByTestId('retaliation-protection-supervisor'), { target: { value: 's-2' } });
    fireEvent.click(screen.getByTestId('retaliation-protection-submit'));

    const error = await screen.findByTestId('retaliation-protection-error');
    expect(error).toHaveTextContent(/Faltan datos obligatorios/i);
    expect(recommendMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('retaliation-protection-result')).toBeNull();
  });
});
