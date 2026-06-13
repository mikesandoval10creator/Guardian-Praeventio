// @vitest-environment jsdom
//
// Praeventio Guard — driver voice dictation goes through the audited server
// endpoint (no more silent client-side Firestore write).
//
// Pins that `<SafeDrivingMode />`:
//   1. On dictation end, POSTs the dictated text to
//      /api/sprint-k/:projectId/driving/incidents with the Authorization +
//      Idempotency-Key headers and { type, description } — identity is
//      server-stamped, NOT client-supplied. (Old code addDoc'd to
//      `projects/{pid}/driving_reports`, a default-denied path, and swallowed
//      the rejection in an empty catch → every report vanished.)
//   2. On success: shows the "Reporte guardado" confirmation.
//   3. On HTTP error: shows a VISIBLE es-CL error banner with a Retry button
//      (no silent drop) and re-POSTs the same text + idempotency key on retry.
//   4. On network failure: shows the offline es-CL banner.
//
// Hermetic: contexts, auth and the Web Speech API are mocked. Pattern mirrors
// SafeDriving.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { SafeDrivingMode } from './SafeDrivingMode';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _k),
  }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: 'proj-1', name: 'Faena Norte' } }),
}));
vi.mock('../contexts/EmergencyContext', () => ({
  useEmergency: () => ({ triggerEmergency: vi.fn(async () => undefined) }),
}));
vi.mock('../components/WeatherBulletin', () => ({ WeatherBulletin: () => null }));
vi.mock('../lib/apiAuth', () => ({ apiAuthHeader: vi.fn(async () => 'Bearer test-token') }));
vi.mock('../utils/randomId', () => ({ randomId: () => 'fixed-id' }));
vi.mock('../utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const fetchMock = vi.fn();

// Minimal Web Speech API double — captures the handlers the component wires up
// so the test can drive `onresult` (transcript arrives) and `onend` (which
// triggers the real saveReport flow).
class FakeRecognition {
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}
let lastRecognition: FakeRecognition | null = null;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  lastRecognition = null;
  // A real constructor (not an arrow) so `new SpeechRecognition()` works. It
  // returns the instance explicitly (so `new` uses it) instead of aliasing
  // `this` — keeps the capture without tripping no-this-alias.
  function SpeechRecognitionCtor() {
    const rec = new FakeRecognition();
    lastRecognition = rec;
    return rec;
  }
  (window as any).SpeechRecognition = SpeechRecognitionCtor;
  (window as any).webkitSpeechRecognition = SpeechRecognitionCtor;
});

// Renders, starts dictation, feeds a transcript, then ends it — which fires the
// real saveReport().
async function dictateAndEnd(transcript = 'Neumático delantero perdiendo presión en km 30') {
  render(<SafeDrivingMode />);
  fireEvent.click(screen.getByText('Dictar Reporte'));
  expect(lastRecognition).not.toBeNull();
  act(() => {
    lastRecognition!.onresult?.({ results: [[{ transcript }]] });
  });
  await act(async () => {
    lastRecognition!.onend?.();
  });
}

describe('SafeDrivingMode — voice dictation via audited endpoint', () => {
  it('POSTs the dictated text to /api/sprint-k/:pid/driving/incidents with auth + idempotency headers', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, incident: { id: 'i1' }, nodeId: 'n1' }),
    });

    await dictateAndEnd();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sprint-k/proj-1/driving/incidents');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token');
    expect(headers['Idempotency-Key']).toMatch(/^drv-/);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      type: 'Falla Mecánica',
      description: 'Neumático delantero perdiendo presión en km 30',
    });
    // Identity is NEVER client-supplied.
    expect(body.userId).toBeUndefined();
    expect(body.reportedByUid).toBeUndefined();

    await waitFor(() => expect(screen.getByText('Reporte guardado')).toBeTruthy());
  });

  it('shows a visible es-CL error banner with a Retry button on an HTTP error (no silent drop)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'forbidden' }),
    });

    await dictateAndEnd();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('No pudimos guardar el reporte');
    // The dictated text survives for the retry.
    expect(screen.getByText('Neumático delantero perdiendo presión en km 30')).toBeTruthy();

    // Retry re-POSTs the same text with the SAME idempotency key (no dup).
    const firstKey = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, incident: { id: 'i2' } }),
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Reintentar'));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const secondKey = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(secondKey['Idempotency-Key']).toBe(firstKey['Idempotency-Key']);
    const retryBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string) as Record<string, unknown>;
    expect(retryBody.description).toBe('Neumático delantero perdiendo presión en km 30');
    await waitFor(() => expect(screen.getByText('Reporte guardado')).toBeTruthy());
  });

  it('shows the offline es-CL banner on a network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await dictateAndEnd();

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('Sin conexión');
  });
});
