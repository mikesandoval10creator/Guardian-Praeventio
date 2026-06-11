// @vitest-environment jsdom
//
// Praeventio Guard — D2 slice 2: SafeDriving incident report goes through the
// audited server endpoint.
//
// Pins that `<SafeDriving />`:
//   1. POSTs the report to /api/sprint-k/:projectId/driving/incidents with
//      the Authorization + Idempotency-Key headers (NO client-side Firestore
//      write anymore — the old addDoc bypassed the audit-log invariant).
//   2. Sends only { type, description, location } — identity is server-stamped.
//   3. On success: shows the "Reportado" confirmation and clears the form.
//   4. On HTTP error: shows the es-CL error banner and KEEPS the description
//      (no silent drop).
//   5. On network failure (offline en ruta): shows the offline es-CL banner
//      and KEEPS the description.
//
// Hermetic: maps, contexts and auth are mocked. Pattern mirrors
// `OfflineInspection.test.tsx`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SafeDriving } from './SafeDriving';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _k),
  }),
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => (props: Record<string, unknown> & { children?: React.ReactNode }) => {
      const { children, ...rest } = props;
      const safe = Object.fromEntries(
        Object.entries(rest).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap'].includes(k)),
      );
      return <div {...(safe as Record<string, unknown>)}>{children}</div>;
    },
  }),
}));
vi.mock('@react-google-maps/api', () => ({
  useJsApiLoader: () => ({ isLoaded: false }),
  GoogleMap: () => null,
  Marker: () => null,
}));
vi.mock('../components/maps/mapConfig', () => ({ getMapLoaderConfig: () => ({}) }));
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'proj-1', name: 'Faena Norte' } }),
}));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeader: vi.fn(async () => 'Bearer test-token') }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  // jsdom has no geolocation — the page degrades to 'Ubicación no disponible'.
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: {
      getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 1, message: 'denied' } as GeolocationPositionError),
    },
  });
});

async function fillAndSubmit() {
  render(<SafeDriving />);
  fireEvent.click(screen.getByText('Reportar Incidente'));
  fireEvent.click(screen.getByText('Accidente'));
  fireEvent.change(screen.getByPlaceholderText('Describa brevemente la situación...'), {
    target: { value: 'Volcamiento parcial en curva km 12' },
  });
  fireEvent.click(screen.getByText('Enviar Reporte'));
}

describe('SafeDriving — incident report via audited endpoint', () => {
  it('POSTs to /api/sprint-k/:pid/driving/incidents with auth + idempotency headers', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, incident: { id: 'i1' }, nodeId: 'n1' }),
    });

    await fillAndSubmit();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sprint-k/proj-1/driving/incidents');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token');
    expect(headers['Idempotency-Key']).toMatch(/^drv-/);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      type: 'Accidente',
      description: 'Volcamiento parcial en curva km 12',
      location: 'Ubicación no disponible (Permiso denegado o error)',
    });
    // Identity is NEVER client-supplied.
    expect(body.reportedByUid).toBeUndefined();

    // Success state: button flips to "Reportado", form cleared.
    await waitFor(() => expect(screen.getByText('Reportado')).toBeTruthy());
  });

  it('shows the es-CL error banner and keeps the form on an HTTP error', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'forbidden' }),
    });

    await fillAndSubmit();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('No pudimos registrar el reporte');
    // No silent drop — the description survives for a retry.
    expect(
      (screen.getByPlaceholderText('Describa brevemente la situación...') as HTMLTextAreaElement).value,
    ).toBe('Volcamiento parcial en curva km 12');
    expect(screen.getByText('Enviar Reporte')).toBeTruthy();
  });

  it('shows the offline es-CL banner and keeps the form on a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await fillAndSubmit();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Sin conexión');
    expect(
      (screen.getByPlaceholderText('Describa brevemente la situación...') as HTMLTextAreaElement).value,
    ).toBe('Volcamiento parcial en curva km 12');
  });
});
