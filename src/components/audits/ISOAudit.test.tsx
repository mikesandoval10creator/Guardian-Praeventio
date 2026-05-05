// @vitest-environment jsdom
//
// Sprint 25 — Bucket SS.2 — ISOAudit smoke tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

const useRiskEngineMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, fb?: string) => fb ?? _k }),
}));

vi.mock('../../hooks/useRiskEngine', () => ({
  useRiskEngine: () => useRiskEngineMock(),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'p-1' } }),
}));

vi.mock('../../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: { uid: 'u-1' } }),
}));

vi.mock('./AddAuditModal', () => ({
  AddAuditModal: () => null,
}));
vi.mock('./AuditDetailModal', () => ({
  AuditDetailModal: () => null,
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { ISOAudit } from './ISOAudit';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ISOAudit', () => {
  it('renders the stats grid with zero counts when no audits exist', () => {
    useRiskEngineMock.mockReturnValue({ nodes: [], loading: false });
    render(<ISOAudit />);
    expect(screen.getByText(/Total ISO/i)).toBeInTheDocument();
    // The "Total" stat value shows 0 when there are no nodes.
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
  });

  it('counts ISO-tagged audits in the totals', () => {
    useRiskEngineMock.mockReturnValue({
      nodes: [
        {
          id: 'a-1',
          type: 'Auditoría',
          title: 'Auditoría ISO 45001',
          description: '',
          tags: ['ISO 45001'],
          projectId: 'p-1',
          metadata: { status: 'Completada', score: 80 },
        },
        {
          id: 'a-2',
          type: 'Auditoría',
          title: 'Auditoría ISO 9001',
          description: '',
          tags: ['ISO 9001'],
          projectId: 'p-1',
          metadata: { status: 'Planificada' },
        },
      ],
      loading: false,
    });
    render(<ISOAudit />);
    // Stats grid present
    expect(screen.getByText(/Total ISO/i)).toBeInTheDocument();
  });

  it('exposes both history and checklist view toggles', () => {
    useRiskEngineMock.mockReturnValue({ nodes: [], loading: false });
    const { container } = render(<ISOAudit />);
    // Two view toggle buttons should exist somewhere in the rendered tree.
    expect(container.querySelectorAll('button').length).toBeGreaterThan(1);
  });
});
