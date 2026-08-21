// SPDX-License-Identifier: MIT
//
// Sprint 33 — Unit tests for meshFallback.ts (ADR 0013, Mesh Information Relay).
//
// These tests exercise the *internal* implementation of meshFallback directly
// (enqueueOutbound, registerMeshTransport, __resetForTests, and the private
// mapTriggerReason indirectly via enqueueOutbound). They do NOT mock the module
// itself — only its two mesh-engine dependencies (`getMeshSigningKey` and
// `buildSignedPacket`) so we can assert on the packet handed to the facade.
//
// The sibling `EmergencyContext.meshFallback.test.tsx` mocks the whole module
// (vi.mock('./meshFallback')) to verify the EmergencyContext wiring; this file
// is the complementary "white-box" layer that locks down meshFallback's own
// contracts.

import { describe, it, expect, beforeEach, vi } from 'vitest';

import type { MeshPacket, MeshPacketType } from '../mesh/meshPacket';
import type { TransportFacade } from '../mesh/transportFacade';

// --- Mocks (module-level, hoisted above imports) ---------------------------
//
// `buildSignedPacket` is the only place the mapped `triggerReason` surfaces:
// enqueueOutbound builds a MeshPacket via buildSignedPacket, and the resulting
// packet.payload.triggerReason is what mapTriggerReason produced. We capture
// that packet to assert the mapping. `getMeshSigningKey` is mocked so no IDB /
// WebCrypto / indexeddb backend is required — meshKeyStore's openDB never runs.
type SignFn = (opts: object, key: unknown) => Promise<MeshPacket>;
const buildSignedPacketMock: ReturnType<typeof vi.fn<SignFn>> =
  vi.hoisted(() =>
    vi.fn(async (opts: object) => ({
      id: 'pkt-test-001',
      type: 'sos' satisfies MeshPacketType,
      fromUid: 'w-fallback',
      toUid: 'broadcast',
      ttl: 16,
      hopCount: 0,
      bornAtMs: 1_000,
      expiresAtMs: 2_000,
      payload: opts,
      signature: 'unkeyed',
      signaturePublicKeyId: 'unkeyed',
      relayedBy: [],
      projectId: 'p-fallback',
      priority: 'sos',
    })),
  );

const getMeshSigningKeyMock = vi.hoisted(() =>
  vi.fn(async (_projectId: string) => null),
);

vi.mock('../mesh/meshPacket', () => ({
  buildSignedPacket: (...args: unknown[]) =>
    (buildSignedPacketMock as (...x: unknown[]) => unknown)(...args),
}));

vi.mock('../mesh/meshKeyStore', () => ({
  getMeshSigningKey: (...args: unknown[]) =>
    (getMeshSigningKeyMock as (...x: unknown[]) => unknown)(...args),
}));

// --- Imports (after mocks land) --------------------------------------------
import {
  enqueueOutbound,
  registerMeshTransport,
  __resetForTests,
} from './meshFallback';

// --- Test harness ---------------------------------------------------------

interface FakeFacade extends TransportFacade {
  sendLocal: (packet: MeshPacket) => Promise<{ enqueued: boolean; deliveredTo: string[]; queued: string[] }>;
}

function makeFakeFacade(
  impl?: (packet: MeshPacket) => Promise<{ enqueued: boolean; deliveredTo: string[]; queued: string[] }>,
): FakeFacade {
  const sendLocal = vi.fn(
    impl ?? (async () => ({ enqueued: true, deliveredTo: ['peer-1'], queued: [] })),
  );
  return { sendLocal } as unknown as FakeFacade;
}

const BASE_PAYLOAD = {
  projectId: 'p-1',
  emergencyType: 'fall',
  uid: 'worker-1',
  triggeredAtMs: 1_700_000_000,
};

// --- Tests ----------------------------------------------------------------

describe('meshFallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetForTests();
  });

  // -------------------------------------------------------------------------
  describe('__resetForTests + registerMeshTransport', () => {
    it('starts with no facade — enqueueOutbound is a no-op', async () => {
      __resetForTests();
      const res = await enqueueOutbound(BASE_PAYLOAD);
      expect(res).toEqual({ enqueued: false, reason: 'no-transport' });
      expect(buildSignedPacketMock).not.toHaveBeenCalled();
      expect(getMeshSigningKeyMock).not.toHaveBeenCalled();
    });

    it('registerMeshTransport(null) clears a previously registered facade', async () => {
      registerMeshTransport(makeFakeFacade());
      const ok = await enqueueOutbound(BASE_PAYLOAD);
      expect(ok).toMatchObject({ enqueued: true, packetId: 'pkt-test-001' });

      registerMeshTransport(null);
      const res = await enqueueOutbound(BASE_PAYLOAD);
      expect(res).toEqual({ enqueued: false, reason: 'no-transport' });
    });

    it('registerMeshTransport overwrites the previous facade (idempotent re-register)', async () => {
      const first = makeFakeFacade();
      const second = makeFakeFacade(async () => ({ enqueued: false, deliveredTo: [], queued: [] }));

      registerMeshTransport(first);
      registerMeshTransport(second);

      const res = await enqueueOutbound(BASE_PAYLOAD);
      // The second facade wins and its sendLocal resolves enqueued=false →
      // enqueueOutbound maps that to 'queue-rejected'.
      expect(res).toEqual({ enqueued: false, reason: 'queue-rejected', packetId: 'pkt-test-001' });
      expect(first.sendLocal).not.toHaveBeenCalled();
      expect(second.sendLocal).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('enqueueOutbound — no-transport path', () => {
    it('returns no-transport without touching the mesh engine', async () => {
      __resetForTests();
      const res = await enqueueOutbound(BASE_PAYLOAD);
      expect(res.enqueued).toBe(false);
      expect(res.reason).toBe('no-transport');
      expect(res.packetId).toBeUndefined();
      expect(getMeshSigningKeyMock).not.toHaveBeenCalled();
      expect(buildSignedPacketMock).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('enqueueOutbound — happy path', () => {
    it('delegates to the registered facade and returns the packet id', async () => {
      const facade = makeFakeFacade();
      registerMeshTransport(facade);

      const res = await enqueueOutbound(BASE_PAYLOAD);

      expect(res).toMatchObject({ enqueued: true, packetId: 'pkt-test-001' });
      expect(getMeshSigningKeyMock).toHaveBeenCalledTimes(1);
      expect(getMeshSigningKeyMock).toHaveBeenCalledWith(BASE_PAYLOAD.projectId);
      expect(buildSignedPacketMock).toHaveBeenCalledTimes(1);
      expect(facade.sendLocal).toHaveBeenCalledTimes(1);
    });

    it('builds an SOS packet with type "sos" and broadcast destination', async () => {
      registerMeshTransport(makeFakeFacade());

      await enqueueOutbound(BASE_PAYLOAD);

      const opts = buildSignedPacketMock.mock.calls[0]?.[0] as {
        type: string; fromUid: string; toUid: string; projectId: string;
      };
      expect(opts.type).toBe('sos');
      expect(opts.toUid).toBe('broadcast');
      expect(opts.fromUid).toBe(BASE_PAYLOAD.uid);
      expect(opts.projectId).toBe(BASE_PAYLOAD.projectId);
    });

    it('carries the honest placeholder location when no GPS is available', async () => {
      registerMeshTransport(makeFakeFacade());

      await enqueueOutbound(BASE_PAYLOAD);

      const opts = buildSignedPacketMock.mock.calls[0]?.[0] as {
        payload: { location: { lat: number; lng: number; accuracyM: number }; capturedAtMs: number };
      };
      expect(opts.payload.capturedAtMs).toBe(BASE_PAYLOAD.triggeredAtMs);
      // sosPayload.location is built inline by enqueueOutbound as the honest
      // "no GPS" sentinel before being passed to buildSignedPacket as opts.payload.
      expect(opts.payload.location).toEqual({ lat: 0, lng: 0, accuracyM: -1 });
    });

    it('passes project-scoped signing key (null when no key provisioned) to buildSignedPacket', async () => {
      registerMeshTransport(makeFakeFacade());

      await enqueueOutbound(BASE_PAYLOAD);

      const keyArg = buildSignedPacketMock.mock.calls[0]?.[1];
      // meshKeyStore.getMeshSigningKey returns null in this no-IDB scenario.
      expect(keyArg).toBeNull();
      expect(getMeshSigningKeyMock).toHaveBeenCalledWith(BASE_PAYLOAD.projectId);
    });
  });

  // -------------------------------------------------------------------------
  describe('enqueueOutbound — facade rejects / errors', () => {
    it('maps a facade enqueue=false into queue-rejected with the packet id', async () => {
      const facade = makeFakeFacade(async () => ({ enqueued: false, deliveredTo: [], queued: [] }));
      registerMeshTransport(facade);

      const res = await enqueueOutbound(BASE_PAYLOAD);
      expect(res).toEqual({ enqueued: false, reason: 'queue-rejected', packetId: 'pkt-test-001' });
    });

    it('maps a facade-throw into transport-error (fire-and-forget, never rethrows)', async () => {
      const facade = makeFakeFacade(async () => {
        throw new Error('plugin dead');
      });
      registerMeshTransport(facade);

      await expect(enqueueOutbound(BASE_PAYLOAD)).resolves.toEqual({
        enqueued: false,
        reason: 'transport-error',
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('mapTriggerReason (exercised via the signed packet payload)', () => {
  //
  // `mapTriggerReason` is intentionally NOT exported (it is a private helper).
  // Rather than export it solely for testing (which would leak internals), we
  // assert the mapping through its only observable output: the
  // `payload.triggerReason` field that enqueueOutbound passes to
  // buildSignedPacket. We read it back from the buildSignedPacket mock call.

    async function mappedTriggerReason(emergencyType: string): Promise<string> {
      registerMeshTransport(makeFakeFacade());
      await enqueueOutbound({ ...BASE_PAYLOAD, emergencyType });
      const opts = buildSignedPacketMock.mock.calls[0]?.[0] as {
        payload?: { triggerReason?: string };
      };
      return opts.payload?.triggerReason ?? '';
    }

    it('maps fall-detected family → fall_detected (case-insensitive)', async () => {
      expect(await mappedTriggerReason('fall')).toBe('fall_detected');
      expect(await mappedTriggerReason('Fall_Detected')).toBe('fall_detected');
    });

    it('maps man-down family → man_down_timeout (case-insensitive)', async () => {
      expect(await mappedTriggerReason('man_down')).toBe('man_down_timeout');
      expect(await mappedTriggerReason('MAN_DOWN_TIMEOUT')).toBe('man_down_timeout');
    });

    it('maps no_response → no_response', async () => {
      expect(await mappedTriggerReason('no_response')).toBe('no_response');
    });

    it('falls back to manual for unknown / generic triggers', async () => {
      expect(await mappedTriggerReason('panic')).toBe('manual');
      expect(await mappedTriggerReason('')).toBe('manual');
    });
  });
});
