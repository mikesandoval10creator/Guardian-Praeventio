// @vitest-environment jsdom
//
// Praeventio Guard — Fase F.15 page wrapper tests.
//
// Smoke tests for `<WorkPermits />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Error surfaces from the hook.
//   4. Renders permit list from the hook data.
//   5. Renders empty (no records) state when projectId present but list empty.
//   6. Kind filter button toggles the active kind.
//   7. Status filter button toggles the active status.
//   8. Sign action triggers `signWorkPermit` mutation.
//   9. Close action triggers `closeWorkPermit` mutation.
//
// Hermetic — no Firestore, no fetch. Mocks ProjectContext, useOnlineStatus,
// useWorkPermits, and the mutation helpers.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkPermits } from './WorkPermits';
import type { WorkPermit } from '../services/workPermits/workPermitEngine';

vi.mock('../services/firebase', () => ({
  auth: { currentUser: { uid: 'auth-user-123' } },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      _k: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      if (typeof fallback === 'string') {
        if (opts && typeof opts === 'object') {
          let out = fallback;
          for (const [key, val] of Object.entries(opts)) {
            out = out.replace(`{{${key}}}`, String(val));
          }
          return out;
        }
        return fallback;
      }
      return _k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockResp: {
  data: { permits: WorkPermit[] } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
const mockSignWorkPermit = vi.fn<(projectId: string, permitId: string) => Promise<{ permit: WorkPermit }>>(
  async () => ({ permit: {} as WorkPermit }),
);
const mockCloseWorkPermit = vi.fn<
  (projectId: string, permitId: string, reason: string, outcome: 'fulfill' | 'cancel') => Promise<{ permit: WorkPermit }>
>(async () => ({ permit: {} as WorkPermit }));
const mockCreateWorkPermit = vi.fn<(...args: unknown[]) => Promise<{ permit: WorkPermit }>>(
  async () => ({ permit: {} as WorkPermit }),
);

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useSprintK', () => ({
  useWorkPermits: () => mockResp,
  signWorkPermit: (projectId: string, permitId: string) =>
    mockSignWorkPermit(projectId, permitId),
  closeWorkPermit: (
    projectId: string,
    permitId: string,
    reason: string,
    outcome: 'fulfill' | 'cancel',
  ) => mockCloseWorkPermit(projectId, permitId, reason, outcome),
  createWorkPermit: (...args: unknown[]) => mockCreateWorkPermit(...args),
}));

function makePermit(overrides: Partial<WorkPermit> = {}): WorkPermit {
  const now = new Date();
  const future = new Date(now.getTime() + 6 * 3_600_000);
  return {
    id: 'wp_1',
    kind: 'altura',
    workerUid: 'worker-1',
    approverUid: 'sup-1',
    approverRole: 'supervisor',
    zoneId: 'zone-1',
    taskDescription: 'Cambio de luminaria en plataforma N3.',
    status: 'active',
    preconditions: {
      workerHasTraining: true,
      workerHasEpp: true,
      workerMedicallyFit: true,
      checklist: {
        items: [
          {
            id: 'altura-check-0',
            label: 'Verificar arnés y línea de vida',
            checked: true,
          },
          {
            id: 'altura-check-1',
            label: 'Verificar superficie de apoyo / barandas',
            checked: true,
          },
          {
            id: 'altura-check-2',
            label: 'Verificar condiciones climáticas (viento ≤ 60 km/h)',
            checked: true,
          },
          {
            id: 'altura-check-3',
            label: 'Verificar plan rescate',
            checked: true,
          },
        ],
      },
    },
    createdAt: now.toISOString(),
    approvedAt: now.toISOString(),
    validFrom: now.toISOString(),
    validUntil: future.toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockResp = {
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
  mockSignWorkPermit.mockClear();
  mockCloseWorkPermit.mockClear();
  mockCreateWorkPermit.mockClear();
});

describe('<WorkPermits /> page wrapper (Fase F.15)', () => {
  it('renders the empty-state when no project is selected', () => {
    mockSelectedProject = null;
    render(<WorkPermits />);
    expect(
      screen.getByTestId('work-permits-page-empty'),
    ).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renders loading state while the hook fetches', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    };
    render(<WorkPermits />);
    expect(screen.getByTestId('work-permits-loading')).toBeInTheDocument();
  });

  it('renders error state when the hook fails', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: vi.fn(),
    };
    render(<WorkPermits />);
    expect(screen.getByTestId('work-permits-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('renders the list of permits and shows the offline chip when offline', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockIsOnline = false;
    const permit = makePermit();
    mockResp = {
      data: { permits: [permit] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<WorkPermits />);
    expect(screen.getByTestId('work-permits-page')).toBeInTheDocument();
    expect(
      screen.getByTestId('work-permits-offline-chip'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('work-permits-list')).toBeInTheDocument();
    expect(screen.getByText(/1 permisos cargados/i)).toBeInTheDocument();
    expect(
      screen.getByTestId(`work-permits-item.${permit.id}`),
    ).toBeInTheDocument();
  });

  it('renders empty-list message when projectId present but no permits', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: { permits: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<WorkPermits />);
    expect(screen.getByTestId('work-permits-empty')).toBeInTheDocument();
  });

  it('toggles the kind filter when a kind chip is clicked', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: { permits: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<WorkPermits />);
    const caliente = screen.getByTestId('work-permits-kind.caliente');
    fireEvent.click(caliente);
    // The button switches to the active styling (white text on amber bg).
    expect(caliente.className).toMatch(/bg-amber-500/);
  });

  it('toggles the status filter when a status chip is clicked', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: { permits: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<WorkPermits />);
    const expired = screen.getByTestId('work-permits-status.expired');
    fireEvent.click(expired);
    expect(expired.className).toMatch(/bg-teal-500/);
  });

  it('invokes signWorkPermit when the sign button is clicked', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const permit = makePermit();
    mockResp = {
      data: { permits: [permit] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<WorkPermits />);
    const btn = screen.getByTestId(`work-permits-sign.${permit.id}`);
    fireEvent.click(btn);
    // Wait a microtask for the awaited mock to resolve.
    await Promise.resolve();
    expect(mockSignWorkPermit).toHaveBeenCalledTimes(1);
    expect(mockSignWorkPermit.mock.calls[0]).toEqual(['p-1', permit.id]);
  });

  it('invokes closeWorkPermit when the fulfill button is clicked', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const permit = makePermit();
    mockResp = {
      data: { permits: [permit] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    // The page calls window.prompt to capture a close reason. Stub it.
    const promptSpy = vi
      .spyOn(window, 'prompt')
      .mockReturnValue('Trabajo finalizado conforme protocolo.');
    render(<WorkPermits />);
    const fulfillBtn = screen.getByTestId(`permit-fulfill-${permit.id}`);
    fireEvent.click(fulfillBtn);
    await Promise.resolve();
    expect(promptSpy).toHaveBeenCalled();
    expect(mockCloseWorkPermit).toHaveBeenCalledTimes(1);
    const args = mockCloseWorkPermit.mock.calls[0];
    expect(args[0]).toBe('p-1');
    expect(args[1]).toBe(permit.id);
    expect(args[2]).toBe('Trabajo finalizado conforme protocolo.');
    expect(args[3]).toBe('fulfill');
    promptSpy.mockRestore();
  });

  it('preserves the cancel outcome — clicking Cancelar sends outcome=cancel (Codex P2 #5)', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const permit = makePermit();
    mockResp = {
      data: { permits: [permit] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    const promptSpy = vi
      .spyOn(window, 'prompt')
      .mockReturnValue('Cambio de plan por condición climática severa.');
    render(<WorkPermits />);
    const cancelBtn = screen.getByTestId(`permit-cancel-${permit.id}`);
    fireEvent.click(cancelBtn);
    await Promise.resolve();
    expect(mockCloseWorkPermit).toHaveBeenCalledTimes(1);
    const args = mockCloseWorkPermit.mock.calls[0];
    expect(args[0]).toBe('p-1');
    expect(args[1]).toBe(permit.id);
    expect(args[2]).toBe('Cambio de plan por condición climática severa.');
    expect(args[3]).toBe('cancel');
    promptSpy.mockRestore();
  });

  it('builds the create payload without auto-attesting checklist (Codex P1 #1 + P1 #2 + P2 #3)', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: { permits: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<WorkPermits />);
    // Open the form.
    fireEvent.click(screen.getByTestId('work-permits-new-button'));
    fireEvent.change(screen.getByTestId('work-permits-form.task'), {
      target: { value: 'Cambio de luminaria en plataforma N3 esta noche.' },
    });
    fireEvent.click(screen.getByTestId('work-permits-form.submit'));
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCreateWorkPermit).toHaveBeenCalledTimes(1);
    const [pid, payload] = mockCreateWorkPermit.mock.calls[0] as [string, Record<string, unknown>];
    expect(pid).toBe('p-1');
    // No fabricated 'self' uids.
    expect(payload.workerUid).toBe('auth-user-123');
    // No issuer authority leak.
    expect(payload).not.toHaveProperty('approverUid');
    expect(payload).not.toHaveProperty('approverRole');
    // No pre-attested checklist or preconditions.
    expect(payload).not.toHaveProperty('preconditions');
  });
});
