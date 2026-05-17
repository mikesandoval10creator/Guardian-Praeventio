// @vitest-environment jsdom
//
// Praeventio Guard — §42-44 page wrapper tests.
//
// Smoke tests for `<EngineeringControls />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Error state surfaces hook error.
//   4. List rendering with level badges + risk category + verification status.
//   5. Filter by level updates the hook call.
//   6. Verify action triggers `verifyControl` + refetch.
//
// Mocks are kept minimal and hermetic — no Firestore, no fetch.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EngineeringControls } from './EngineeringControls';
import type {
  EngineeringControlAPI,
  EngineeringControlsOptions,
} from '../hooks/useSprintK';

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

interface HookState {
  data: { controls: EngineeringControlAPI[] } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

let mockResp: HookState;
let lastUseOpts: EngineeringControlsOptions | undefined;
const mockRefetch = vi.fn();
const mockVerifyControl = vi.fn();
const mockCreateEngineeringControl = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../services/firebase', () => ({
  auth: { currentUser: { uid: 'caller_uid' } },
}));
vi.mock('../hooks/useSprintK', () => ({
  useEngineeringControls: (
    _pid: string | null,
    opts?: EngineeringControlsOptions,
  ) => {
    lastUseOpts = opts;
    return { ...mockResp, refetch: mockRefetch };
  },
  createEngineeringControl: (...args: unknown[]) =>
    mockCreateEngineeringControl(...args),
  verifyControl: (...args: unknown[]) => mockVerifyControl(...args),
}));

function makeControl(over: Partial<EngineeringControlAPI> = {}): EngineeringControlAPI {
  return {
    id: over.id ?? 'ec_1',
    level: over.level ?? 'engineering',
    riskCategory: over.riskCategory ?? 'altura',
    name: over.name ?? 'Baranda perimetral',
    description: over.description ?? 'Baranda metálica perimetro nivel 2',
    responsibleUid: over.responsibleUid ?? 'resp_uid',
    verificationFrequencyDays: over.verificationFrequencyDays ?? 30,
    createdAt: over.createdAt ?? '2026-04-01T10:00:00.000Z',
    createdBy: over.createdBy ?? 'creator_uid',
    lastVerifiedAt: over.lastVerifiedAt ?? null,
    verifications: over.verifications ?? [],
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockResp = { data: null, loading: false, error: null, refetch: mockRefetch };
  lastUseOpts = undefined;
  mockRefetch.mockReset();
  mockVerifyControl.mockReset();
  mockCreateEngineeringControl.mockReset();
});

describe('<EngineeringControls /> page wrapper (§42-44)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<EngineeringControls />);
    expect(
      screen.getByTestId('engineering-controls-page-empty'),
    ).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: null,
      loading: true,
      error: null,
      refetch: mockRefetch,
    };
    render(<EngineeringControls />);
    expect(
      screen.getByTestId('engineering-controls-loading'),
    ).toBeInTheDocument();
  });

  it('muestra error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: null,
      loading: false,
      error: new Error('Backend down'),
      refetch: mockRefetch,
    };
    render(<EngineeringControls />);
    expect(
      screen.getByTestId('engineering-controls-error'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Backend down/i)).toBeInTheDocument();
  });

  it('renderiza la lista con badge de nivel + estado de verificación', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: {
        controls: [
          makeControl({
            id: 'ec_a',
            name: 'Ventilación local',
            level: 'engineering',
            riskCategory: 'confinado',
            // Never verified → status rojo + "Nunca verificado".
            lastVerifiedAt: null,
            verificationFrequencyDays: 30,
          }),
        ],
      },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<EngineeringControls />);
    expect(screen.getByTestId('engineering-controls-page')).toBeInTheDocument();
    expect(screen.getByTestId('engineering-controls-list')).toBeInTheDocument();
    expect(
      screen.getByTestId('engineering-controls-card-ec_a'),
    ).toBeInTheDocument();
    // Level badge text comes from the hierarchy meta (Ingeniería).
    expect(
      screen.getByTestId('engineering-controls-level-badge-ec_a'),
    ).toHaveTextContent(/Ingeniería/i);
    expect(
      screen.getByTestId('engineering-controls-status-ec_a'),
    ).toHaveTextContent(/Nunca verificado/i);
    // Hierarchy diagram with the 5 levels is always rendered up top.
    expect(
      screen.getByTestId('engineering-controls-hierarchy-elimination'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('engineering-controls-hierarchy-epp'),
    ).toBeInTheDocument();
  });

  it('cambia el filtro de nivel y re-llama al hook con level=epp', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: { controls: [] },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<EngineeringControls />);
    // Initial render → level=all.
    expect(lastUseOpts?.level).toBe('all');
    fireEvent.click(screen.getByTestId('engineering-controls-level-epp'));
    // After the click the next render reads the new filter from state
    // and passes it to the hook.
    expect(lastUseOpts?.level).toBe('epp');
  });

  it('llama verifyControl + refetch al clickear "Verificar"', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: {
        controls: [
          makeControl({ id: 'ec_b', level: 'epp', name: 'Casco' }),
        ],
      },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
    mockVerifyControl.mockResolvedValue({
      ok: true,
      entry: {
        verifierUid: 'caller_uid',
        verifiedAt: new Date().toISOString(),
        result: 'pass',
      },
    });
    render(<EngineeringControls />);
    const btn = screen.getByTestId('engineering-controls-verify-ec_b');
    fireEvent.click(btn);
    // Wait microtask so the async handler resolves.
    await Promise.resolve();
    await Promise.resolve();
    expect(mockVerifyControl).toHaveBeenCalledWith(
      'p-1',
      'ec_b',
      expect.objectContaining({ verifierUid: 'caller_uid', result: 'pass' }),
    );
    expect(mockRefetch).toHaveBeenCalled();
  });
});
