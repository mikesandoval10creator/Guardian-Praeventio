// @vitest-environment jsdom
//
// Sprint 35 — MeshProvider tests. Closes the ADR-0013 last-mile from
// Sprint 33 D3: verifies the React provider actually wires
// `TransportFacade` into the `meshFallback` module so `enqueueOutbound`
// stops returning `{enqueued:false, reason:'no-transport'}` in runtime.
//
// Coverage:
//   1. Mount with valid uid + projectId → startMesh() called +
//      registerMeshTransport(facade-instance).
//   2. Unmount → registerMeshTransport(null) + stopMesh() called.
//   3. startMesh() throws → no React crash, error captured.
//   4. No uid (auth still resolving) → early return, NO facade
//      constructed, NO registration.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

// ── Mocks (use vi.hoisted so factory closures resolve before module init) ──

const h = vi.hoisted(() => ({
  registerMeshTransportMock: vi.fn(),
  startMeshMock: vi.fn(async () => undefined),
  stopMeshMock: vi.fn(async () => undefined),
  facadeCtorMock: vi.fn(),
  queueCtorMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  refs: {
    firebase: { user: null as { uid: string } | null },
    project: { selectedProject: null as { id: string } | null },
  },
}));

vi.mock('../services/emergency/meshFallback', () => ({
  registerMeshTransport: h.registerMeshTransportMock,
}));

vi.mock('../services/mesh/transportFacade', () => ({
  TransportFacade: vi.fn().mockImplementation(function (this: any, opts: any) {
    h.facadeCtorMock(opts);
    this.startMesh = h.startMeshMock;
    this.stopMesh = h.stopMeshMock;
    return this;
  }),
}));

vi.mock('../services/mesh/meshRelayQueue', () => ({
  MeshRelayQueue: vi.fn().mockImplementation(function (this: any, opts: any) {
    h.queueCtorMock(opts);
    return this;
  }),
}));

vi.mock('../services/mesh/meshRelayXpWire', () => ({
  makeRelayXpHandler: () => () => undefined,
}));

vi.mock('../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: h.captureExceptionMock }),
}));

vi.mock('../contexts/FirebaseContext', () => ({
  useFirebase: () => h.refs.firebase,
}));

vi.mock('../contexts/ProjectContext', () => ({
  useProject: () => h.refs.project,
}));

// ── Import under test (after mocks) ───────────────────────────────────────

import { MeshProvider } from './MeshProvider';

// ── Helpers ───────────────────────────────────────────────────────────────

function flush() {
  return act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('MeshProvider — ADR-0013 last-mile (Sprint 35)', () => {
  beforeEach(() => {
    h.registerMeshTransportMock.mockReset();
    h.startMeshMock.mockReset().mockImplementation(async () => undefined);
    h.stopMeshMock.mockReset().mockImplementation(async () => undefined);
    h.facadeCtorMock.mockReset();
    h.queueCtorMock.mockReset();
    h.captureExceptionMock.mockReset();
    h.refs.firebase = { user: { uid: 'u-self' } };
    h.refs.project = { selectedProject: { id: 'p-1' } };
  });

  afterEach(() => {
    cleanup();
  });

  it('mount con uid + projectId → startMesh + registerMeshTransport(facade)', async () => {
    render(
      <MeshProvider>
        <div data-testid="child">child</div>
      </MeshProvider>,
    );
    await flush();

    expect(h.queueCtorMock).toHaveBeenCalledTimes(1);
    expect(h.queueCtorMock.mock.calls[0][0]).toMatchObject({
      selfUid: 'u-self',
      projectId: 'p-1',
    });
    expect(h.facadeCtorMock).toHaveBeenCalledTimes(1);
    expect(h.facadeCtorMock.mock.calls[0][0]).toMatchObject({
      peerId: 'u-self',
      projectId: 'p-1',
    });
    expect(h.startMeshMock).toHaveBeenCalledTimes(1);
    expect(h.registerMeshTransportMock).toHaveBeenCalledTimes(1);
    const registered = h.registerMeshTransportMock.mock.calls[0][0];
    expect(registered).toBeTruthy();
    expect(typeof registered.startMesh).toBe('function');
  });

  it('unmount → registerMeshTransport(null) + stopMesh', async () => {
    const { unmount } = render(
      <MeshProvider>
        <div />
      </MeshProvider>,
    );
    await flush();
    expect(h.registerMeshTransportMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ startMesh: expect.any(Function) }),
    );

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    const calls = h.registerMeshTransportMock.mock.calls;
    expect(calls[calls.length - 1][0]).toBeNull();
    expect(h.stopMeshMock).toHaveBeenCalledTimes(1);
  });

  it('startMesh throws → no crash, error captured, app sigue', async () => {
    h.startMeshMock.mockImplementationOnce(async () => {
      throw new Error('BLE permission denied');
    });

    const { getByTestId } = render(
      <MeshProvider>
        <div data-testid="child">still-here</div>
      </MeshProvider>,
    );
    await flush();

    expect(getByTestId('child').textContent).toBe('still-here');
    expect(h.captureExceptionMock).toHaveBeenCalledTimes(1);
    // registerMeshTransport(facade) must NOT be called when startMesh fails.
    const nonNullRegistrations = h.registerMeshTransportMock.mock.calls.filter(
      (c) => c[0] !== null,
    );
    expect(nonNullRegistrations).toHaveLength(0);
  });

  it('sin uid (auth aún no resuelta) → early return, no facade', async () => {
    h.refs.firebase = { user: null };
    render(
      <MeshProvider>
        <div />
      </MeshProvider>,
    );
    await flush();

    expect(h.facadeCtorMock).not.toHaveBeenCalled();
    expect(h.queueCtorMock).not.toHaveBeenCalled();
    expect(h.startMeshMock).not.toHaveBeenCalled();
    expect(h.registerMeshTransportMock).not.toHaveBeenCalled();
  });
});
