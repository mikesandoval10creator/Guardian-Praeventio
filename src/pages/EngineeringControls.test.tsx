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
} from '../hooks/useEngineeringControls';

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
  // Codex P2 (PR #319): the response may carry a `warning` flag when
  // the server's read of the inventory partially failed. The test mock
  // mirrors the wire shape so we can exercise the degraded-data banner.
  data: {
    controls: EngineeringControlAPI[];
    warning?: 'partial_read_failure';
  } | null;
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
vi.mock('../hooks/useEngineeringControls', () => ({
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
    // Codex P1 (PR #319): the client no longer sends `verifierUid` —
    // the server derives the verifier identity from the authenticated
    // caller. The call should contain only `result` (and optional
    // `evidence`) in the payload, never an arbitrary uid string.
    expect(mockVerifyControl).toHaveBeenCalledWith(
      'p-1',
      'ec_b',
      expect.objectContaining({ result: 'pass' }),
    );
    const verifyCallArgs = mockVerifyControl.mock.calls[0]?.[2] as
      | Record<string, unknown>
      | undefined;
    expect(verifyCallArgs).toBeDefined();
    expect(verifyCallArgs).not.toHaveProperty('verifierUid');
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('mantiene visible el botón "Todos los riesgos" cuando el filtro está activo y no hay categorías', () => {
    // Codex P2 (PR #319): when the user picks a category and then
    // switches to a level with zero matching controls, the chip row
    // must still surface the clear button so the stale `riskFilter` is
    // recoverable without a page reload. We simulate this by setting a
    // risk filter manually after first render with categories present.
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: {
        controls: [
          makeControl({ id: 'ec_x', riskCategory: 'altura', level: 'engineering' }),
        ],
      },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
    const { rerender } = render(<EngineeringControls />);
    // Click the only existing risk chip to activate `riskFilter`. The
    // chip is the only `<button>` whose accessible name is the category
    // string (the strong tag inside the card is not a button), so a
    // role-scoped query disambiguates it from any card text.
    fireEvent.click(
      screen.getByRole('button', { name: 'altura' }),
    );
    // Now simulate the server returning an empty list under that filter.
    mockResp = {
      data: { controls: [] },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
    rerender(<EngineeringControls />);
    // Clear button must still be there so the user can recover.
    expect(
      screen.getByTestId('engineering-controls-risk-clear'),
    ).toBeInTheDocument();
  });

  it('siempre muestra controles con riskCategory "general" aunque haya filtro activo', () => {
    // Codex P2 (PR #319): `general` controls are cross-cutting (they
    // mitigate every risk, not a specific category) and must stay
    // visible regardless of `riskFilter`. A user filtering by "altura"
    // would otherwise hide a general control that also applies to
    // altura, painting an incomplete inventory.
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: {
        controls: [
          makeControl({ id: 'ec_alt', riskCategory: 'altura', name: 'Baranda' }),
          makeControl({ id: 'ec_gen', riskCategory: 'general', name: 'Señalética' }),
        ],
      },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
    const { rerender } = render(<EngineeringControls />);
    // Pick `altura` filter chip.
    fireEvent.click(
      screen.getByRole('button', { name: 'altura' }),
    );
    rerender(<EngineeringControls />);
    // The altura control is visible.
    expect(
      screen.getByTestId('engineering-controls-card-ec_alt'),
    ).toBeInTheDocument();
    // …and the general control is still visible (cross-cutting).
    expect(
      screen.getByTestId('engineering-controls-card-ec_gen'),
    ).toBeInTheDocument();
  });

  it('registra una verificación con result=fail + evidencia desde la UI', async () => {
    // Codex P2 (PR #319, round 2): the verify UI now exposes
    // observation/fail outcomes — not just OK — so an inspector who
    // finds a defective control can record the truth (with optional
    // evidence) instead of having to skip the check or submit a false
    // OK that would advance `lastVerifiedAt` and corrupt the audit
    // trail. This test exercises the full flow: open the fail panel,
    // type evidence, submit, assert the payload + refetch.
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: {
        controls: [makeControl({ id: 'ec_f', level: 'engineering', name: 'Resguardo' })],
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
        result: 'fail',
        evidence: 'Tornillo suelto en la guarda derecha',
      },
    });
    render(<EngineeringControls />);
    // Open the fail panel.
    fireEvent.click(screen.getByTestId('engineering-controls-fail-ec_f'));
    // Type evidence.
    fireEvent.change(screen.getByTestId('engineering-controls-evidence-input-ec_f'), {
      target: { value: 'Tornillo suelto en la guarda derecha' },
    });
    // Submit.
    fireEvent.click(screen.getByTestId('engineering-controls-evidence-submit-ec_f'));
    await Promise.resolve();
    await Promise.resolve();
    expect(mockVerifyControl).toHaveBeenCalledWith(
      'p-1',
      'ec_f',
      expect.objectContaining({
        result: 'fail',
        evidence: 'Tornillo suelto en la guarda derecha',
      }),
    );
    // The client-side guard against an empty trimmed evidence value
    // must never emit `verifierUid` on the wire (Codex P1 round 1).
    const args = mockVerifyControl.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    expect(args).toBeDefined();
    expect(args).not.toHaveProperty('verifierUid');
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('registra una observación sin evidencia (campo vacío no llega como string vacío)', async () => {
    // Codex P2 (PR #319, round 2): the evidence field is optional. If
    // the user submits with the textarea empty (or whitespace), we must
    // NOT send `evidence: ''` — the server validator allows it but it
    // pollutes the audit trail with empty notes. The handler trims and
    // drops the field entirely when empty.
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: {
        controls: [makeControl({ id: 'ec_o', level: 'engineering', name: 'Aspirador' })],
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
        result: 'observation',
      },
    });
    render(<EngineeringControls />);
    fireEvent.click(screen.getByTestId('engineering-controls-observation-ec_o'));
    // Leave evidence blank; submit.
    fireEvent.click(screen.getByTestId('engineering-controls-evidence-submit-ec_o'));
    await Promise.resolve();
    await Promise.resolve();
    const args = mockVerifyControl.mock.calls[0]?.[2] as Record<string, unknown> | undefined;
    expect(args).toBeDefined();
    expect(args).toEqual(expect.objectContaining({ result: 'observation' }));
    expect(args).not.toHaveProperty('evidence');
  });

  it('muestra banner de lectura parcial cuando el servidor reporta partial_read_failure', () => {
    // Codex P2 (PR #319): degraded-data banner must appear when the
    // server returns `warning: 'partial_read_failure'`. Without it the
    // page would silently show an empty (or partial) inventory and the
    // user could act on incorrect compliance data.
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: { controls: [], warning: 'partial_read_failure' },
      loading: false,
      error: null,
      refetch: mockRefetch,
    };
    render(<EngineeringControls />);
    expect(
      screen.getByTestId('engineering-controls-warning'),
    ).toBeInTheDocument();
  });
});
