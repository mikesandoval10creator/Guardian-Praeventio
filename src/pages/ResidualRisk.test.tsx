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
//   6. Dialog accesible: cancelación, motivo, submit, error y reintento.
//
// Hermetic — mockea hooks y contexto; no hace requests reales.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { ResidualRisk } from './ResidualRisk';
import type { StoredResidualRisk } from '../hooks/useResidualRisk';

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
vi.mock('../hooks/useResidualRisk', () => ({
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
    expect(screen.getByText(/conectar con el servidor/i)).toBeInTheDocument();
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

  it('abre un diálogo accesible y Escape cancela sin llamar a la API', () => {
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
    render(<ResidualRisk />);
    fireEvent.click(screen.getByTestId('residual-accept-btn-rr-pending'));

    const dialog = screen.getByRole('dialog', { name: /aceptar formalmente/i });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('textbox', { name: /motivo/i })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it('mantiene el foco dentro del diálogo y lo devuelve al activador al cerrar', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRisksResp = {
      data: { risks: [buildRisk({ id: 'rr-pending', requiresFormalAcceptance: true })] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<ResidualRisk />);
    const trigger = screen.getByTestId('residual-accept-btn-rr-pending');
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: /cerrar/i });
    const cancel = within(dialog).getByRole('button', { name: /cancelar/i });
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    cancel.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    fireEvent.click(cancel);
    expect(document.activeElement).toBe(trigger);
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it('Cancelar no llama a la API ni cambia el estado pendiente', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRisksResp = {
      data: { risks: [buildRisk({ id: 'rr-pending', requiresFormalAcceptance: true })] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<ResidualRisk />);
    fireEvent.click(screen.getByTestId('residual-accept-btn-rr-pending'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /cancelar/i }));

    expect(mockAccept).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('residual-pending-rr-pending')).toBeInTheDocument();
  });

  it('cierra el diálogo al cambiar de proyecto para no aceptar el riesgo anterior', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRisksResp = {
      data: { risks: [buildRisk({ id: 'rr-pending', requiresFormalAcceptance: true })] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    const { rerender } = render(<ResidualRisk />);
    fireEvent.click(screen.getByTestId('residual-accept-btn-rr-pending'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    mockSelectedProject = { id: 'p-2', name: 'Faena Sur' };
    rerender(<ResidualRisk />);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockAccept).not.toHaveBeenCalled();
  });

  it('no envía una razón vacía', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockRisksResp = {
      data: { risks: [buildRisk({ id: 'rr-pending', requiresFormalAcceptance: true })] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<ResidualRisk />);
    fireEvent.click(screen.getByTestId('residual-accept-btn-rr-pending'));

    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: /confirmar aceptación/i });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mockAccept).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('bloquea un segundo envío y el cierre mientras la petición sigue en vuelo', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const refetch = vi.fn();
    mockRisksResp = {
      data: { risks: [buildRisk({ id: 'rr-pending', requiresFormalAcceptance: true })] },
      loading: false,
      error: null,
      refetch,
    };
    let resolveAcceptance!: () => void;
    mockAccept.mockImplementationOnce(
      () => new Promise<void>((resolve) => { resolveAcceptance = resolve; }),
    );
    render(<ResidualRisk />);
    fireEvent.click(screen.getByTestId('residual-accept-btn-rr-pending'));
    fireEvent.change(screen.getByRole('textbox', { name: /motivo/i }), {
      target: { value: 'Aceptado por gerencia tras capacitación.' },
    });

    const dialog = screen.getByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /confirmar aceptación/i });
    const cancel = within(dialog).getByRole('button', { name: /cancelar/i });
    fireEvent.click(confirm);
    expect(mockAccept).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(cancel).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(confirm);
    expect(mockAccept).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await act(async () => {
      resolveAcceptance();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('envía una razón válida una sola vez y refresca solo después del éxito del servidor', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const refetch = vi.fn();
    mockRisksResp = {
      data: { risks: [buildRisk({ id: 'rr-pending', requiresFormalAcceptance: true })] },
      loading: false,
      error: null,
      refetch,
    };
    render(<ResidualRisk />);
    fireEvent.click(screen.getByTestId('residual-accept-btn-rr-pending'));
    fireEvent.change(screen.getByRole('textbox', { name: /motivo/i }), {
      target: { value: 'Aceptado por gerencia tras capacitación.' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /confirmar aceptación/i }));

    await waitFor(() => {
      expect(mockAccept).toHaveBeenCalledTimes(1);
    });
    expect(mockAccept).toHaveBeenCalledWith(
      'p-1',
      'rr-pending',
      'Aceptado por gerencia tras capacitación.',
    );
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('muestra el error del servidor y permite reintentar sin marcar el riesgo como aceptado', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const refetch = vi.fn();
    mockRisksResp = {
      data: { risks: [buildRisk({ id: 'rr-pending', requiresFormalAcceptance: true })] },
      loading: false,
      error: null,
      refetch,
    };
    mockAccept.mockRejectedValueOnce(new Error('internal_error'));
    render(<ResidualRisk />);
    fireEvent.click(screen.getByTestId('residual-accept-btn-rr-pending'));
    fireEvent.change(screen.getByRole('textbox', { name: /motivo/i }), {
      target: { value: 'Aceptado por gerencia tras capacitación.' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /confirmar aceptación/i }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(/no pudimos confirmar si la aceptación se guardó/i);
    expect(error).not.toHaveTextContent(/internal_error|500/i);
    expect(mockAccept).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('residual-pending-rr-pending')).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /confirmar aceptación/i }));
    await waitFor(() => expect(mockAccept).toHaveBeenCalledTimes(2));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    {
      code: 'residual_risk_not_found',
      expected: /no encontramos este riesgo en el proyecto/i,
    },
    {
      code: 'forbidden',
      expected: /no tiene permiso para registrar esta aceptación/i,
    },
    {
      code: 'Failed to fetch',
      expected: /resultado no está confirmado/i,
    },
  ])('explica el error $code sin mostrar el código ni el status', async ({ code, expected }) => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const refetch = vi.fn();
    mockRisksResp = {
      data: { risks: [buildRisk({ id: 'rr-pending', requiresFormalAcceptance: true })] },
      loading: false,
      error: null,
      refetch,
    };
    mockAccept.mockRejectedValueOnce(new Error(code));
    render(<ResidualRisk />);
    fireEvent.click(screen.getByTestId('residual-accept-btn-rr-pending'));
    fireEvent.change(screen.getByRole('textbox', { name: /motivo/i }), {
      target: { value: 'Aceptado por gerencia tras capacitación.' },
    });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /confirmar aceptación/i }));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(expected);
    expect(error).not.toHaveTextContent(new RegExp(`${code}|403|404`, 'i'));
    expect(refetch).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
