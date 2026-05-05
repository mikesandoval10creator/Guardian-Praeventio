// @vitest-environment jsdom
//
// Sprint 25 — Bucket SS.2 — ISOManagement smoke tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';

const useProjectMock = vi.fn();
const useFirebaseMock = vi.fn();

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
  useRiskEngine: () => ({ nodes: [] }),
}));
vi.mock('./ISOAudit', () => ({
  ISOAudit: () => React.createElement('div', { 'data-testid': 'iso-audit' }),
}));
vi.mock('./ISOManagementHeader', () => ({
  ISOManagementHeader: () =>
    React.createElement('div', { 'data-testid': 'iso-header' }),
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
  vi.clearAllMocks();
});

describe('ISOManagement', () => {
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
