// @vitest-environment jsdom
//
// B1 — EmergencySquadManager must show the REAL brigade roster, not a hardcoded
// mock. Before this, the component rendered four fabricated members (Carlos
// Mendoza, Ana Silva, …) with invented live status/distance. This suite pins:
// the real roster (from useEmergencyBrigade) is rendered with names resolved
// from the project workers, real roles and training validity, and honest
// empty / loading / error states — and the old fabricated names never appear.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

const ble = vi.hoisted(() => ({
  supported: false,
  user: { uid: 'u1' } as { uid: string } | null,
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
}));
vi.mock('../../contexts/FirebaseContext', () => ({ useFirebase: () => ({ user: ble.user }) }));
vi.mock('../../contexts/ProjectContext', () => ({ useProject: () => ({ selectedProject: { id: 'p1', name: 'Proj' } }) }));
vi.mock('../../contexts/EmergencyContext', () => ({ useEmergency: () => ({ triggerEmergency: vi.fn() }) }));
vi.mock('../../hooks/useBluetoothMesh', () => ({
  useBluetoothMesh: () => ({ isSupported: ble.supported, isScanning: false, peerBreadcrumbs: [], startScanning: ble.start, stopScanning: ble.stop }),
}));
// Test scan lifecycle, not animation-frame scheduling (which leaks in jsdom).
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const Div = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement> & { initial?: unknown; animate?: unknown; exit?: unknown; transition?: unknown }>(
    ({ children, initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props }, ref) =>
      React.createElement('div', { ...props, ref }, children),
  );
  return { motion: { div: Div }, AnimatePresence: ({ children }: { children: React.ReactNode }) => children };
});
vi.mock('./SkillTree', () => ({ SkillTree: () => null }));
vi.mock('../../utils/offlineStorage', () => ({ getBreadcrumbs: vi.fn(async () => []) }));

const mockBrigade = vi.fn();
const mockWorkers = vi.fn();
vi.mock('../../hooks/useEmergencyBrigade', () => ({ useEmergencyBrigade: () => mockBrigade() }));
vi.mock('../../hooks/useFirestoreCollection', () => ({ useFirestoreCollection: () => mockWorkers() }));

import { EmergencySquadManager } from './EmergencySquadManager';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  ble.supported = false;
  ble.user = { uid: 'u1' };
  mockBrigade.mockReturnValue({ data: null, loading: false, error: null, refetch: vi.fn() });
  mockWorkers.mockReturnValue({ data: [] });
});

describe('EmergencySquadManager — real brigade roster (B1)', () => {
  it('stops BLE search when leaving the search view', async () => {
    ble.supported = true;
    render(<EmergencySquadManager />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Búsqueda/i })); });
    expect(ble.start).toHaveBeenCalledTimes(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Brigada$/i })); });
    expect(ble.stop).toHaveBeenCalledTimes(1);
  });
  it('stops search on unmount and logout, without restarting for an equivalent user object', async () => {
    ble.supported = true;
    const { rerender, unmount } = render(<EmergencySquadManager />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Búsqueda/i })); });
    ble.user = { uid: 'u1' };
    rerender(<EmergencySquadManager />);
    expect(ble.start).toHaveBeenCalledTimes(1);
    expect(ble.stop).not.toHaveBeenCalled();
    ble.user = null;
    rerender(<EmergencySquadManager />);
    expect(ble.stop).toHaveBeenCalledTimes(1);
    ble.user = { uid: 'u1' };
    rerender(<EmergencySquadManager />);
    expect(ble.start).toHaveBeenCalledTimes(2);
    unmount();
    expect(ble.stop).toHaveBeenCalledTimes(2);
  });

  it('does not start unsupported BLE or a search without a signed-in user', async () => {
    const { rerender } = render(<EmergencySquadManager />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Búsqueda/i })); });
    expect(ble.start).not.toHaveBeenCalled();
    ble.supported = true;
    ble.user = null;
    rerender(<EmergencySquadManager />);
    expect(ble.start).not.toHaveBeenCalled();
    expect(ble.stop).not.toHaveBeenCalled();
  });

  it('shows an honest empty state when no brigade is configured (no fabricated members)', () => {
    mockBrigade.mockReturnValue({ data: { members: [] }, loading: false, error: null, refetch: vi.fn() });
    render(<EmergencySquadManager />);
    expect(screen.getByText(/Aún no hay brigada configurada/i)).toBeInTheDocument();
    expect(screen.queryByText('Carlos Mendoza')).not.toBeInTheDocument();
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument();
  });

  it('renders the REAL roster: name resolved from workers + role + active status', () => {
    mockBrigade.mockReturnValue({
      data: {
        members: [
          { workerUid: 'w1', role: 'brigade_chief', trainedAt: '2026-01-01T00:00:00Z', trainingValidYears: 3, active: true },
          { workerUid: 'w2', role: 'first_aid', trainedAt: '2020-01-01T00:00:00Z', trainingValidYears: 1, active: false },
        ],
      },
      loading: false, error: null, refetch: vi.fn(),
    });
    mockWorkers.mockReturnValue({
      data: [
        { id: 'w1', name: 'Carla Soto', certifications: ['Rescate en Altura'] },
        { id: 'w2', name: 'Pedro Díaz', certifications: [] },
      ],
    });
    render(<EmergencySquadManager />);

    // Real names + roles.
    expect(screen.getByText('Carla Soto')).toBeInTheDocument();
    expect(screen.getByText('Jefe de Brigada')).toBeInTheDocument();
    expect(screen.getByText('Pedro Díaz')).toBeInTheDocument();
    expect(screen.getByText('Primeros Auxilios')).toBeInTheDocument();
    // Real active/inactive (not a fabricated live status).
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
    // Real training validity: w1 (2026 + 3y) vigente, w2 (2020 + 1y) vencida.
    expect(screen.getByText(/Capacitación vigente/i)).toBeInTheDocument();
    expect(screen.getByText(/Capacitación vencida/i)).toBeInTheDocument();
    // The old hardcoded mock must be gone.
    expect(screen.queryByText('Carlos Mendoza')).not.toBeInTheDocument();
    expect(screen.queryByText('María Gómez')).not.toBeInTheDocument();
  });

  it('falls back to a uid-based label when a worker name is not found (no crash, no fake name)', () => {
    mockBrigade.mockReturnValue({
      data: { members: [{ workerUid: 'abc123xyz', role: 'communications', trainedAt: '2026-01-01T00:00:00Z', trainingValidYears: 2, active: true }] },
      loading: false, error: null, refetch: vi.fn(),
    });
    mockWorkers.mockReturnValue({ data: [] }); // worker record missing
    render(<EmergencySquadManager />);
    expect(screen.getByText(/Trabajador abc123/i)).toBeInTheDocument();
    expect(screen.getByText('Comunicaciones')).toBeInTheDocument();
  });

  it('shows honest loading and error states', () => {
    mockBrigade.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() });
    const { rerender } = render(<EmergencySquadManager />);
    expect(screen.getByText(/Cargando brigada/i)).toBeInTheDocument();

    mockBrigade.mockReturnValue({ data: null, loading: false, error: new Error('boom'), refetch: vi.fn() });
    rerender(<EmergencySquadManager />);
    expect(screen.getByText(/No se pudo cargar la brigada/i)).toBeInTheDocument();
    expect(screen.getByText('Reintentar')).toBeInTheDocument();
  });
});
