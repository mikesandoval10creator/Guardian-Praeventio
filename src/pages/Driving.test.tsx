// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
//
// Sprint 50 E.8 P1 H4 — Vida-XX persistence tests.
// Ticket: 39aaa66d-73fe-8138-b4b8-c2580c86a3b5
//
// Before this fix: "Reportar near-miss", "Reportar incidente", "Llegué a destino"
// buttons in Driving.tsx only emitted a toast — the user believed they had
// reported something and nothing happened. After this fix near-miss + incidente
// POST to /api/sprint-k/:projectId/incident-flow/report (the same endpoint the
// /safe-driving / IncidentReportForm flow uses), and "Llegué a destino" still
// emits a local ack with an honest label.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { Driving } from './Driving';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | string[]) =>
      typeof fallback === 'string' ? fallback : Array.isArray(fallback) ? fallback.join(' ') : _k,
  }),
}));

vi.mock('../contexts/AppModeContext', () => ({
  useAppMode: () => ({ mode: 'driving' }),
}));

const mockSelectedProject = {
  id: 'proj-test-1',
  phone: '+56912345678',
  coordinates: { lat: -33.45, lng: -70.66 },
};
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: mockSelectedProject }),
}));

const speedStub = {
  speedMs: 25,
  speedKmh: 90,
  gpsAccuracyM: 5,
  timestampMs: Date.now(),
  isStale: false,
};
vi.mock('../services/driving/speedTrigger', () => ({
  useSpeedMonitor: () => speedStub,
}));

vi.mock('../hooks/useDriving', () => ({
  useBrakeTelemetry: () => undefined,
}));

vi.mock('../hooks/useToast', () => {
  const show = vi.fn();
  return {
    useToast: () => ({ toasts: [], show, dismiss: vi.fn() }),
    show,
  };
});

vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({
    user: { uid: 'user-test-uid' },
  }),
}));

vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaders: vi.fn().mockResolvedValue({ Authorization: 'Bearer test-token' }),
  apiAuthHeader: vi.fn().mockResolvedValue('Bearer test-token'),
}));

vi.mock('@react-google-maps/api', () => ({
  GoogleMap: ({ children }: { children?: React.ReactNode }) => <div data-testid="google-map">{children}</div>,
  useJsApiLoader: () => ({ isLoaded: true }),
  Marker: () => <div data-testid="google-marker" />,
}));

vi.mock('../components/maps/mapConfig', () => ({
  getMapLoaderConfig: () => ({ apiKey: 'test-key' }),
}));

vi.mock('../services/external/index.js', () => ({
  eonetAdapter: {
    fetchEvents: vi.fn().mockResolvedValue([]),
  },
  bboxFromCenter: vi.fn().mockReturnValue({ minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 }),
}));

vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const fetchSpy = vi.fn();

function mockReportResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  fetchSpy.mockReset();
  // Default: every /api/sprint-k/* call succeeds
  fetchSpy.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('eonet')) {
      return mockReportResponse([]);
    }
    return mockReportResponse({ ok: true });
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('<Driving /> (Vida-XX report persistence)', () => {
  it('renders the three report buttons with testids', () => {
    render(<Driving />);
    expect(screen.getByTestId('driving-report-near-miss')).toBeInTheDocument();
    expect(screen.getByTestId('driving-report-incident')).toBeInTheDocument();
    expect(screen.getByTestId('driving-report-arrived')).toBeInTheDocument();
  });

  it('"Reportar near-miss" POSTs to incident-flow/report with severity=low', async () => {
    render(<Driving />);
    const btn = screen.getByTestId('driving-report-near-miss');
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const call = fetchSpy.mock.calls.find(
      ([u]) => typeof u === 'string' && u.includes('/incident-flow/report'),
    );
    expect(call).toBeDefined();
    const [url, init] = call!;
    expect(url).toBe('/api/sprint-k/proj-test-1/incident-flow/report');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    const body = JSON.parse(init.body);
    expect(body.severity).toBe('low');
    expect(body.description).toMatch(/near-miss/i);
    expect(body.location).toBe('-33.45000,-70.66000');
    expect(body.occurredAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('"Reportar incidente" POSTs with severity=medium', async () => {
    render(<Driving />);
    const btn = screen.getByTestId('driving-report-incident');
    await act(async () => {
      fireEvent.click(btn);
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const call = fetchSpy.mock.calls.find(
      ([u]) => typeof u === 'string' && u.includes('/incident-flow/report'),
    );
    expect(call).toBeDefined();
    const body = JSON.parse(call![1].body);
    expect(body.severity).toBe('medium');
    expect(body.description).toMatch(/incidente/i);
  });

  it('"Llegué a destino" does NOT POST (no canonical arrival endpoint exists)', async () => {
    render(<Driving />);
    const btn = screen.getByTestId('driving-report-arrived');
    await act(async () => {
      fireEvent.click(btn);
    });
    // Wait a tick for any (incorrectly-fired) fetch
    await new Promise((r) => setTimeout(r, 50));
    const reportCalls = fetchSpy.mock.calls.filter(
      ([u]) => typeof u === 'string' && u.includes('/incident-flow/report'),
    );
    expect(reportCalls).toHaveLength(0);
  });

  it('disables both reporting buttons while a fetch is in flight', async () => {
    // Make the fetch hang so we can assert the disabled state.
    let resolveReport!: (r: Response) => void;
    const slowReport = new Promise<Response>((res) => { resolveReport = res; });
    fetchSpy.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/incident-flow/report')) {
        return slowReport;
      }
      if (typeof url === 'string' && url.includes('eonet')) {
        return mockReportResponse([]);
      }
      return mockReportResponse({});
    });

    render(<Driving />);
    const nearMissBtn = screen.getByTestId('driving-report-near-miss');
    const incidentBtn = screen.getByTestId('driving-report-incident');

    await act(async () => {
      fireEvent.click(nearMissBtn);
    });

    await waitFor(() => {
      expect(nearMissBtn).toBeDisabled();
      expect(incidentBtn).toBeDisabled();
    });

    // Cleanup: resolve the pending report
    resolveReport(mockReportResponse({ ok: true }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  });
});
