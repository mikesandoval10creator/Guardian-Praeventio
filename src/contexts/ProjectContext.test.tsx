// @vitest-environment jsdom

import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type SnapshotHandler = (snapshot: {
  docs: Array<{ id: string; data: () => Record<string, unknown> }>;
}) => void;

const harness = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
  snapshotHandler: null as SnapshotHandler | null,
  user: { uid: 'user-1' },
}));

vi.mock('../services/firebase', () => ({
  db: {},
  collection: vi.fn(() => ({ path: 'projects' })),
  query: vi.fn((value: unknown) => value),
  where: vi.fn(() => ({ type: 'where' })),
  onSnapshot: harness.onSnapshot,
  handleFirestoreError: vi.fn(),
  OperationType: { LIST: 'list', WRITE: 'write' },
}));

vi.mock('./FirebaseContext', () => ({
  useFirebase: () => ({
    isAuthReady: true,
    user: harness.user,
    isAdmin: false,
  }),
}));

vi.mock('../hooks/usePendingActions', () => ({ usePendingActions: () => [] }));
vi.mock('../hooks/useToast', () => ({
  useToast: () => ({ toasts: [], show: vi.fn(), dismiss: vi.fn() }),
}));
vi.mock('../components/shared/ToastContainer', () => ({ ToastContainer: () => null }));
vi.mock('../components/shared/GuestSaveModal', () => ({ GuestSaveModal: () => null }));
vi.mock('../services/analytics', () => ({ analytics: { track: vi.fn() } }));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('../data/demoProject', () => ({ DEMO_DASHBOARD_PROJECT: { id: 'demo' } }));
vi.mock('../services/engineering/scratchCalculations', () => ({
  promoteAllScratchToProject: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/zettelkasten/persistence/writeNode', () => ({
  writeNodesDebounced: vi.fn(),
}));

import { ProjectProvider, useProject } from './ProjectContext';

interface TestProject {
  id: string;
  name: string;
  description: string;
  location: string;
  industry: string;
  status: 'active';
  startDate: string;
  riskLevel: 'Bajo';
}

const project = (id: string, name: string): TestProject => ({
  id,
  name,
  description: '',
  location: 'Santiago',
  industry: 'Minería',
  status: 'active',
  startDate: '2026-01-01',
  riskLevel: 'Bajo',
});

const snapshot = (...projects: TestProject[]) => ({
  docs: projects.map(({ id, ...data }) => ({ id, data: () => data })),
});

const controller: { select: (value: TestProject | null) => void } = {
  select: () => undefined,
};

const flushAsyncEffects = () =>
  act(async () => {
    await new Promise(resolve => window.setTimeout(resolve, 0));
  });

function Consumer() {
  const { selectedProject, setSelectedProject } = useProject();
  controller.select = (value) => setSelectedProject(value);
  return (
    <div>
      <span data-testid="selected-id">{selectedProject?.id ?? 'none'}</span>
      <span data-testid="selected-name">{selectedProject?.name ?? 'none'}</span>
    </div>
  );
}

beforeEach(() => {
  harness.snapshotHandler = null;
  harness.onSnapshot.mockReset();
  harness.onSnapshot.mockImplementation(
    (_query: unknown, onNext: SnapshotHandler) => {
      harness.snapshotHandler = onNext;
      return vi.fn();
    },
  );
  window.localStorage.clear();
});

describe('ProjectProvider project selection reconciliation', () => {
  it('does not revert from project B to A when Firestore emits a new snapshot', async () => {
    render(
      <ProjectProvider>
        <Consumer />
      </ProjectProvider>,
    );

    expect(harness.snapshotHandler).not.toBeNull();
    act(() => harness.snapshotHandler?.(snapshot(project('a', 'Faena A'), project('b', 'Faena B'))));
    await flushAsyncEffects();
    expect(screen.getByTestId('selected-id')).toHaveTextContent('a');

    act(() => controller.select(project('b', 'Faena B')));
    await flushAsyncEffects();
    expect(screen.getByTestId('selected-id')).toHaveTextContent('b');

    act(() =>
      harness.snapshotHandler?.(
        snapshot(project('a', 'Faena A actualizada'), project('b', 'Faena B actualizada')),
      ),
    );

    expect(screen.getByTestId('selected-id')).toHaveTextContent('b');
    expect(screen.getByTestId('selected-name')).toHaveTextContent('Faena B actualizada');
    expect(harness.onSnapshot).toHaveBeenCalledTimes(1);
  });

  it('falls back only when the selected project is no longer available', async () => {
    render(
      <ProjectProvider>
        <Consumer />
      </ProjectProvider>,
    );

    act(() => harness.snapshotHandler?.(snapshot(project('a', 'Faena A'), project('b', 'Faena B'))));
    act(() => controller.select(project('b', 'Faena B')));
    await flushAsyncEffects();

    act(() => harness.snapshotHandler?.(snapshot(project('a', 'Faena A'))));
    expect(screen.getByTestId('selected-id')).toHaveTextContent('a');

    act(() => harness.snapshotHandler?.(snapshot()));
    expect(screen.getByTestId('selected-id')).toHaveTextContent('none');
    expect(harness.onSnapshot).toHaveBeenCalledTimes(1);
  });
});
