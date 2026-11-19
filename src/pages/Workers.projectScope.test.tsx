// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Workers } from './Workers';

const mocks = vi.hoisted(() => ({
  project: null as { id: string; name: string } | null,
  useCollection: vi.fn(() => ({ data: [], loading: false, error: null })),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: mocks.project }) }));
vi.mock('../hooks/useFirestoreCollection', () => ({ useFirestoreCollection: mocks.useCollection }));
vi.mock('../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    button: ({ children, onClick }: React.ComponentProps<'button'>) => (
      <button onClick={onClick}>{children}</button>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('../components/shared/EmptyState', () => ({ EmptyState: () => null }));
vi.mock('../components/workers/AddWorkerModal', () => ({ AddWorkerModal: () => null }));
vi.mock('../components/workers/EditWorkerModal', () => ({ EditWorkerModal: () => null }));
vi.mock('../components/workers/DocsModal', () => ({ DocsModal: () => null }));
vi.mock('../components/workers/EPPModal', () => ({ EPPModal: () => null }));
vi.mock('../components/workers/MassImportModal', () => ({ MassImportModal: () => null }));
vi.mock('../components/workers/PersonalizedSafetyPlan', () => ({ PersonalizedSafetyPlan: () => null }));
vi.mock('../components/workers/TrainingRecommendations', () => ({ TrainingRecommendations: () => null }));
vi.mock('../components/workers/AccessControlModal', () => ({ AccessControlModal: () => null }));
vi.mock('../components/workers/TraceabilityModal', () => ({ TraceabilityModal: () => null }));
vi.mock('../components/workers/UserProfileModal', () => ({ UserProfileModal: () => null }));

afterEach(() => {
  cleanup();
  mocks.project = null;
  mocks.useCollection.mockClear();
});

describe('Workers project context', () => {
  it('asks for a project without subscribing to a collection or offering creation', () => {
    render(<Workers />);
    expect(mocks.useCollection).not.toHaveBeenCalled();
    expect(screen.getByText('workers.select_project')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'workers.add_worker' })).toBeNull();
  });

  it('queries only the selected project and removes creation on deselection', () => {
    mocks.project = { id: 'site-a', name: 'Site A' };
    const view = render(<Workers />);
    expect(mocks.useCollection).toHaveBeenCalledWith('projects/site-a/workers');
    expect(screen.getByRole('button', { name: 'workers.add_worker' })).toBeTruthy();

    mocks.project = null;
    mocks.useCollection.mockClear();
    view.rerender(<Workers />);
    expect(mocks.useCollection).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'workers.add_worker' })).toBeNull();
  });
});
