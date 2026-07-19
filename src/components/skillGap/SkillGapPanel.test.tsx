// @vitest-environment jsdom
//
// Bloque D Rama 2 — SkillGapPanel render + submit tests (hook mocked).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const analyzeMock = vi.fn(async (..._args: unknown[]) => ({
  gaps: [
    {
      workerUid: 'w-1',
      skillId: 'izaje-critico',
      currentLevel: 'none',
      requiredLevel: 'competent',
      gapLevels: 3,
      critical: true,
    },
  ],
}));

vi.mock('../../hooks/useSkillGap', () => ({
  analyzeWorkerSkillGaps: (...args: unknown[]) => analyzeMock(...args),
}));

import { SkillGapPanel } from './SkillGapPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<SkillGapPanel />', () => {
  it('renders the form with submit disabled until required fields are set', () => {
    render(<SkillGapPanel projectId="proj-1" />);
    expect(screen.getByTestId('skill-gap-panel')).toBeInTheDocument();
    expect(screen.getByTestId('skill-gap-submit')).toBeDisabled();
  });

  it('submits the form via the hook and renders the gap result', async () => {
    render(<SkillGapPanel projectId="proj-1" />);

    fireEvent.change(screen.getByTestId('skill-gap-worker'), { target: { value: 'w-1' } });
    fireEvent.change(screen.getByTestId('skill-gap-skill'), { target: { value: 'izaje-critico' } });
    fireEvent.click(screen.getByTestId('skill-gap-submit'));

    await waitFor(() => expect(analyzeMock).toHaveBeenCalledTimes(1));
    // Hook receives the projectId + the minimal skills/requirements payload.
    expect(analyzeMock.mock.calls[0][0]).toBe('proj-1');
    const input = analyzeMock.mock.calls[0][1] as {
      workerSkills: Array<{ workerUid: string; skillId: string; level: string }>;
      requirements: Array<{ skillId: string; minLevel: string; critical: boolean }>;
    };
    expect(input.workerSkills[0].workerUid).toBe('w-1');
    expect(input.workerSkills[0].skillId).toBe('izaje-critico');
    expect(input.requirements[0].minLevel).toBe('competent');
    expect(input.requirements[0].critical).toBe(true);

    const result = await screen.findByTestId('skill-gap-result');
    expect(result).toHaveTextContent('izaje-critico');
    expect(result).toHaveTextContent('3 nivel(es) de brecha');
    expect(result).toHaveTextContent('Crítica');
  });

  it('renders the error state when the hook rejects', async () => {
    analyzeMock.mockRejectedValueOnce(new Error('http_403'));
    render(<SkillGapPanel projectId="proj-1" />);

    fireEvent.change(screen.getByTestId('skill-gap-worker'), { target: { value: 'w-1' } });
    fireEvent.change(screen.getByTestId('skill-gap-skill'), { target: { value: 'izaje-critico' } });
    fireEvent.click(screen.getByTestId('skill-gap-submit'));

    const error = await screen.findByTestId('skill-gap-error');
    expect(error).toHaveTextContent(/no tienes permiso/i);
    expect(screen.queryByTestId('skill-gap-result')).toBeNull();
  });
});
