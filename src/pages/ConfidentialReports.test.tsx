// @vitest-environment jsdom
//
// Praeventio Guard — Sprint K §211-213 page wrapper tests.
//
// Smoke tests for `<ConfidentialReports />`:
//   1. Empty state when no project is selected.
//   2. Loading state from the hook.
//   3. Error state surfaces with message.
//   4. Submit anonymous report (DOES NOT pass reporterUid).
//   5. Submit identified report (DOES pass reporterUid).
//   6. Investigator inbox renders open reports.
//   7. Respond modal posts response.
//   8. Retaliation alerts panel renders without de-anonymizing.
//
// Hermetic: hooks, mutations and contexts mocked so the test has no
// fetch, no Firestore, no router state. Matches the pattern used by
// `LeadershipDecisions.test.tsx` and `CorrectiveActions.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfidentialReports } from './ConfidentialReports';
import type {
  ConfidentialReportApi,
  ConfidentialReportsListResponse,
  RetaliationAlertsResponse,
  RetaliationAlertApi,
} from '../hooks/useConfidentialReports';

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

type ReportsMock = {
  data: ConfidentialReportsListResponse | null;
  loading: boolean;
  error: Error | null;
  refetch?: () => void;
};
type RetaliationMock = {
  data: RetaliationAlertsResponse | null;
  loading: boolean;
  error: Error | null;
  refetch?: () => void;
};

let mockSelectedProject: { id: string; name: string } | null = null;
let mockIsOnline = true;
let mockUser: { uid: string } | null = null;
let mockReports: ReportsMock;
let mockRetaliation: RetaliationMock;

const submitConfidentialReport = vi.fn();
const respondToReport = vi.fn();
const closeReport = vi.fn();

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: mockUser }),
}));
vi.mock('../hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => mockIsOnline,
}));
vi.mock('../hooks/useConfidentialReports', () => ({
  useConfidentialReports: () => mockReports,
  useRetaliationAlerts: () => mockRetaliation,
  submitConfidentialReport: (...args: unknown[]) => submitConfidentialReport(...args),
  respondToReport: (...args: unknown[]) => respondToReport(...args),
  closeReport: (...args: unknown[]) => closeReport(...args),
}));

function emptyReports(role: 'investigator' | 'reporter' = 'reporter'): ReportsMock {
  return { data: { reports: [], role }, loading: false, error: null, refetch: vi.fn() };
}
function emptyRetaliation(): RetaliationMock {
  return { data: { alerts: [], windowDays: 90 }, loading: false, error: null, refetch: vi.fn() };
}

function report(over: Partial<ConfidentialReportApi> & { id: string }): ConfidentialReportApi {
  return {
    id: over.id,
    projectId: over.projectId ?? 'p-1',
    kind: over.kind ?? 'harassment',
    severity: over.severity ?? 'high',
    narrative:
      over.narrative ??
      'Reporte de prueba: situación grave que requiere investigación.',
    evidence: over.evidence,
    allowsIdentity: over.allowsIdentity ?? false,
    reporterUid: over.reporterUid,
    reporterAnonHash:
      over.reporterAnonHash ?? 'abcdef1234567890fedcba9876543210',
    status: over.status ?? 'open',
    submittedAt: over.submittedAt ?? '2026-05-15T10:00:00Z',
    firstResponseDueAt: over.firstResponseDueAt ?? '2026-05-22T10:00:00Z',
    resolveDueAt: over.resolveDueAt ?? '2026-06-14T10:00:00Z',
    respondedAt: over.respondedAt,
    closedAt: over.closedAt,
    resolution: over.resolution,
  };
}

function retaliationAlert(
  over: Partial<RetaliationAlertApi> & { reportId: string },
): RetaliationAlertApi {
  return {
    reportId: over.reportId,
    reporterAnonHash:
      over.reporterAnonHash ?? 'abcdef1234567890fedcba9876543210',
    reportSubmittedAt: over.reportSubmittedAt ?? '2026-05-01T10:00:00Z',
    actionAt: over.actionAt ?? '2026-05-10T10:00:00Z',
    actionKind: over.actionKind ?? 'termination',
    daysFromReport: over.daysFromReport ?? 9,
    severity: over.severity ?? 'critical',
  };
}

beforeEach(() => {
  mockSelectedProject = null;
  mockIsOnline = true;
  mockUser = null;
  mockReports = emptyReports();
  mockRetaliation = emptyRetaliation();
  submitConfidentialReport.mockReset();
  respondToReport.mockReset();
  closeReport.mockReset();
});

describe('<ConfidentialReports /> page wrapper (Sprint K §211-213)', () => {
  it('1) renderiza empty-state cuando no hay proyecto seleccionado', () => {
    mockSelectedProject = null;
    render(<ConfidentialReports />);
    expect(
      screen.getByTestId('confidential-reports-page-empty'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/selecciona un proyecto/i),
    ).toBeInTheDocument();
  });

  it('2) renderiza loading mientras el hook trae datos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockUser = { uid: 'u-worker' };
    mockReports = { data: null, loading: true, error: null, refetch: vi.fn() };
    render(<ConfidentialReports />);
    expect(
      screen.getByTestId('confidential-reports-loading'),
    ).toBeInTheDocument();
  });

  it('3) muestra error con mensaje del hook', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockUser = { uid: 'u-worker' };
    mockReports = {
      data: null,
      loading: false,
      error: new Error('Network down'),
      refetch: vi.fn(),
    };
    render(<ConfidentialReports />);
    expect(
      screen.getByTestId('confidential-reports-error'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Network down/i)).toBeInTheDocument();
  });

  it('4) submit ANÓNIMO: no pasa reporterUid (privacidad por diseño)', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockUser = { uid: 'u-worker' };
    mockReports = emptyReports('reporter');
    submitConfidentialReport.mockResolvedValueOnce({
      ok: true,
      report: report({ id: 'cr_new' }),
      sla: {
        firstResponseDueAt: '',
        resolveDueAt: '',
        legalReference: '',
      },
    });
    render(<ConfidentialReports />);
    fireEvent.click(screen.getByTestId('confidential-reports-new-button'));
    expect(
      screen.getByTestId('confidential-reports-new-modal'),
    ).toBeInTheDocument();
    // Default radio = anónimo. No tocamos identidad.
    fireEvent.change(
      screen.getByTestId('confidential-reports-new-modal-narrative'),
      { target: { value: 'Esto es una descripción suficiente.' } },
    );
    fireEvent.click(
      screen.getByTestId('confidential-reports-new-modal-submit'),
    );
    await waitFor(() => {
      expect(submitConfidentialReport).toHaveBeenCalledTimes(1);
    });
    const [, payload] = submitConfidentialReport.mock.calls[0];
    expect(payload.allowsIdentity).toBe(false);
    // CRITICAL: reporterUid debe ser undefined cuando es anónimo.
    expect(payload.reporterUid).toBeUndefined();
  });

  it('5) submit IDENTIFICADO: pasa reporterUid del current user', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockUser = { uid: 'u-worker-42' };
    mockReports = emptyReports('reporter');
    submitConfidentialReport.mockResolvedValueOnce({
      ok: true,
      report: report({ id: 'cr_new', allowsIdentity: true, reporterUid: 'u-worker-42' }),
      sla: {
        firstResponseDueAt: '',
        resolveDueAt: '',
        legalReference: '',
      },
    });
    render(<ConfidentialReports />);
    fireEvent.click(screen.getByTestId('confidential-reports-new-button'));
    // Cambiar a identificado.
    fireEvent.click(
      screen.getByTestId('confidential-reports-identified-radio'),
    );
    fireEvent.change(
      screen.getByTestId('confidential-reports-new-modal-narrative'),
      { target: { value: 'Reporte identificado con detalle suficiente.' } },
    );
    fireEvent.click(
      screen.getByTestId('confidential-reports-new-modal-submit'),
    );
    await waitFor(() => {
      expect(submitConfidentialReport).toHaveBeenCalledTimes(1);
    });
    const [, payload] = submitConfidentialReport.mock.calls[0];
    expect(payload.allowsIdentity).toBe(true);
    expect(payload.reporterUid).toBe('u-worker-42');
  });

  it('6) inbox del investigador lista reportes abiertos', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockUser = { uid: 'u-inv' };
    mockReports = {
      data: {
        role: 'investigator',
        reports: [
          report({ id: 'cr_open_1', status: 'open' }),
          report({ id: 'cr_inv_1', status: 'investigating' }),
          report({ id: 'cr_resolved_1', status: 'resolved' }),
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<ConfidentialReports />);
    // Cambiar a tab inbox
    fireEvent.click(screen.getByTestId('confidential-reports-tab-inbox'));
    expect(
      screen.getByTestId('confidential-reports-inbox-section'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('confidential-report-cr_open_1'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('confidential-report-cr_inv_1'),
    ).toBeInTheDocument();
    // resolved no debe aparecer en inbox (solo open/investigating)
    expect(
      screen.queryByTestId('confidential-report-cr_resolved_1'),
    ).not.toBeInTheDocument();
  });

  it('7) responder a reporte invoca la mutación', async () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockUser = { uid: 'u-inv' };
    mockReports = {
      data: {
        role: 'investigator',
        reports: [report({ id: 'cr_resp_1', status: 'open' })],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    respondToReport.mockResolvedValueOnce(undefined);
    render(<ConfidentialReports />);
    fireEvent.click(screen.getByTestId('confidential-reports-tab-inbox'));
    fireEvent.click(
      screen.getByTestId('confidential-report-respond-cr_resp_1'),
    );
    fireEvent.change(
      screen.getByTestId('confidential-reports-respond-message'),
      {
        target: {
          value: 'Investigando, próxima reunión 2026-05-20.',
        },
      },
    );
    fireEvent.click(
      screen.getByTestId('confidential-reports-respond-submit'),
    );
    await waitFor(() => {
      expect(respondToReport).toHaveBeenCalledTimes(1);
    });
    expect(respondToReport).toHaveBeenCalledWith(
      'p-1',
      'cr_resp_1',
      'Investigando, próxima reunión 2026-05-20.',
    );
  });

  it('8) panel de represalias renderiza sin de-anonimizar (solo hash truncado)', () => {
    mockSelectedProject = { id: 'p-1', name: 'Faena Norte' };
    mockUser = { uid: 'u-inv' };
    mockReports = {
      data: { role: 'investigator', reports: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    mockRetaliation = {
      data: {
        windowDays: 90,
        alerts: [
          retaliationAlert({
            reportId: 'cr_xyz',
            reporterAnonHash: 'deadbeefcafe1234567890abcdef1234',
            actionKind: 'termination',
            daysFromReport: 5,
            severity: 'critical',
          }),
        ],
      },
      loading: false,
      error: null,
      refetch: vi.fn(),
    };
    render(<ConfidentialReports />);
    fireEvent.click(screen.getByTestId('confidential-reports-tab-inbox'));
    expect(
      screen.getByTestId('confidential-reports-retaliation-panel'),
    ).toBeInTheDocument();
    const item = screen.getByTestId(
      'confidential-reports-retaliation-cr_xyz',
    );
    expect(item).toBeInTheDocument();
    // Asegura que solo aparece el prefijo de 8 chars del hash, NUNCA un uid real.
    expect(item.textContent).toContain('deadbeef');
    expect(item.textContent).not.toContain(
      'deadbeefcafe1234567890abcdef1234',
    );
    expect(item.textContent).not.toMatch(/u-worker|uid:/);
  });
});
