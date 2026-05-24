// @vitest-environment jsdom
//
// Sprint 33 audit W10 — verifica el wire offline emergency → mesh
// rebroadcast (ADR 0013). Cubre 4 caminos:
//
//   1. Online + server OK         → mesh NO se llama.
//   2. Online + server 5xx        → mesh NO se llama (bug del backend, no offline).
//   3. Offline (navigator.onLine=false) → mesh enqueue llamado con type 'sos' + payload.
//   4. Offline + mesh throws      → error logged, NO rompe la UX.
//
// Caso real (memoria del usuario, minería LATAM): minero entra al
// túnel, fall_detected dispara, navigator.onLine flipa a false, y el
// SOS DEBE encolarse en el mesh para que un peer con red haga el
// server call por nosotros (transitivo). Flow Infinito Fase 1+2.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';

// --- Mock surface --------------------------------------------------------

type AnyMock = ReturnType<typeof vi.fn>;

const addDocMock: AnyMock = vi.fn(async () => ({ id: 'doc-1' }));
const updateDocMock: AnyMock = vi.fn(async () => undefined);
const collectionMock: AnyMock = vi.fn(() => ({ __c: true }));
const docMock: AnyMock = vi.fn(() => ({ __d: true }));

vi.mock('firebase/firestore', () => ({
  collection: collectionMock,
  addDoc: addDocMock,
  doc: docMock,
  updateDoc: updateDocMock,
}));

vi.mock('../services/firebase', () => ({
  db: { __db: true },
  auth: { currentUser: { uid: 'u-test', getIdToken: async () => 'tok' } },
  serverTimestamp: () => ({ __ts: true }),
}));

const captureEmergencyErrorMock: AnyMock = vi.fn();
vi.mock('../lib/sentry', () => ({
  captureEmergencyError: (...a: unknown[]) =>
    (captureEmergencyErrorMock as (...x: unknown[]) => unknown)(...a),
}));

// El test mockea el wrapper meshFallback (no el TransportFacade core,
// per la regla "NO toques transportFacade core").
const meshEnqueueOutboundMock: AnyMock = vi.fn();
vi.mock('../services/emergency/meshFallback', () => ({
  enqueueOutbound: (...a: unknown[]) =>
    (meshEnqueueOutboundMock as (...x: unknown[]) => unknown)(...a),
}));

// networkStatus controlable por test
let onlineFlag = true;
vi.mock('../utils/networkStatus', () => ({
  isOnline: () => onlineFlag,
}));

// logger mute pero observable
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const { EmergencyProvider, useEmergency } = await import('./EmergencyContext');

// --- Test harness --------------------------------------------------------

interface HarnessHandle {
  trigger: (type: string, projectId?: string) => Promise<void>;
}
const handle: HarnessHandle = {
  trigger: async () => {
    throw new Error('not wired yet');
  },
};

function Harness() {
  const ctx = useEmergency();
  handle.trigger = ctx.triggerEmergency;
  return null;
}

beforeEach(() => {
  addDocMock.mockClear();
  updateDocMock.mockClear();
  meshEnqueueOutboundMock.mockReset();
  captureEmergencyErrorMock.mockClear();
  onlineFlag = true;
  // Default: server fetch succeeds.
  globalThis.fetch = vi.fn(async () =>
    new Response('{}', { status: 200 }),
  ) as unknown as typeof fetch;
});

async function flushMicrotasks(): Promise<void> {
  // Permite que la cadena .then(...).then(...) del fire-and-forget
  // resuelva antes de aserciones.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

// --- Cases ---------------------------------------------------------------

describe('EmergencyContext — Sprint 33 W10 mesh fallback wire', () => {
  it('online + server 200 → mesh NO se llama', async () => {
    render(
      <EmergencyProvider>
        <Harness />
      </EmergencyProvider>,
    );

    await act(async () => {
      await handle.trigger('fall', 'proj-A');
    });
    // 2026-05-24: el fan-out `void notifyBrigadeServer(...).then(...)` ahora
    // hace `await import('../lib/apiAuth')` (§2.20 unified header). Ese
    // dynamic import pasa por el module loader → microtasks alone no
    // alcanzan. `waitFor` poll-asserta hasta que fetch sea invocado.
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
    await flushMicrotasks();

    expect(meshEnqueueOutboundMock).not.toHaveBeenCalled();
  });

  it('online + server 500 → mesh NO se llama (bug del backend, no offline)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('boom', { status: 500 }),
    ) as unknown as typeof fetch;

    render(
      <EmergencyProvider>
        <Harness />
      </EmergencyProvider>,
    );

    await act(async () => {
      await handle.trigger('fall', 'proj-B');
    });
    await flushMicrotasks();

    expect(meshEnqueueOutboundMock).not.toHaveBeenCalled();
  });

  it('offline (navigator.onLine=false) → mesh enqueue con type sos + payload correcto', async () => {
    onlineFlag = false;
    meshEnqueueOutboundMock.mockResolvedValue({ enqueued: true, packetId: 'pkt-1' });

    render(
      <EmergencyProvider>
        <Harness />
      </EmergencyProvider>,
    );

    await act(async () => {
      await handle.trigger('fall', 'proj-C');
    });
    await flushMicrotasks();

    expect(meshEnqueueOutboundMock).toHaveBeenCalledTimes(1);
    const arg = meshEnqueueOutboundMock.mock.calls[0]?.[0] as {
      projectId: string;
      emergencyType: string;
      uid: string;
      triggeredAtMs: number;
    };
    expect(arg.projectId).toBe('proj-C');
    expect(arg.emergencyType).toBe('fall');
    expect(arg.uid).toBe('u-test');
    expect(typeof arg.triggeredAtMs).toBe('number');
    // Verificación load-bearing: el wrapper construye un packet
    // type: 'sos' (ver meshFallback.ts buildPacket). Compatible con
    // Sprint 32 B3 XP wire que filtra por event.packetType === 'sos'.
  });

  it('offline + mesh wrapper throws → error capturado, no rompe UX', async () => {
    onlineFlag = false;
    meshEnqueueOutboundMock.mockRejectedValue(new Error('mesh kaput'));

    render(
      <EmergencyProvider>
        <Harness />
      </EmergencyProvider>,
    );

    let threw = false;
    await act(async () => {
      try {
        await handle.trigger('fall', 'proj-D');
      } catch {
        threw = true;
      }
    });
    await flushMicrotasks();

    // La UX (state setEmergency) ya cambió antes del fan-out. El
    // wrapper rejection NO debe propagar al caller.
    expect(threw).toBe(false);
    expect(captureEmergencyErrorMock).toHaveBeenCalled();
    const ctx = captureEmergencyErrorMock.mock.calls[0]?.[1] as Record<string, string>;
    expect(ctx.path).toBe('mesh_fallback');
  });
});
