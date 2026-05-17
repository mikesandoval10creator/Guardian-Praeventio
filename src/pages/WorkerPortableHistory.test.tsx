// @vitest-environment jsdom
//
// Praeventio Guard — Sprint 42 Fase F.18 page wrapper tests.
//
// Smoke tests for `<WorkerPortableHistory />`:
//   1. Empty state when no project is selected.
//   2. Loading state while the hook fetches.
//   3. Error state from the hook.
//   4. Render the bundle with all section headers.
//   5. RUT is `[REDACTED]` when consent.allowsPortableExport === false.
//   6. Export buttons are disabled when consent is off.
//   7. Saving consent calls the mutation with the correct payload.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WorkerPortableHistory } from './WorkerPortableHistory';
import type { PortableHistoryBundle } from '../hooks/useSprintK';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      return _k;
    },
  }),
}));

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockUser: { uid: string; email: string | null; displayName: string | null } | null = null;
let mockIsAdmin = false;

type Resp = {
  data: { bundle: PortableHistoryBundle } | null;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
};
let mockResp: Resp;

const updateConsentMock = vi.fn();
const exportMock = vi.fn();
const refetchMock = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: mockUser, isAdmin: mockIsAdmin }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useFirestoreCollection', () => ({
  useFirestoreCollection: () => ({ data: [] as never[] }),
}));
vi.mock('../hooks/useSprintK', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useSprintK')>(
    '../hooks/useSprintK',
  );
  return {
    ...actual,
    useWorkerPortableHistory: () => mockResp,
    updatePortableConsent: (...args: unknown[]) => updateConsentMock(...args),
    exportPortableHistory: (...args: unknown[]) => exportMock(...args),
  };
});

function makeBundle(overrides: Partial<PortableHistoryBundle> = {}): PortableHistoryBundle {
  return {
    schemaVersion: '1.0.0',
    generatedAt: '2026-05-17T10:00:00.000Z',
    workerUid: 'w-1',
    consent: {
      allowsPortableExport: false,
      includesIncidents: false,
      updatedAt: '2026-05-10T00:00:00.000Z',
      updatedByUid: 'w-1',
    },
    identity: {
      fullName: '[REDACTED]',
      rut: '[REDACTED]',
      email: null,
    },
    trainings: [],
    eppDeliveries: [],
    aptitudes: [],
    criticalRoles: [],
    signatures: [],
    incidents: [],
    disclaimer: 'Praeventio nunca diagnostica.',
    ...overrides,
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockUser = { uid: 'w-1', email: 'w@example.com', displayName: 'Worker Test' };
  mockIsAdmin = false;
  mockResp = {
    data: null,
    loading: false,
    error: null,
    refetch: refetchMock,
  };
  updateConsentMock.mockReset();
  exportMock.mockReset();
  refetchMock.mockReset();
  updateConsentMock.mockResolvedValue({
    allowsPortableExport: true,
    includesIncidents: false,
    updatedAt: '2026-05-17T10:00:00.000Z',
    updatedByUid: 'w-1',
  });
  exportMock.mockResolvedValue({
    blob: new Blob(['{}'], { type: 'application/json' }),
    filename: 'portable-history-w-1.json',
    checksum: 'abc123def456',
  });
});

describe('<WorkerPortableHistory /> page wrapper (Sprint 42 F.18)', () => {
  it('renderiza el empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<WorkerPortableHistory />);
    expect(screen.getByTestId('portable-history-page-empty')).toBeInTheDocument();
    expect(screen.getByText(/selecciona un proyecto/i)).toBeInTheDocument();
  });

  it('renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: null,
      loading: true,
      error: null,
      refetch: refetchMock,
    };
    render(<WorkerPortableHistory />);
    expect(screen.getByTestId('portable-history-loading')).toBeInTheDocument();
  });

  it('renderiza error con el mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockResp = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: refetchMock,
    };
    render(<WorkerPortableHistory />);
    expect(screen.getByTestId('portable-history-error')).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('renderiza el bundle con todas las secciones (sin consent → RUT redactado)', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const bundle = makeBundle();
    mockResp = {
      data: { bundle },
      loading: false,
      error: null,
      refetch: refetchMock,
    };
    render(<WorkerPortableHistory />);
    expect(screen.getByTestId('portable-history-page')).toBeInTheDocument();
    expect(screen.getByTestId('portable-history-privacy-banner')).toBeInTheDocument();
    expect(screen.getByTestId('portable-history-section-identity')).toBeInTheDocument();
    expect(screen.getByTestId('portable-history-section-trainings')).toBeInTheDocument();
    expect(screen.getByTestId('portable-history-section-epp')).toBeInTheDocument();
    expect(screen.getByTestId('portable-history-section-aptitudes')).toBeInTheDocument();
    expect(screen.getByTestId('portable-history-section-critical-roles')).toBeInTheDocument();
    expect(screen.getByTestId('portable-history-section-signatures')).toBeInTheDocument();
    // RUT redactado por default-consent=false.
    expect(screen.getByTestId('portable-history-identity-rut').textContent).toBe(
      '[REDACTED]',
    );
    expect(
      screen.getByTestId('portable-history-identity-redacted-note'),
    ).toBeInTheDocument();
    // Incidents section debe estar oculto cuando includesIncidents=false.
    expect(
      screen.queryByTestId('portable-history-section-incidents'),
    ).not.toBeInTheDocument();
  });

  it('bloquea los botones de export cuando allowsPortableExport=false', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const bundle = makeBundle();
    mockResp = {
      data: { bundle },
      loading: false,
      error: null,
      refetch: refetchMock,
    };
    render(<WorkerPortableHistory />);
    const jsonBtn = screen.getByTestId(
      'portable-history-export-json',
    ) as HTMLButtonElement;
    const pdfBtn = screen.getByTestId(
      'portable-history-export-pdf',
    ) as HTMLButtonElement;
    expect(jsonBtn.disabled).toBe(true);
    expect(pdfBtn.disabled).toBe(true);
  });

  it('habilita identidad e incluye sección de incidentes cuando consent=true', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const bundle = makeBundle({
      consent: {
        allowsPortableExport: true,
        includesIncidents: true,
        updatedAt: '2026-05-17T10:00:00.000Z',
        updatedByUid: 'w-1',
      },
      identity: {
        fullName: 'Juan Pérez',
        rut: '12345678-9',
        email: 'juan@ex.cl',
      },
      incidents: [
        { id: 'inc-1', occurredAt: '2025-12-01T08:00:00.000Z', severity: 'leve' },
      ],
    });
    mockResp = {
      data: { bundle },
      loading: false,
      error: null,
      refetch: refetchMock,
    };
    render(<WorkerPortableHistory />);
    expect(screen.getByTestId('portable-history-identity-rut').textContent).toBe(
      '12345678-9',
    );
    expect(screen.getByTestId('portable-history-identity-name').textContent).toBe(
      'Juan Pérez',
    );
    expect(screen.getByTestId('portable-history-section-incidents')).toBeInTheDocument();
    const jsonBtn = screen.getByTestId(
      'portable-history-export-json',
    ) as HTMLButtonElement;
    expect(jsonBtn.disabled).toBe(false);
  });

  it('guarda el consentimiento llamando updatePortableConsent con los flags correctos', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    const bundle = makeBundle();
    mockResp = {
      data: { bundle },
      loading: false,
      error: null,
      refetch: refetchMock,
    };
    render(<WorkerPortableHistory />);
    const exportToggle = screen.getByTestId(
      'portable-history-consent-export',
    ) as HTMLInputElement;
    const incidentsToggle = screen.getByTestId(
      'portable-history-consent-incidents',
    ) as HTMLInputElement;
    fireEvent.click(exportToggle);
    fireEvent.click(incidentsToggle);
    fireEvent.click(screen.getByTestId('portable-history-consent-save'));
    await waitFor(() => expect(updateConsentMock).toHaveBeenCalledTimes(1));
    expect(updateConsentMock).toHaveBeenCalledWith('p-1', 'w-1', {
      allowsPortableExport: true,
      includesIncidents: true,
    });
  });
});
