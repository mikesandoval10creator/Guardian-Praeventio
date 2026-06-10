// @vitest-environment jsdom
//
// Tests for the evacuation-headcount client hook (REST + live Firestore).
// Vital path: this is how a meeting-point QR scan and the drill lifecycle
// (start → scan-qr → status → end) reach the server during a real evacuation,
// plus the live Firestore subscription the dashboard uses for <1s latency.
//
// We assert the path/method/JSON-body/auth-header contract for each of the
// four `authedFetch` callbacks, the error translation done by `json<T>`
// (server `message`/`error` string vs `http_<status>`), and the snapshot
// stitching done by the fetch-free `subscribeToDrill` helper.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Module mocks ──────────────────────────────────────────────────────────
// `apiAuthHeaders` is the only auth surface; pin it to a deterministic header.
vi.mock('../lib/apiAuth', () => ({
  apiAuthHeaders: vi.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

// Importing the hook pulls in `db` from services/firebase + the modular
// firestore API. Stub both so the test never bootstraps a real Firebase app
// or opens a network listener. `doc`/`collection` just echo back a marker;
// `onSnapshot` is captured per-test so we can drive the callbacks by hand.
vi.mock('../services/firebase', () => ({
  db: { __db: true },
  auth: { currentUser: null },
}));

const onSnapshotMock = vi.fn();
const docMock = vi.fn((..._args: unknown[]) => ({ __ref: 'doc' }));
const collectionMock = vi.fn((..._args: unknown[]) => ({ __ref: 'collection' }));
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => docMock(...args),
  collection: (...args: unknown[]) => collectionMock(...args),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
}));

import {
  useEvacuationHeadcount,
  subscribeToDrill,
} from './useEvacuationHeadcount';

// ── fetch fixtures ────────────────────────────────────────────────────────
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  onSnapshotMock.mockReset();
  docMock.mockClear();
  collectionMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function errJson(status: number, body: unknown = {}): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

// Returns the [url, init] of the Nth fetch call with `init` narrowed.
function call(n = 0): { url: string; init: RequestInit; headers: Record<string, string>; body: unknown } {
  const [url, init] = fetchMock.mock.calls[n]! as [string, RequestInit];
  const headers = (init.headers ?? {}) as Record<string, string>;
  const body = init.body ? JSON.parse(init.body as string) : undefined;
  return { url, init, headers, body };
}

const startInput = {
  projectId: 'p1',
  kind: 'drill' as const,
  meetingPointId: 'mp1',
  expectedWorkers: [{ uid: 'w1', fullName: 'Ada' }],
};

// ── Hook callbacks (renderHook / jsdom) ─────────────────────────────────────
describe('useEvacuationHeadcount — REST callbacks', () => {
  it('start → POST /api/evacuation/start with JSON body + auth + content-type headers', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true, drill: { id: 'd1', projectId: 'p1' } }));
    const { result } = renderHook(() => useEvacuationHeadcount());

    const out = await result.current.start(startInput);

    expect(out).toEqual({ ok: true, drill: { id: 'd1', projectId: 'p1' } });
    const { url, init, headers, body } = call();
    expect(url).toBe('/api/evacuation/start');
    expect(init.method).toBe('POST');
    expect(body).toEqual(startInput);
    expect(headers.Authorization).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('scanQr → POST /api/evacuation/scan-qr with the scan payload', async () => {
    fetchMock.mockResolvedValue(
      okJson({ ok: true, drill: { id: 'd1' }, status: { isComplete: false } }),
    );
    const { result } = renderHook(() => useEvacuationHeadcount());
    const input = {
      projectId: 'p1',
      drillId: 'd1',
      workerUid: 'w1',
      meetingPointId: 'mp1',
    };

    const out = await result.current.scanQr(input);

    expect(out.status).toEqual({ isComplete: false });
    const { url, init, body } = call();
    expect(url).toBe('/api/evacuation/scan-qr');
    expect(init.method).toBe('POST');
    expect(body).toEqual(input);
  });

  it('fetchStatus → GET /api/evacuation/status with projectId+drillId query string, no body', async () => {
    fetchMock.mockResolvedValue(
      okJson({ ok: true, drill: { id: 'd1' }, status: { coveragePercent: 50 } }),
    );
    const { result } = renderHook(() => useEvacuationHeadcount());

    const out = await result.current.fetchStatus({ projectId: 'p1', drillId: 'd1' });

    expect(out.status).toEqual({ coveragePercent: 50 });
    const { url, init, headers } = call();
    expect(url).toBe('/api/evacuation/status?projectId=p1&drillId=d1');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    // auth header is still attached on GET
    expect(headers.Authorization).toBe('Bearer test-token');
  });

  it('end → POST /api/evacuation/end with the drill id', async () => {
    fetchMock.mockResolvedValue(
      okJson({ ok: true, drill: { id: 'd1', endedAt: 'now' }, postmortem: { evacTimeSec: 120 } }),
    );
    const { result } = renderHook(() => useEvacuationHeadcount());

    const out = await result.current.end({ projectId: 'p1', drillId: 'd1' });

    expect(out.postmortem).toMatchObject({ evacTimeSec: 120 });
    const { url, init, body } = call();
    expect(url).toBe('/api/evacuation/end');
    expect(init.method).toBe('POST');
    expect(body).toEqual({ projectId: 'p1', drillId: 'd1' });
  });

  it('re-exports subscribeToDrill from the hook return', () => {
    const { result } = renderHook(() => useEvacuationHeadcount());
    expect(result.current.subscribeToDrill).toBe(subscribeToDrill);
  });
});

// ── Error translation (json<T>) ─────────────────────────────────────────────
describe('useEvacuationHeadcount — error handling', () => {
  it('throws the server-provided `message` on a non-ok response', async () => {
    fetchMock.mockResolvedValue(errJson(409, { message: 'drill_already_active' }));
    const { result } = renderHook(() => useEvacuationHeadcount());
    await expect(result.current.start(startInput)).rejects.toThrow('drill_already_active');
  });

  it('falls back to the `error` field when `message` is absent', async () => {
    fetchMock.mockResolvedValue(errJson(403, { error: 'forbidden' }));
    const { result } = renderHook(() => useEvacuationHeadcount());
    await expect(
      result.current.scanQr({ projectId: 'p1', drillId: 'd1', workerUid: 'w1', meetingPointId: 'mp1' }),
    ).rejects.toThrow('forbidden');
  });

  it('throws http_<status> when the error body has neither message nor error', async () => {
    fetchMock.mockResolvedValue(errJson(500, {}));
    const { result } = renderHook(() => useEvacuationHeadcount());
    await expect(result.current.end({ projectId: 'p1', drillId: 'd1' })).rejects.toThrow('http_500');
  });

  it('tolerates an unparseable error body (falls back to http_<status>)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    const { result } = renderHook(() => useEvacuationHeadcount());
    await expect(
      result.current.fetchStatus({ projectId: 'p1', drillId: 'd1' }),
    ).rejects.toThrow('http_502');
  });
});

// ── Live Firestore subscription (subscribeToDrill) ──────────────────────────
// onSnapshot is mocked; we capture the (ref, onNext, onError) registered for
// the drill doc and the scans subcollection, then invoke onNext to assert the
// helper stitches metadata + scans into a single EvacuationDrill and only emits
// after BOTH listeners have fired once.
describe('subscribeToDrill — live Firestore stitching', () => {
  const args = { tenantId: 't1', projectId: 'p1', drillId: 'd1' };

  function wire() {
    const onUpdate = vi.fn();
    const onError = vi.fn();
    const unsubMeta = vi.fn();
    const unsubScans = vi.fn();
    // 1st onSnapshot call = drill doc, 2nd = scans subcollection.
    onSnapshotMock
      .mockImplementationOnce((_ref, onNext, onErr) => {
        wire.metaNext = onNext;
        wire.metaErr = onErr;
        return unsubMeta;
      })
      .mockImplementationOnce((_ref, onNext, onErr) => {
        wire.scansNext = onNext;
        wire.scansErr = onErr;
        return unsubScans;
      });
    const unsub = subscribeToDrill(args, onUpdate, onError);
    return { onUpdate, onError, unsub, unsubMeta, unsubScans };
  }

  wire.metaNext = (_s: any) => {};

  wire.scansNext = (_s: any) => {};

  wire.metaErr = (_e: any) => {};

  wire.scansErr = (_e: any) => {};

  const metaDoc = {
    id: 'd1',
    projectId: 'p1',
    kind: 'real',
    startedAt: '2026-06-01T00:00:00Z',
    startedByUid: 'u1',
    meetingPointId: 'mp1',
    expectedWorkers: [{ uid: 'w1', fullName: 'Ada' }],
    endedAt: null,
  };
  const scanDoc = { workerUid: 'w1', scannedAt: '2026-06-01T00:01:00Z', meetingPointId: 'mp1', scannedByUid: 'w1' };

  it('registers two onSnapshot listeners (drill doc + scans subcollection)', () => {
    wire();
    expect(onSnapshotMock).toHaveBeenCalledTimes(2);
    expect(docMock).toHaveBeenCalledTimes(1);
    expect(collectionMock).toHaveBeenCalledTimes(1);
  });

  it('does not emit until BOTH the meta and scans listeners have fired once', () => {
    const { onUpdate } = wire();
    // only the meta listener fires → still waiting on scans → no emit
    wire.metaNext({ exists: () => true, data: () => metaDoc });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('emits the assembled drill (metadata + scans, endedAt normalised) once both fire', () => {
    const { onUpdate } = wire();
    wire.metaNext({ exists: () => true, data: () => metaDoc });
    wire.scansNext({ docs: [{ data: () => scanDoc }] });

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({
      id: 'd1',
      projectId: 'p1',
      kind: 'real',
      startedAt: '2026-06-01T00:00:00Z',
      startedByUid: 'u1',
      meetingPointId: 'mp1',
      expectedWorkers: [{ uid: 'w1', fullName: 'Ada' }],
      endedAt: undefined, // null → undefined
      scans: [scanDoc],
    });
  });

  it('emits null when the drill doc does not exist', () => {
    const { onUpdate } = wire();
    wire.scansNext({ docs: [] });
    wire.metaNext({ exists: () => false, data: () => ({}) });
    expect(onUpdate).toHaveBeenLastCalledWith(null);
  });

  it('forwards listener errors to onError', () => {
    const { onError } = wire();
    const boom = new Error('permission-denied');
    wire.metaErr(boom);
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('unsubscribe tears down both underlying listeners', () => {
    const { unsub, unsubMeta, unsubScans } = wire();
    unsub();
    expect(unsubMeta).toHaveBeenCalledTimes(1);
    expect(unsubScans).toHaveBeenCalledTimes(1);
  });
});
