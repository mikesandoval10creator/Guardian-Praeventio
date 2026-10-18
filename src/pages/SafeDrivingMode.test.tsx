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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { SafeDrivingMode } from './SafeDrivingMode';
import { setImmediate as defer } from 'node:timers';
import { apiAuthHeader } from '../lib/apiAuth';

const H = vi.hoisted(() => ({
  uid: 'user-1' as string | null, projectId: 'proj-1', native: false, gate: true,
  stored: new Map<string, unknown>(), storageFails: false, e2eUid: null as string | null,
}));
vi.mock('../lib/e2eAuth', () => ({
  isE2EMode: () => H.e2eUid !== null,
  getE2EUser: () => H.e2eUid ? { uid: H.e2eUid } : null,
}));
vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => ({ user: H.uid ? { uid: H.uid } : null, isAuthReady: true }),
}));
vi.mock('../services/firebase', () => ({
  auth: { get currentUser() { return H.uid ? { uid: H.uid } : null; } },
  db: {}, doc: vi.fn(), setDoc: vi.fn(), updateDoc: vi.fn(), serverTimestamp: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => H.native } }));
vi.mock('../services/location/locationPermissionRequest', () => ({
  canRequestLocationPermission: () => H.gate,
  LOCATION_PERMISSION_GATE_SETTLED_EVENT: 'guardian:location-permission-gate-settled',
}));
vi.mock('../services/security/encryptedKvStore', () => ({
  listEncryptedKeys: async () => [...H.stored.keys()],
  getEncrypted: async (key: string) => H.stored.get(key) ?? null,
  setEncrypted: async (key: string, value: unknown) => {
    if (H.storageFails) throw new Error('storage failed');
    H.stored.set(key, structuredClone(value));
  },
  deleteEncrypted: async (key: string) => { H.stored.delete(key); },
}));

vi.mock('@react-google-maps/api', () => ({ useJsApiLoader: () => ({ isLoaded: false }), GoogleMap: () => null, Marker: () => null }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _k),
  }),
}));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => ({ selectedProject: { id: H.projectId, name: 'Faena Norte' } }),
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
const recoveryMock = vi.fn();
const geolocationMock = vi.fn();
const fix = {
  coords: { latitude: -33.4, longitude: -70.6, speed: 10, accuracy: 5 },
  timestamp: 1_717_000_000_000,
} as GeolocationPosition;
const nullRecovery = () => ({ ok: true, json: async () => ({ success: true, session: null }) });
const sessionRecovery = (sessionId = 'cs_recovered') => ({ ok: true, json: async () => ({
  success: true, session: { sessionId, projectId: H.projectId, type: 'site-to-home' },
}) });
async function readyToStart() {
  await waitFor(() => expect((screen.getByRole('button', { name: 'Iniciar trayecto' }) as HTMLButtonElement).disabled).toBe(false));
}


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
  vi.mocked(apiAuthHeader).mockReset().mockResolvedValue('Bearer test-token');
  H.uid = 'user-1'; H.projectId = 'proj-1'; H.native = false; H.gate = true;
  H.storageFails = false; H.stored.clear(); H.e2eUid = null;
  fetchMock.mockReset(); recoveryMock.mockReset(); geolocationMock.mockReset();
  recoveryMock.mockImplementation(nullRecovery);
  geolocationMock.mockImplementation((_success, error) => error({ code: 1 }));
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: geolocationMock } });
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) =>
    url.startsWith('/api/commute/active') ? recoveryMock(url, init) : fetchMock(url, init));
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

afterEach(async () => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  await new Promise<void>((resolve) => defer(resolve));
  await new Promise<void>((resolve) => defer(resolve));
});

// Renders, starts dictation, feeds a transcript, then ends it — which fires the
// real saveReport().
async function dictateAndEnd(transcript = 'Neumático delantero perdiendo presión en km 30') {
  render(<SafeDrivingMode />);
  // El control de voz es un botón flotante icon-only — su nombre accesible es el
  // aria-label, no texto visible (refactor del antiguo botón w-32 con label).
  fireEvent.click(screen.getByRole('button', { name: 'Dictar reporte por voz' }));
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

describe('SafeDrivingMode — legal commute (trayecto, Ley 16.744 art.5)', () => {
  it('start POSTs /api/commute/start with the projectId + commute type and toggles to "Terminar"', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, sessionId: 'cs_42' }) });
    render(<SafeDrivingMode />);

    await readyToStart();
    fireEvent.click(screen.getByText('Iniciar Trayecto'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/commute/start');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ projectId: 'proj-1', type: 'home-to-site' });
    // Identity/tenant are NEVER client-supplied (server resolves from token).
    expect(body.tenantId).toBeUndefined();
    expect(body.userId).toBeUndefined();
    // Active session started → the button flips to the end action.
    await waitFor(() => expect(screen.getByText('Terminar Trayecto')).toBeTruthy());
  });

  it('end POSTs /api/commute/end with the sessionId and toggles back to "Iniciar"', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, sessionId: 'cs_42' }) });
    render(<SafeDrivingMode />);
    await readyToStart();
    fireEvent.click(screen.getByText('Iniciar Trayecto'));
    await waitFor(() => expect(screen.getByText('Terminar Trayecto')).toBeTruthy());

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    fireEvent.click(screen.getByText('Terminar Trayecto'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/api/commute/end');
    expect(JSON.parse(init.body as string)).toEqual({ sessionId: 'cs_42' });
    await waitFor(() => expect(screen.getByText('Iniciar Trayecto')).toBeTruthy());
  });

  it('surfaces an error (never silent) when commute start fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'commute start failed' }) });
    render(<SafeDrivingMode />);

    await readyToStart();
    fireEvent.click(screen.getByText('Iniciar Trayecto'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('trayecto');
    // Stays on the start action (no false "active" state).
    expect(screen.getByText('Iniciar Trayecto')).toBeTruthy();
  });
});


describe('SafeDrivingMode — recovered HTTP sampling lifecycle', () => {
  it('discards an in-flight GPS acquisition after the driver requests end', async () => {
    recoveryMock.mockImplementation(() => sessionRecovery());
    let deliver!: PositionCallback;
    geolocationMock.mockImplementationOnce((success) => { deliver = success; });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    render(<SafeDrivingMode />);
    await waitFor(() => expect(geolocationMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Terminar Trayecto'));
    await act(async () => { deliver(fix); });
    await readyToStart();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/commute/end']);
    expect(H.stored.size).toBe(0);
  });

  it('keeps capture paused if saving the close intent fails, then retries the close without new GPS', async () => {
    recoveryMock.mockImplementation(() => sessionRecovery());
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    render(<SafeDrivingMode />);
    await waitFor(() => expect(geolocationMock).toHaveBeenCalledTimes(1));
    H.storageFails = true;
    fireEvent.click(screen.getByText('Terminar Trayecto'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('dispositivo'));
    expect(fetchMock).not.toHaveBeenCalled();
    H.storageFails = false;
    fireEvent.click(screen.getByText('Reintentar'));
    await readyToStart();
    expect(geolocationMock).toHaveBeenCalledTimes(1);
  });

  it('does not request credentials when the E2E credential identity differs from the visible worker', async () => {
    H.e2eUid = 'another-fixture-worker';
    render(<SafeDrivingMode />);
    await act(async () => { await Promise.resolve(); });
    expect(apiAuthHeader).not.toHaveBeenCalled();
    expect(recoveryMock).not.toHaveBeenCalled();
  });

  it('keeps capture paused across remount after the driver requests end while offline', async () => {
    recoveryMock.mockImplementation(() => sessionRecovery());
    geolocationMock.mockImplementation((success) => success(fix));
    fetchMock.mockRejectedValue(new Error('offline'));
    const view = render(<SafeDrivingMode />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    fireEvent.click(screen.getByText('Terminar Trayecto'));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/commute/sample').length).toBeGreaterThan(1));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Terminar trayecto' }) as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(geolocationMock).toHaveBeenCalledTimes(1);
    view.unmount();
    render(<SafeDrivingMode />);
    await waitFor(() => expect(screen.getByText('La captura está pausada. El cierre del trayecto sigue pendiente de sincronización.')).toBeTruthy());
    expect(geolocationMock).toHaveBeenCalledTimes(1);
  });

  it.each(['hidden', 'permission'] as const)('discards a late GPS fix when %s changes during acquisition', async (change) => {
    H.native = true;
    recoveryMock.mockImplementationOnce(() => sessionRecovery());
    let deliver!: PositionCallback;
    geolocationMock.mockImplementationOnce((success) => { deliver = success; });
    render(<SafeDrivingMode />);
    await waitFor(() => expect(geolocationMock).toHaveBeenCalledTimes(1));
    if (change === 'hidden') vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    else H.gate = false;
    await act(async () => { deliver(fix); });
    expect(H.stored.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('recovers server state before resuming capture after an uncertain end response', async () => {
    recoveryMock.mockImplementationOnce(() => sessionRecovery());
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    render(<SafeDrivingMode />);
    await waitFor(() => expect(geolocationMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByText('Terminar Trayecto'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('actualizar'));
    expect(geolocationMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Reintentar'));
    await readyToStart();
    expect(recoveryMock).toHaveBeenCalledTimes(2);
  });

  it('does not send an old identity request after a delayed auth header resolves', async () => {
    let release!: (header: string) => void;
    vi.mocked(apiAuthHeader).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const view = render(<SafeDrivingMode />);
    await waitFor(() => expect(apiAuthHeader).toHaveBeenCalledTimes(1));
    H.uid = 'user-2'; view.rerender(<SafeDrivingMode />);
    await readyToStart();
    await act(async () => { release('Bearer old-user-token'); });
    expect(recoveryMock).toHaveBeenCalledTimes(1);
    expect(recoveryMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
  });

  it('does not flush another driver’s saved fixes after changing account', async () => {
    recoveryMock.mockImplementationOnce(() => sessionRecovery());
    geolocationMock.mockImplementationOnce((success) => success(fix));
    fetchMock.mockRejectedValue(new Error('offline'));
    const view = render(<SafeDrivingMode />);
    await waitFor(() => expect(H.stored.size).toBe(1));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    view.unmount();
    fetchMock.mockClear(); H.uid = 'user-2';
    render(<SafeDrivingMode />);
    await readyToStart();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(H.stored.size).toBe(1);
  });

  it('samples every minute only while visible and resumes on return', async () => {
    vi.useFakeTimers();
    recoveryMock.mockImplementation(() => sessionRecovery());
    geolocationMock.mockImplementation((success) => success({ ...fix, timestamp: Date.now() }));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    const view = render(<SafeDrivingMode />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(geolocationMock).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(geolocationMock).toHaveBeenCalledTimes(2);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(geolocationMock).toHaveBeenCalledTimes(2);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
    expect(geolocationMock).toHaveBeenCalledTimes(3);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(geolocationMock).toHaveBeenCalledTimes(3);
  });

  it('recovers the owned trip on mount without creating another trip', async () => {
    recoveryMock.mockImplementation(() => sessionRecovery());
    render(<SafeDrivingMode />);
    await waitFor(() => expect(screen.getByText('Terminar Trayecto')).toBeTruthy());
    expect(recoveryMock.mock.calls[0][0]).toBe('/api/commute/active?projectId=proj-1');
    expect(recoveryMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a captured sample through the API and waits for it before ending', async () => {
    geolocationMock.mockImplementation((success) => success(fix));
    fetchMock.mockImplementation(async (url: string) => ({ ok: true, json: async () =>
      url.endsWith('/start') ? { success: true, sessionId: 'cs_42' } : { success: true } }));
    render(<SafeDrivingMode />);
    await readyToStart();
    fireEvent.click(screen.getByText('Iniciar Trayecto'));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/commute/sample')).toBe(true));
    const call = fetchMock.mock.calls.find(([url]) => url === '/api/commute/sample')!;
    expect(JSON.parse(call[1].body)).toEqual({
      sessionId: 'cs_42', lat: -33.4, lng: -70.6, speedKmh: 36, accuracyM: 5, timestamp: fix.timestamp,
    });
    await waitFor(() => expect(H.stored.size).toBe(0));
    fireEvent.click(screen.getByText('Terminar Trayecto'));
    await waitFor(() => expect(screen.getByText('Iniciar Trayecto')).toBeTruthy());
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/commute/start', '/api/commute/sample', '/api/commute/end',
    ]);
  });

  it('retains a failed sample across remount and replays it before accepting end', async () => {
    recoveryMock.mockImplementation(() => sessionRecovery());
    geolocationMock.mockImplementationOnce((success) => success(fix));
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const view = render(<SafeDrivingMode />);
    await waitFor(() => expect(H.stored.size).toBe(1));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('muestras pendientes'));
    view.unmount();
    expect(H.stored.size).toBe(1);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    render(<SafeDrivingMode />);
    await waitFor(() => expect(H.stored.size).toBe(0));
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/commute/sample')).toHaveLength(2);
  });

  it('does not end while the server refuses a queued sample', async () => {
    recoveryMock.mockImplementation(() => sessionRecovery());
    geolocationMock.mockImplementationOnce((success) => success(fix));
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'unavailable' }) });
    render(<SafeDrivingMode />);
    await waitFor(() => expect(H.stored.size).toBe(1));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('muestras pendientes'));
    fireEvent.click(screen.getByText('Terminar Trayecto'));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === '/api/commute/sample').length).toBeGreaterThan(1));
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/commute/end')).toBe(false);
    expect([...H.stored.keys()].filter((key) => key.startsWith('commute-samples:'))).toHaveLength(1);
    expect(screen.getByText('Terminar Trayecto')).toBeTruthy();
  });

  it('shows recovery failure and retries without guessing an inactive session', async () => {
    recoveryMock.mockResolvedValueOnce({ ok: false, status: 500 });
    render(<SafeDrivingMode />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('recuperar'));
    expect((screen.getByRole('button', { name: 'Iniciar trayecto' }) as HTMLButtonElement).disabled).toBe(true);
    recoveryMock.mockImplementation(() => sessionRecovery());
    fireEvent.click(screen.getByText('Reintentar'));
    await waitFor(() => expect(screen.getByText('Terminar Trayecto')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects recovered metadata for another project', async () => {
    recoveryMock.mockResolvedValue({ ok: true, json: async () => ({ success: true,
      session: { sessionId: 'foreign', projectId: 'other', type: 'home-to-site' },
    }) });
    render(<SafeDrivingMode />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('recuperar'));
    expect(geolocationMock).not.toHaveBeenCalled();
  });

  it('ignores a late recovery response after identity changes', async () => {
    let resolveOld!: (value: unknown) => void;
    recoveryMock.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const view = render(<SafeDrivingMode />);
    await waitFor(() => expect(recoveryMock).toHaveBeenCalledTimes(1));
    H.uid = 'user-2'; view.rerender(<SafeDrivingMode />);
    await readyToStart();
    await act(async () => { resolveOld(sessionRecovery('old-driver')); });
    expect(screen.getByText('Iniciar Trayecto')).toBeTruthy();
    expect(geolocationMock).not.toHaveBeenCalled();
  });

  it('does not sample after project change when an old GPS callback arrives', async () => {
    recoveryMock.mockImplementationOnce(() => sessionRecovery());
    let deliver!: PositionCallback;
    geolocationMock.mockImplementationOnce((success) => { deliver = success; });
    const view = render(<SafeDrivingMode />);
    await waitFor(() => expect(geolocationMock).toHaveBeenCalledTimes(1));
    H.projectId = 'proj-2'; view.rerender(<SafeDrivingMode />);
    await readyToStart();
    await act(async () => { deliver(fix); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(H.stored.size).toBe(0);
  });

  it('shows a location error and does not bypass native disclosure', async () => {
    H.native = true; H.gate = false;
    recoveryMock.mockImplementation(() => sessionRecovery());
    render(<SafeDrivingMode />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('ubicación'));
    expect(geolocationMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps an unsaved fix available for retry when encrypted persistence fails', async () => {
    H.storageFails = true;
    recoveryMock.mockImplementation(() => sessionRecovery());
    geolocationMock.mockImplementationOnce((success) => success(fix));
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    render(<SafeDrivingMode />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('dispositivo'));
    expect(fetchMock).not.toHaveBeenCalled();
    H.storageFails = false;
    fireEvent.click(screen.getByText('Reintentar'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).timestamp).toBe(fix.timestamp);
    expect(geolocationMock).toHaveBeenCalledTimes(1);
  });
});
