// @vitest-environment jsdom
//
// Bloque D Rama 1 — ReturnToWorkPanel render + submit tests (hook mocked).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

const assessMock = vi.fn(async (..._args: unknown[]) => ({
  assessment: {
    workerUid: 'w-1',
    taskId: 't-1',
    fit: 'unfit',
    violatedRestrictions: ['no_height_work'],
    suggestedAccommodations: ['Pausas activas cada 60-90 min mínimo'],
    rationale: 'Tarea entra en conflicto con 1 restricción(es) vigente(s) del trabajador.',
  },
}));

vi.mock('../../hooks/useReturnToWork', () => ({
  assessReturnToWorkTaskFit: (...args: unknown[]) => assessMock(...args),
}));

import { ReturnToWorkPanel } from './ReturnToWorkPanel';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('<ReturnToWorkPanel />', () => {
  it('renders the form with submit disabled until required fields are set', () => {
    render(<ReturnToWorkPanel projectId="proj-1" />);
    expect(screen.getByTestId('return-to-work-panel')).toBeInTheDocument();
    expect(screen.getByTestId('return-to-work-submit')).toBeDisabled();
  });

  it('submits the form via the hook and renders the assessment result', async () => {
    render(<ReturnToWorkPanel projectId="proj-1" />);

    fireEvent.change(screen.getByTestId('return-to-work-worker'), { target: { value: 'w-1' } });
    fireEvent.change(screen.getByTestId('return-to-work-task'), { target: { value: 't-1' } });
    fireEvent.click(screen.getByTestId('return-to-work-submit'));

    await waitFor(() => expect(assessMock).toHaveBeenCalledTimes(1));
    // Hook receives the projectId + the minimal restriction/task payload.
    expect(assessMock.mock.calls[0][0]).toBe('proj-1');
    const input = assessMock.mock.calls[0][1] as {
      workerRestrictions: Array<{ workerUid: string }>;
      task: { taskId: string; conflictsWith: string[] };
    };
    expect(input.workerRestrictions[0].workerUid).toBe('w-1');
    expect(input.task.taskId).toBe('t-1');

    const result = await screen.findByTestId('return-to-work-result');
    expect(result).toHaveTextContent('No apto para esta tarea');
    expect(result).toHaveTextContent('Restricciones en conflicto:');
  });

  it('renders the error state when the hook rejects', async () => {
    assessMock.mockRejectedValueOnce(new Error('http_403'));
    render(<ReturnToWorkPanel projectId="proj-1" />);

    fireEvent.change(screen.getByTestId('return-to-work-worker'), { target: { value: 'w-1' } });
    fireEvent.change(screen.getByTestId('return-to-work-task'), { target: { value: 't-1' } });
    fireEvent.click(screen.getByTestId('return-to-work-submit'));

    const error = await screen.findByTestId('return-to-work-error');
    expect(error).toHaveTextContent(/no tienes permiso/i);
    expect(screen.queryByTestId('return-to-work-result')).toBeNull();
  });
});
