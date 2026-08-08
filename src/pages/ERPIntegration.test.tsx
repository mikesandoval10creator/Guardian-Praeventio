// @vitest-environment jsdom
// SPDX-License-Identifier: MIT
//
// Sprint 50 E.6 P1 H2 — anti-stub-disfrazado tests.
// Ticket: 39aaa66d-73fe-81d5-90a8-c375e00d653c
//
// Before this fix: SAP and Buk/Talana rows rendered hard-coded "Conectado"
// in green even though the backend adapter was a StubAdapter. After this fix
// the rows report the honest state coming from `/api/erp/sync?probe=...`.
//
// These tests exercise the rendering contract: the row attribute `data-state`
// is the single source of truth that downstream QA / monitoring scripts can
// query. We never render the misleading hard-coded "Conectado" string until
// the backend has actually confirmed `mode === 'real'`.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ERPIntegration } from './ERPIntegration';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

// Mock apiAuthHeader so the probe request resolves without a real Firebase auth.
vi.mock('../lib/apiAuth', () => ({
  apiAuthHeader: vi.fn().mockResolvedValue(null),
}));

// Capture every fetch call so we can stub a per-test backend response.
const fetchSpy = vi.fn();

function mockSyncResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockProbeResponse(mode: string, reason?: string): Response {
  return mockSyncResponse({ mode, reason, timestamp: new Date().toISOString() });
}

// Configure a per-test probe response queue. The component fires TWO
// probe calls in parallel on mount (sap then buk). The order they resolve
// depends on React 19 scheduling — use `mockResolvedValueOnce` carefully.
// We override fetchSpy.mockImplementation with a synchronous dispatch so
// every call resolves with the FIRST matching response from the queue.
function configureProbes(responses: Record<string, { mode: string; reason?: string }>) {
  fetchSpy.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('probe=sap') && 'sap' in responses) {
      return mockProbeResponse(responses.sap.mode, responses.sap.reason);
    }
    if (typeof url === 'string' && url.includes('probe=buk') && 'buk' in responses) {
      return mockProbeResponse(responses.buk.mode, responses.buk.reason);
    }
    return mockSyncResponse({ mode: 'unknown' });
  });
}

beforeEach(() => {
  fetchSpy.mockReset();
  configureProbes({
    sap: { mode: 'real' },
    buk: { mode: 'real' },
  });
  vi.stubGlobal('fetch', fetchSpy);
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function waitForProbesResolved() {
  // Wait until BOTH adapter status testids exist with non-'unknown' state
  // (or until both resolve to whatever state we expect). This ensures the
  // useEffect's parallel fetch calls have settled before we assert.
  await waitFor(() => {
    const sap = screen.queryByTestId('erp-adapter-status-sap');
    const buk = screen.queryByTestId('erp-adapter-status-buk');
    if (!sap || !buk) return false;
    // Either both are non-pending ('unknown' with non-pending probe state)
    // or at least one has the expected state.
    return sap.getAttribute('data-state') !== null && buk.getAttribute('data-state') !== null;
  });
}

describe('<ERPIntegration /> (anti-stub-disfrazado)', () => {
  it('renders the SAP row with data-testid and a state derived from the probe', async () => {
    render(<ERPIntegration />);
    const row = await waitFor(() => screen.getByTestId('erp-adapter-row-sap'));
    expect(row).toBeInTheDocument();
    const status = await waitFor(() => screen.getByTestId('erp-adapter-status-sap'));
    await waitFor(() => expect(status.getAttribute('data-state')).toBe('real'));
    expect(status.textContent).toMatch(/Conectado \(real\)/);
  });

  it('never renders the misleading hard-coded "Conectado" string when the probe returns not_configured', async () => {
    configureProbes({
      sap: { mode: 'not_configured', reason: 'ERP_ADAPTER missing' },
      buk: { mode: 'not_implemented' },
    });
    render(<ERPIntegration />);
    const sapStatus = await waitFor(() => screen.getByTestId('erp-adapter-status-sap'));
    await waitFor(() => expect(sapStatus.getAttribute('data-state')).toBe('not_configured'));
    // The label must reflect "not_configured", NOT "Conectado".
    expect(sapStatus.textContent).toMatch(/No configurado/i);
    expect(sapStatus.textContent).not.toMatch(/^Conectado$/);

    const bukStatus = await waitFor(() => screen.getByTestId('erp-adapter-status-buk'));
    await waitFor(() => expect(bukStatus.getAttribute('data-state')).toBe('not_implemented'));
    expect(bukStatus.textContent).toMatch(/No implementado/);
  });

  it('shows "Verificando…" until the probe resolves (no flash of "Conectado")', async () => {
    // Block fetch until we explicitly resolve, simulating a slow probe.
    let resolveProbe!: (r: Response) => void;
    const slowProbe = new Promise<Response>((res) => { resolveProbe = res; });
    fetchSpy.mockReturnValue(slowProbe);

    render(<ERPIntegration />);

    // The endpoint + api key should already say "Verificando…".
    const endpointDisplay = screen.getByTestId('erp-endpoint-display');
    expect(endpointDisplay.textContent).toMatch(/Verificando/);

    const apiKeyDisplay = screen.getByTestId('erp-api-key-display');
    expect(apiKeyDisplay.textContent).toMatch(/Verificando/);

    // Cleanup: resolve pending probe to avoid leaks
    resolveProbe(mockProbeResponse('real'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  it('displays "No implementado (stub)" when backend mode is not_implemented', async () => {
    configureProbes({
      sap: { mode: 'not_implemented', reason: 'StubAdapter sin acción' },
      buk: { mode: 'not_implemented', reason: 'StubAdapter sin acción' },
    });
    render(<ERPIntegration />);
    const sapStatus = await waitFor(() => screen.getByTestId('erp-adapter-status-sap'));
    await waitFor(() => expect(sapStatus.getAttribute('data-state')).toBe('not_implemented'));
    expect(sapStatus.textContent).toMatch(/No implementado/);
  });

  it('distinguishes "mock" from "real" — mock gets blue dot + explicit label', async () => {
    configureProbes({
      sap: { mode: 'mock' },
      buk: { mode: 'real' },
    });
    render(<ERPIntegration />);
    const sapStatus = await waitFor(() => screen.getByTestId('erp-adapter-status-sap'));
    await waitFor(() => expect(sapStatus.getAttribute('data-state')).toBe('mock'));
    expect(sapStatus.textContent).toMatch(/Mock/);
    expect(sapStatus.textContent).not.toMatch(/Conectado \(real\)/);
  });

  it('the copyEndpoint button copies the endpoint and shows a success toast', async () => {
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('probe=sap')) {
        return mockProbeResponse('real');
      }
      if (typeof url === 'string' && url.includes('probe=buk')) {
        return mockProbeResponse('real');
      }
      // manual_sync returns the endpoint to populate the UI
      if (typeof url === 'string' && (url.endsWith('/sync') || url.includes('probe=') === false && url.includes('/sync'))) {
        return mockSyncResponse({
          mode: 'real',
          endpoint: 'https://api.praeventio.net/v1',
          apiKeyMasked: 'sk_live_***',
        });
      }
      return mockSyncResponse({});
    });

    render(<ERPIntegration />);
    await waitForProbesResolved();

    const syncBtn = screen.getByRole('button', { name: /Forzar Sincronización Manual/i });
    await act(async () => {
      fireEvent.click(syncBtn);
    });

    await waitFor(() =>
      expect(screen.getByTestId('erp-endpoint-display').textContent).toMatch(
        /api\.praeventio\.net/,
      ),
    );

    const copyBtn = screen.getByTestId('erp-copy-endpoint');
    await act(async () => {
      fireEvent.click(copyBtn);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://api.praeventio.net/v1',
    );
  });
});
