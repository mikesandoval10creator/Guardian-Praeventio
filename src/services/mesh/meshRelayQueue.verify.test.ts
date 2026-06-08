// SPDX-License-Identifier: MIT
//
// Drives the REAL MeshRelayQueue.receive() with a real injected signingKey and
// real signed/forged packets. Proves the security wire: a forged SOS is
// bucketed untrusted (relayed, never forLocal), a forged breadcrumb is dropped,
// a validly signed packet reaches forLocal+enqueued. No reimplementation of the
// handler — the actual queue object is exercised end to end.

import { describe, it, expect, beforeAll } from 'vitest';
import { MeshRelayQueue } from './meshRelayQueue';
import { buildPacket } from './meshPacket';
import { signPacket, type MeshSigningKey } from './meshPacketSigner';

const NOW = 1_000_000_000;
const PROJECT = 'p1';

async function makeKey(): Promise<MeshSigningKey> {
  const key = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(32).fill(3),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return { keyId: 'p1:v1', key };
}

function sos(fromUid: string) {
  return buildPacket({
    type: 'sos',
    fromUid,
    toUid: 'broadcast',
    bornAtMs: NOW,
    projectId: PROJECT,
    payload: {
      workerUid: fromUid,
      location: { lat: -33.4, lng: -70.6, accuracyM: 10 },
      capturedAtMs: NOW,
      triggerReason: 'manual' as const,
      projectId: PROJECT,
    },
  });
}

function breadcrumb(fromUid: string) {
  return buildPacket({
    type: 'gps_breadcrumb',
    fromUid,
    toUid: 'broadcast',
    bornAtMs: NOW,
    projectId: PROJECT,
    payload: {
      workerUid: fromUid,
      lat: -33.4,
      lng: -70.6,
      accuracyM: 10,
      capturedAtMs: NOW,
      projectId: PROJECT,
    },
  });
}

describe('MeshRelayQueue verify-on-receive', () => {
  let key: MeshSigningKey;
  beforeAll(async () => {
    key = await makeKey();
  });

  it('accepts a validly signed SOS into forLocal + enqueued', async () => {
    const q = new MeshRelayQueue({
      selfUid: 'self',
      projectId: PROJECT,
      signingKey: key,
      now: () => NOW,
    });
    const base = sos('peer-1');
    const { signature, signaturePublicKeyId } = await signPacket(base, key);
    const res = await q.receive([{ ...base, signature, signaturePublicKeyId }]);
    expect(res.forLocal).toHaveLength(1);
    expect(res.enqueued).toHaveLength(1);
    expect(res.untrusted).toHaveLength(0);
    expect(res.dropped).toHaveLength(0);
  });

  it('forged SOS (unsigned) is relayed-untrusted, NEVER forLocal', async () => {
    const q = new MeshRelayQueue({
      selfUid: 'self',
      projectId: PROJECT,
      signingKey: key,
      now: () => NOW,
    });
    const forged = sos('victim'); // built with default unkeyed signature
    const res = await q.receive([forged]);
    expect(res.forLocal).toHaveLength(0); // attacker cannot drive a local emergency
    expect(res.untrusted).toHaveLength(1); // life signal preserved for relay
    expect(res.enqueued).toHaveLength(1);
  });

  it('forged SOS with a valid-looking-but-tampered signature is rejected from forLocal', async () => {
    const q = new MeshRelayQueue({
      selfUid: 'self',
      projectId: PROJECT,
      signingKey: key,
      now: () => NOW,
    });
    const base = sos('victim');
    const { signature } = await signPacket(base, key);
    // attacker keeps the valid signature but changes fromUid → HMAC mismatch.
    const forged = {
      ...base,
      signature,
      signaturePublicKeyId: key.keyId,
      fromUid: 'attacker',
      id: `${base.id}x`,
    };
    const res = await q.receive([forged]);
    expect(res.forLocal).toHaveLength(0);
    expect(res.untrusted).toHaveLength(1);
  });

  it('forged (unsigned) breadcrumb is DROPPED entirely when a key is present', async () => {
    const q = new MeshRelayQueue({
      selfUid: 'self',
      projectId: PROJECT,
      signingKey: key,
      now: () => NOW,
    });
    const res = await q.receive([breadcrumb('attacker')]);
    expect(res.dropped).toHaveLength(1);
    expect(res.forLocal).toHaveLength(0);
    expect(res.enqueued).toHaveLength(0);
    expect(res.untrusted).toHaveLength(0);
  });

  it('validly signed breadcrumb passes through (forLocal + enqueued)', async () => {
    const q = new MeshRelayQueue({
      selfUid: 'self',
      projectId: PROJECT,
      signingKey: key,
      now: () => NOW,
    });
    const base = breadcrumb('peer-1');
    const { signature, signaturePublicKeyId } = await signPacket(base, key);
    const res = await q.receive([{ ...base, signature, signaturePublicKeyId }]);
    expect(res.forLocal).toHaveLength(1);
    expect(res.enqueued).toHaveLength(1);
    expect(res.dropped).toHaveLength(0);
  });

  it('degraded (no key) mode preserves legacy behavior — unsigned breadcrumb still relays', async () => {
    const q = new MeshRelayQueue({
      selfUid: 'self',
      projectId: PROJECT,
      // no signingKey → cannot verify → legacy parity
      now: () => NOW,
    });
    const res = await q.receive([breadcrumb('peer-1')]);
    expect(res.forLocal).toHaveLength(1);
    expect(res.enqueued).toHaveLength(1);
    expect(res.dropped).toHaveLength(0);
    expect(res.untrusted).toHaveLength(0);
  });
});
