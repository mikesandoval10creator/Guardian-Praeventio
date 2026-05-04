// @vitest-environment jsdom
//
// Sprint 20 — Bucket D — AddWorkerModal integration tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks (must precede the component import) ─────────────────────────────

const addNodeMock = vi.fn(async () => ({ id: 'node-123' }));
const getEPPMock = vi.fn(() => ['Casco', 'Guantes']);

vi.mock('../../hooks/useRiskEngine', () => ({
  useRiskEngine: () => ({
    addNode: addNodeMock,
    addConnection: vi.fn(),
    nodes: [],
  }),
}));

vi.mock('../../hooks/useIndustryIntegration', () => ({
  useIndustryIntegration: () => ({
    getEPP: getEPPMock,
    availableRoles: ['Soldador', 'Operador de Grúa'],
  }),
}));

vi.mock('../../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

vi.mock('../../utils/pwa-offline', () => ({
  saveForSync: vi.fn(async () => undefined),
}));

vi.mock('../../services/firebase', () => ({
  db: {},
  collection: vi.fn(),
  addDoc: vi.fn(async () => ({ id: 'doc-123' })),
  handleFirestoreError: vi.fn(),
  OperationType: { CREATE: 'CREATE', LIST: 'LIST', WRITE: 'WRITE', READ: 'READ' },
}));

// TacticalOnboardingModal is a heavier subtree; stub it to keep the test
// surface tight on the AddWorkerModal contract itself.
vi.mock('./TacticalOnboardingModal', () => ({
  TacticalOnboardingModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? React.createElement('div', { 'data-testid': 'tactical-onboarding-modal' }) : null,
}));

vi.mock('framer-motion', () => {
  const Pass = ({ children, ...rest }: any) =>
    React.createElement('div', rest, children);
  return {
    motion: new Proxy({}, { get: () => Pass }),
    AnimatePresence: ({ children }: any) => children,
  };
});

import { AddWorkerModal } from './AddWorkerModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AddWorkerModal', () => {
  it('renders the modal with required fields when open', () => {
    render(<AddWorkerModal isOpen={true} onClose={() => {}} projectId="proj-1" />);
    expect(screen.getByText(/Añadir Trabajador/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Juan Pérez/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/juan@empresa.com/)).toBeInTheDocument();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <AddWorkerModal isOpen={false} onClose={() => {}} projectId="proj-1" />
    );
    expect(container.querySelector('input[type="email"]')).toBeNull();
  });

  it('happy-path: filling fields + submitting calls addNode and shows onboarding', async () => {
    render(<AddWorkerModal isOpen={true} onClose={() => {}} projectId="proj-1" />);
    fireEvent.change(screen.getByPlaceholderText(/Juan Pérez/), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByPlaceholderText(/Soldador/i), { target: { value: 'Soldador' } });
    fireEvent.change(screen.getByPlaceholderText(/juan@empresa.com/), {
      target: { value: 'ana@x.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(addNodeMock).toHaveBeenCalled());
    // After successful save → onboarding modal appears.
    await waitFor(() => {
      expect(screen.getByTestId('tactical-onboarding-modal')).toBeInTheDocument();
    });
  });
});
