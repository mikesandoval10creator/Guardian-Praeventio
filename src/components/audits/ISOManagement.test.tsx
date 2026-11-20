// @vitest-environment jsdom
//
// Sprint 25 — Bucket SS.2 — ISOManagement smoke tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { NodeType } from '../../types';

const useProjectMock = vi.fn();
const useFirebaseMock = vi.fn();
const useRiskEngineMock = vi.fn((): { nodes: object[] } => ({ nodes: [] }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

vi.mock('firebase/firestore', () => ({
  addDoc: vi.fn(async () => ({ id: 'doc-1' })),
  collection: vi.fn(),
}));

vi.mock('../../services/firebase', () => ({ db: {} }));
vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => useProjectMock(),
}));
vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => useFirebaseMock(),
}));
vi.mock('../../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: [], loading: false }),
}));
vi.mock('../../hooks/useRiskEngine', () => ({
  useRiskEngine: () => useRiskEngineMock(),
}));
vi.mock('./ISOAudit', () => ({
  ISOAudit: () => React.createElement('div', { 'data-testid': 'iso-audit' }),
}));
vi.mock('./ISOManagementHeader', () => ({
  ISOManagementHeader: ({ auditCount, isoRiskCount }: { auditCount: number; isoRiskCount: number }) =>
    React.createElement('div', { 'data-testid': 'iso-header' }, `${auditCount}/${isoRiskCount}`),
}));
vi.mock('./ISOManagementFilters', () => ({
  ISOManagementFilters: () =>
    React.createElement('div', { 'data-testid': 'iso-filters' }),
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { ISOManagement } from './ISOManagement';

afterEach(() => {
  cleanup();
  useRiskEngineMock.mockReset();
  vi.clearAllMocks();
});

describe('ISOManagement', () => {
  it('does not rescan 2,000 unchanged nodes when switching dashboard tabs', () => {
    useProjectMock.mockReturnValue({ selectedProject: { id: 'p-1' } });
    useFirebaseMock.mockReturnValue({ user: { uid: 'u-1' } });
    const readType = vi.fn(() => NodeType.AUDIT);
    const nodes = Array.from({ length: 2_000 }, () => ({
      get type() { return readType(); },
      projectId: 'p-1',
      metadata: { status: 'Completada' },
    }));
    useRiskEngineMock.mockReturnValue({ nodes });
    render(<ISOManagement />);
    expect(readType).toHaveBeenCalled();
    readType.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Auditorías' }));
    expect(screen.getByTestId('iso-audit')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dashboard' }));
    expect(screen.getByTestId('iso-header')).toBeInTheDocument();
    expect(readType.mock.calls.length).toBe(0);
  });

  it('refreshes both counts when the project or node snapshot changes', () => {
    useProjectMock.mockReturnValue({ selectedProject: { id: 'p-1' } });
    useFirebaseMock.mockReturnValue({ user: { uid: 'u-1' } });
    const nodes = [
      { type: NodeType.AUDIT, projectId: 'p-1', metadata: { status: 'Completado' } },
      { type: NodeType.AUDIT, projectId: 'p-2', metadata: { status: 'Pendiente' } },
      { type: NodeType.RISK, projectId: 'p-2', tags: ['iso'], metadata: { nivel: 'Alto' } },
      { type: NodeType.RISK, projectId: 'p-2', tags: ['iso'], metadata: { severity: 'Bajo' } },
    ];
    useRiskEngineMock.mockReturnValue({ nodes });
    const { rerender } = render(<ISOManagement />);
    expect(screen.getByTestId('iso-header')).toHaveTextContent('1/0');
    useProjectMock.mockReturnValue({ selectedProject: { id: 'p-2' } });
    rerender(<ISOManagement />);
    expect(screen.getByTestId('iso-header')).toHaveTextContent('0/1');
    useRiskEngineMock.mockReturnValue({ nodes: [
      ...nodes,
      { type: NodeType.AUDIT, projectId: 'p-2', metadata: { status: 'Completada' } },
    ] });
    rerender(<ISOManagement />);
    expect(screen.getByTestId('iso-header')).toHaveTextContent('1/1');
  });
  it('renders the empty state when no project is selected', () => {
    useProjectMock.mockReturnValue({ selectedProject: null });
    useFirebaseMock.mockReturnValue({ user: { uid: 'u-1' } });
    render(<ISOManagement />);
    expect(screen.getByText(/Selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renders the empty state when no user is authenticated', () => {
    useProjectMock.mockReturnValue({ selectedProject: { id: 'p-1' } });
    useFirebaseMock.mockReturnValue({ user: null });
    render(<ISOManagement />);
    expect(screen.getByText(/Selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renders the dashboard tab when project + user are present', () => {
    useProjectMock.mockReturnValue({ selectedProject: { id: 'p-1' } });
    useFirebaseMock.mockReturnValue({ user: { uid: 'u-1' } });
    render(<ISOManagement />);
    expect(screen.getByTestId('iso-header')).toBeInTheDocument();
    // Tab bar is rendered with at least the Dashboard tab.
    expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
  });
});
