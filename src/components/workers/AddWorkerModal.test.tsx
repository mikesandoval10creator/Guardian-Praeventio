// @vitest-environment jsdom
//
// Sprint 20 — Bucket D — AddWorkerModal integration tests.

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';

// ─── Mocks (must precede the component import) ─────────────────────────────
const onboarding = vi.hoisted(() => ({ data: null as unknown, online: true, workerSequence: 0 }));

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
  useOnlineStatus: () => onboarding.online,
}));

vi.mock('../../utils/pwa-offline', () => ({
  saveForSync: vi.fn(async () => undefined),
}));

vi.mock('../../services/firebase', () => ({
  db: {},
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: `offline-worker-${++onboarding.workerSequence}` })),
  addDoc: vi.fn(async () => ({ id: 'doc-123' })),
  handleFirestoreError: vi.fn(),
  OperationType: { CREATE: 'CREATE', LIST: 'LIST', WRITE: 'WRITE', READ: 'READ' },
}));

// TacticalOnboardingModal is a heavier subtree; stub it to keep the test
// surface tight on the AddWorkerModal contract itself.
vi.mock('./TacticalOnboardingModal', () => ({
  TacticalOnboardingModal: ({ isOpen, workerData }: { isOpen: boolean; workerData: unknown }) => {
    onboarding.data = workerData;
    return isOpen ? React.createElement('div', { 'data-testid': 'tactical-onboarding-modal' }) : null;
  },
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
  onboarding.online = true;
  onboarding.workerSequence = 0;
  onboarding.data = null;
});

describe('AddWorkerModal', () => {
  it('allocates and queues the same offline worker identity passed to onboarding', async () => {
    onboarding.online = false;
    const { saveForSync } = await import('../../utils/pwa-offline');
    render(<AddWorkerModal isOpen onClose={() => {}} projectId="project-offline" />);
    fireEvent.change(screen.getByPlaceholderText(/Juan Pérez/), { target: { value: 'Same Name' } });
    fireEvent.change(screen.getByPlaceholderText(/Soldador/i), { target: { value: 'Soldador' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(onboarding.data).toMatchObject({ id: 'offline-worker-1', projectId: 'project-offline' }));
    expect(saveForSync).toHaveBeenCalledWith(expect.objectContaining({ collection: 'projects/project-offline/workers', docId: 'offline-worker-1' }));
    expect(addNodeMock).not.toHaveBeenCalled();
  });
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
      expect(onboarding.data).toMatchObject({ id: 'doc-123', projectId: 'proj-1', name: 'Ana', role: 'Soldador' });
    });
  });
});
