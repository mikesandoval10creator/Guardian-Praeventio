// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §296-301 page wrapper tests.
//
// Smoke tests para `<ResidualRisk />`:
//   1. Empty state cuando no hay proyecto seleccionado.
//   2. Loading state mientras los hooks traen datos.
//   3. Error del hook se muestra en la UI.
//   4. Lista de riesgos accepted + pending render correcto.
//   5. Banner de "criticidad sospechosa" aparece si hay riesgos flagged.
//   6. Click en "Aceptar formalmente" invoca el mutation.
//
// Hermetic — mockea Sprint K hook + contextos + window.prompt.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ResidualRisk } from './ResidualRisk';
import type { StoredResidualRisk } from '../hooks/useSprintK';

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

type StateMock = {
  data: { risks: StoredResidualRisk[] } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};

let mockRisksResp: StateMock;
let mockSuspiciousResp: StateMock;
const mockRegister = vi.fn();
const mockAccept = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useSprintK', () => ({
  useResidualRisks: () => mockRisksResp,
  useSuspiciousRisks: () => mockSuspiciousResp,
  registerResidualRisk: (...args: unknown[]) => mockRegister(...args),
  acceptResidualRisk: (...args: unknown[]) => mockAccept(...args),
}));

function buildRisk(overrides: Partial<StoredResidualRisk> = {}): StoredResidualRisk {
  return {
    id: 'rr-1',
    hazard: 'Trabajo en altura sin línea de vida',
    category: 'Caída de altura',
    riskKind: 'physical',
    likelihood: 'likely',
    inherentSeverity: 'major',
    residualSeverity: 'moderate',
    currentControls: [{ controlId: 'ctrl-arnes', effectiveness: 'significant' }],
    justification: 'Capacitación + arnés + supervisión continua.',
    initialScore: 16,
    controlReduction: 8,
    residualScore: 8,
    initialLevel: 'extreme',
    residualLevel: 'medium',
    requiresFormalAcceptance: false,
    nextReviewInDays: 180,
    acceptance: {
      status: 'pending',
      signedByUid: null,
      signedAt: null,
      reason: null,
    },
    createdAt: '2026-05-17T12:00:00Z',
    createdBy: 'uid-creator',
    isSuspicious: false,
    suspiciousReason: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  const empty: StateMock = {
    data: null,
    loading: false,
    error: null,
    refetch: vi.fn(),
  };
  mockRisksResp = empty;
  mockSuspiciousResp = empty;
  mockRegister.mockReset();
  mockRegister.mockResolvedValue({ ok: true });
  mockAccept.mockReset();
  mockAccept.mockResolvedValue(undefined);
});

describe('<ResidualRisk /> page wrapper (Sprint K §296-301)', () => {
  it('renderiza empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<ResidualRisk />);
    expect(screen.getByTestId('residual-risk-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras los hooks traen datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRisksResp = {
      data: null,
      loading: true,
      error: null,
      refetch: vi.fn(),
    };
    render(<ResidualRisk />);
    expect(screen.getByTestId('residual-risk-loading')).toBeInTheDocument();
  });

  it('muestra error del hook con el mensaje', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRisksResp = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: vi.fn(),
    };
    render(<ResidualRisk />);
    expect(screen.getByTestId('residual-risk-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('lista riesgos accepted y pending con los testids correctos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const accepted = buildRisk({
      id: 'rr-accepted',
      hazard: 'Soldadura sin extracción',
      requiresFormalAcceptance: true,
      acceptance: {
        status: 'accepted',
        signedByUid: 'gerente-uid',
        signedAt: '2026-05-10T15:00:00Z',
        reason: 'Riesgo aceptado por gerencia tras capacitación adicional.',
      },
    });
    const pending = buildRisk({
      id: 'rr-pending',
      hazard: 'Trabajo en caliente en zona ATEX',
      requiresFormalAcceptance: true,
      residualLevel: 'high',
      residualScore: 12,
      initialLevel: 'extreme',
      initialScore: 20,
    });
    mockRisksResp = {
      data: { risks: [accepted, pending] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<ResidualRisk />);
    expect(screen.getByTestId('residual-risk-page')).toBeInTheDocument();
    expect(screen.getByTestId('residual-risk-card-rr-accepted')).toBeInTheDocument();
    expect(screen.getByTestId('residual-risk-card-rr-pending')).toBeInTheDocument();
    // Accepted shows "accepted by" stamp.
    expect(screen.getByTestId('residual-accepted-rr-accepted')).toBeInTheDocument();
    // Pending shows the pending-acceptance amber strip.
    expect(screen.getByTestId('residual-pending-rr-pending')).toBeInTheDocument();
  });

  it('muestra banner de "criticidad sospechosa" cuando hay riesgos flagged', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const suspicious = buildRisk({
      id: 'rr-suspect',
      hazard: 'Excavación de 3m sin entibado',
      inherentSeverity: 'catastrophic',
      residualSeverity: 'minor',
      isSuspicious: true,
      suspiciousReason:
        'Severidad inherente "catastrophic" cayó a "minor" (4 niveles). Verifica controles.',
    });
    mockRisksResp = {
      data: { risks: [suspicious] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    mockSuspiciousResp = {
      data: { risks: [suspicious] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<ResidualRisk />);
    expect(
      screen.getByTestId('residual-risk-suspicious-banner'),
    ).toBeInTheDocument();
    expect(screen.getByText(/criticidad sospechosa/i)).toBeInTheDocument();
    expect(
      screen.getByTestId('residual-suspicious-reason-rr-suspect'),
    ).toBeInTheDocument();
  });

  it('invoca acceptResidualRisk cuando se hace click en "Aceptar formalmente"', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const pending = buildRisk({
      id: 'rr-pending',
      requiresFormalAcceptance: true,
    });
    mockRisksResp = {
      data: { risks: [pending] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    // Stub window.prompt to provide the acceptance reason without an
    // interactive dialog (jsdom doesn't render one).
    const promptSpy = vi
      .spyOn(window, 'prompt')
      .mockReturnValue('Aceptado por gerencia tras capacitación.');
    render(<ResidualRisk />);
    const btn = screen.getByTestId('residual-accept-btn-rr-pending');
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockAccept).toHaveBeenCalledWith(
        'p-1',
        'rr-pending',
        'Aceptado por gerencia tras capacitación.',
      );
    });
    promptSpy.mockRestore();
  });
});
