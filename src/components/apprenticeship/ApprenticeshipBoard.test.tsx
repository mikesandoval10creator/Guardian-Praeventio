// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ApprenticeshipBoard } from './ApprenticeshipBoard.js';
import type { ApprenticeProfile } from '../../services/apprenticeship/apprenticeshipProgressService.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

function apprentice(): ApprenticeProfile {
  return {
    workerUid: 'app1',
    mentorUid: 'mentor1',
    startedAt: '2026-03-01T00:00:00Z',
    taskAuthorizations: { t1: 'observer', t2: 'supervised' },
  };
}

describe('<ApprenticeshipBoard />', () => {
  it('renderiza tareas con su nivel', () => {
    render(<ApprenticeshipBoard apprentice={apprentice()} executions={[]} />);
    expect(screen.getByTestId('apprentice-task-t1')).toBeInTheDocument();
    expect(screen.getByTestId('apprentice-task-t2')).toBeInTheDocument();
  });

  it('promote button visible cuando ready', () => {
    const executions = Array.from({ length: 5 }, () => ({
      workerUid: 'app1',
      taskId: 't1',
      executedAt: '2026-05-11',
      withMentor: false,
    }));
    const onPromote = vi.fn();
    render(
      <ApprenticeshipBoard
        apprentice={apprentice()}
        executions={executions}
        onPromoteLevel={onPromote}
      />,
    );
    const btn = screen.getByTestId('apprentice-promote-t1');
    fireEvent.click(btn);
    expect(onPromote).toHaveBeenCalledWith('t1', 'supervised');
  });

  it('sin tareas → mensaje empty', () => {
    render(
      <ApprenticeshipBoard
        apprentice={{ ...apprentice(), taskAuthorizations: {} }}
        executions={[]}
      />,
    );
    expect(screen.getByText(/Sin tareas/i)).toBeInTheDocument();
  });
});
