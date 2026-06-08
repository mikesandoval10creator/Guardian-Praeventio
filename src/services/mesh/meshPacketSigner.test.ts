// SPDX-License-Identifier: MIT
//
// Drives the REAL HMAC signer/verifier (signPacket/verifyPacket over
// canonicalSignedBytes) using real WebCrypto in vitest (Node 20 exposes
// globalThis.crypto.subtle). No mocks of the SUT. Proves the core security
// property: sign→verify roundtrips AND any tamper of a signed field → reject.

import { describe, it, expect, beforeAll } from 'vitest';
import { buildPacket } from './meshPacket';
import { signPacket, verifyPacket, type MeshSigningKey } from './meshPacketSigner';

const NOW = 1_000_000_000;

async function makeKey(
  keyId: string,
  raw = new Uint8Array(32).fill(7),
): Promise<MeshSigningKey> {
  const key = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return { keyId, key };
}

function sosPacket(fromUid = 'victim') {
  return buildPacket({
    type: 'sos',
    fromUid,
    toUid: 'broadcast',
    bornAtMs: NOW,
    projectId: 'p1',
    payload: {
      workerUid: fromUid,
      location: { lat: -33.4, lng: -70.6, accuracyM: 10 },
      capturedAtMs: NOW,
      triggerReason: 'manual' as const,
      projectId: 'p1',
    },
  });
}

describe('meshPacketSigner — HMAC sign/verify', () => {
  let key: MeshSigningKey;
  beforeAll(async () => {
    key = await makeKey('p1:v1');
  });

  it('sign then verify roundtrips', async () => {
    const base = sosPacket();
    const { signature, signaturePublicKeyId } = await signPacket(base, key);
    const signed = { ...base, signature, signaturePublicKeyId };
    expect(await verifyPacket(signed, key)).toBe(true);
  });

  it('rejects a tampered payload (spoofed location)', async () => {
    const base = sosPacket();
    const { signature, signaturePublicKeyId } = await signPacket(base, key);
    const tampered = {
      ...base,
      signature,
      signaturePublicKeyId,
      payload: {
        ...(base.payload as object),
        location: { lat: 0, lng: 0, accuracyM: -1 },
      },
    };
    expect(await verifyPacket(tampered, key)).toBe(false);
  });

  it('rejects a spoofed fromUid (impersonation)', async () => {
    const base = sosPacket('victim');
    const { signature, signaturePublicKeyId } = await signPacket(base, key);
    const impersonated = {
      ...base,
      signature,
      signaturePublicKeyId,
      fromUid: 'attacker',
    };
    expect(await verifyPacket(impersonated, key)).toBe(false);
  });

  it('rejects a signature made with a different project key', async () => {
    const base = sosPacket();
    const otherKey = await makeKey('p1:v1', new Uint8Array(32).fill(9));
    const { signature } = await signPacket(base, otherKey);
    const signed = { ...base, signature, signaturePublicKeyId: key.keyId };
    expect(await verifyPacket(signed, key)).toBe(false);
  });

  it('rejects when keyId does not match (rotation safety)', async () => {
    const base = sosPacket();
    const { signature } = await signPacket(base, key);
    const signed = { ...base, signature, signaturePublicKeyId: 'p1:v2' };
    expect(await verifyPacket(signed, key)).toBe(false);
  });

  it('rejects an unkeyed (unsigned) packet', async () => {
    const base = sosPacket(); // default 'unkeyed' sentinel
    expect(await verifyPacket(base, key)).toBe(false);
  });

  it('rejects a malformed / wrong-length signature', async () => {
    const base = sosPacket();
    expect(
      await verifyPacket(
        { ...base, signature: 'AAAA', signaturePublicKeyId: key.keyId },
        key,
      ),
    ).toBe(false);
  });

  it('relay-mutable fields (ttl/hopCount/relayedBy) do NOT invalidate the signature', async () => {
    const base = sosPacket();
    const { signature, signaturePublicKeyId } = await signPacket(base, key);
    const afterHop = {
      ...base,
      signature,
      signaturePublicKeyId,
      ttl: base.ttl - 1,
      hopCount: 1,
      relayedBy: ['relayer'],
    };
    expect(await verifyPacket(afterHop, key)).toBe(true);
  });
});
