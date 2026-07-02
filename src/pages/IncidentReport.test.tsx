// @vitest-environment jsdom
//
// B.1 (VIDA) — IncidentReport never loses a typed report.
//
// The page used to fire a bare fetch: offline (mina sin señal) the report
// died in silence. This suite pins the new contract:
//   • happy path unchanged (POST + success banner, no queueing),
//   • network failure → durable outbox (same Idempotency-Key/payload id) +
//     honest "saved on this device" banner + form cleared,
//   • transient 5xx → queued the same way,
//   • deterministic 4xx → visible error, NOT queued (user can fix + resubmit).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, fallback?: string) => (typeof fallback === 'string' ? fallback : k),
  }),
}));
vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'p1', name: 'Faena Norte' } }),
}));
vi.mock('../services/firebase', () => ({
  auth: { currentUser: { uid: 'u1', email: 'u1@test.com' } },
}));
vi.mock('../lib/apiAuth', () => ({
  apiAuthHeader: vi.fn(async () => 'Bearer test-token'),
}));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const enqueueMock = vi.fn<
  (payload: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<boolean>
>(async () => true);
const registerMock = vi.fn();
vi.mock('../services/incidents/incidentOutbox', () => ({
  enqueueIncidentReport: (
    payload: Record<string, unknown>,
    opts?: Record<string, unknown>,
  ) => enqueueMock(payload, opts),
  registerIncidentFlushOnReconnect: () => registerMock(),
}));

import { IncidentReport } from './IncidentReport';

const fetchMock = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  enqueueMock.mockClear();
  enqueueMock.mockResolvedValue(true);
  registerMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function fillAndSubmit(description = 'Casi golpe por carga suspendida') {
  const textarea = document.getElementById('incident-description') as HTMLTextAreaElement;
  fireEvent.change(textarea, { target: { value: description } });
  fireEvent.click(screen.getByRole('button', { name: /incident_report.submit/i }));
}

describe('<IncidentReport /> — B.1 offline outbox', () => {
  it('arms the outbox drain on mount', () => {
    render(<IncidentReport />);
    expect(registerMock).toHaveBeenCalled();
  });

  it('happy path: POST with Idempotency-Key == payload.id, success banner, nothing queued', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true, incidentId: 'i-1', path: 'x', xpAwarded: 10, indexed: true,
      }),
    } as unknown as Response);

    render(<IncidentReport />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByTestId('incident-success-banner')).toBeInTheDocument());
    expect(enqueueMock).not.toHaveBeenCalled();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(String(init.body)) as { id: string; projectId: string };
    expect(body.projectId).toBe('p1');
    expect(body.id).toBe(headers['Idempotency-Key']); // deterministic replay id
    expect(body.id).toMatch(/^inc-/);
  });

  it('network failure: queues with the SAME key, shows the honest banner, clears the form', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));

    render(<IncidentReport />);
    fillAndSubmit('Reporte escrito sin señal en interior mina');

    await waitFor(() => expect(screen.getByTestId('incident-queued-banner')).toBeInTheDocument());
    expect(screen.queryByTestId('incident-error-banner')).not.toBeInTheDocument();

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const [payload, opts] = enqueueMock.mock.calls[0] as [
      { id: string; description: string; projectId: string },
      { clientEventId: string },
    ];
    expect(payload.projectId).toBe('p1');
    expect(payload.description).toBe('Reporte escrito sin señal en interior mina');
    expect(opts.clientEventId).toBe(payload.id); // outbox replay reuses the key

    const textarea = document.getElementById('incident-description') as HTMLTextAreaElement;
    expect(textarea.value).toBe(''); // the data is safe locally — form resets
  });

  it('transient 5xx: queues for retry instead of losing the report', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 503, text: async () => '',
    } as unknown as Response);

    render(<IncidentReport />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByTestId('incident-queued-banner')).toBeInTheDocument());
    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it('deterministic 4xx: visible error, NOT queued (user can fix and resubmit)', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 400, text: async () => JSON.stringify({ error: 'invalid_projectId' }),
    } as unknown as Response);

    render(<IncidentReport />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByTestId('incident-error-banner')).toBeInTheDocument());
    expect(screen.getByText('invalid_projectId')).toBeInTheDocument();
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('incident-queued-banner')).not.toBeInTheDocument();
  });

  it('queue saturated: surfaces the failure honestly (never pretends it stored)', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    enqueueMock.mockResolvedValue(false);

    render(<IncidentReport />);
    fillAndSubmit();

    await waitFor(() => expect(screen.getByTestId('incident-error-banner')).toBeInTheDocument());
    expect(screen.queryByTestId('incident-queued-banner')).not.toBeInTheDocument();
  });
});
