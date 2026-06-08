// SPDX-License-Identifier: MIT
//
// Mesh packet signer/verifier — HMAC-SHA-256 over the canonical immutable
// packet subset. Closes the 'unsigned-dev' stub in meshPacket.ts:237-238.
//
// TRUST MODEL (why HMAC, not ECDSA):
//   The mesh runs OFFLINE between BLE/WiFi-Direct peers (a miner in a tunnel,
//   no cell signal). A receiver has never been online with the sender, so it
//   has no way to obtain the sender's ECDSA public key — and a self-certifying
//   pubkey carried IN the packet gives zero spoofing protection (an attacker
//   mints their own keypair). The only authentic offline-verifiable primitive
//   is a PER-PROJECT SHARED SECRET distributed to each device WHILE ONLINE and
//   AUTHENTICATED as a project member (see meshKeyStore.ts + /api/mesh/key).
//   Same-project peers share the key; an outsider without it cannot forge a
//   packet that same-project peers accept. This matches the existing project
//   isolation model (packetBelongsToProject) and the slm/hmac.ts pattern.
//
// The signature covers ONLY immutable fields. Relay-mutable fields
// (ttl, hopCount, relayedBy) are EXCLUDED so every hop does not invalidate the
// signature. applyHop() preserves signature/signaturePublicKeyId unchanged
// because it spreads ...packet.

import type { MeshPacket } from './meshPacket';

/** A provisioned mesh signing key. `keyId` is stamped into the packet as
 *  signaturePublicKeyId so receivers can pick the right key during rotation. */
export interface MeshSigningKey {
  /** Opaque version id of the project key (e.g. 'p1:v1'). */
  keyId: string;
  /** Non-extractable HMAC-SHA-256 CryptoKey (sign+verify). */
  key: CryptoKey;
}

/** Immutable fields the signature covers. */
type SignableFields = Pick<
  MeshPacket,
  | 'type'
  | 'fromUid'
  | 'toUid'
  | 'bornAtMs'
  | 'expiresAtMs'
  | 'priority'
  | 'payload'
> & { projectId?: string };

function getSubtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) {
    throw new Error('meshPacketSigner: crypto.subtle unavailable');
  }
  return c.subtle;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return globalThis
    .btoa(s)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (padded.length % 4)) % 4;
  const bin = globalThis.atob(padded + '='.repeat(pad));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Canonical signed bytes — the IMMUTABLE packet fields, in a fixed key order.
 * MUST NOT include ttl / hopCount / relayedBy / signature /
 * signaturePublicKeyId. A forged `fromUid` (impersonation) or tampered
 * `payload` (spoofed location) flips the HMAC and is rejected on receive.
 */
export function canonicalSignedBytes(packet: SignableFields): Uint8Array {
  const canonical = JSON.stringify({
    type: packet.type,
    fromUid: packet.fromUid,
    toUid: packet.toUid,
    bornAtMs: packet.bornAtMs,
    expiresAtMs: packet.expiresAtMs,
    priority: packet.priority,
    projectId: packet.projectId ?? null,
    payload: packet.payload,
  });
  return new TextEncoder().encode(canonical);
}

/**
 * Sign the canonical immutable bytes of a packet-in-construction. Returns the
 * signature (base64url) and the keyId to stamp as signaturePublicKeyId.
 */
export async function signPacket(
  fields: SignableFields,
  signingKey: MeshSigningKey,
): Promise<{ signature: string; signaturePublicKeyId: string }> {
  const subtle = getSubtle();
  const data = canonicalSignedBytes(fields);
  const tagBuf = await subtle.sign(
    { name: 'HMAC' },
    signingKey.key,
    data as unknown as BufferSource,
  );
  return {
    signature: bytesToBase64Url(new Uint8Array(tagBuf)),
    signaturePublicKeyId: signingKey.keyId,
  };
}

/**
 * Verify a received packet's signature against a candidate key. Returns true
 * only if the HMAC over the canonical immutable bytes matches AND the packet's
 * signaturePublicKeyId equals the candidate keyId (rotation safety). Never
 * throws on a verification failure — only on environment faults (and those are
 * caught and reduced to `false`, mirroring slm/hmac.ts verifyPayload).
 */
export async function verifyPacket(
  packet: MeshPacket,
  candidateKey: MeshSigningKey,
): Promise<boolean> {
  if (packet.signaturePublicKeyId !== candidateKey.keyId) return false;
  if (typeof packet.signature !== 'string' || packet.signature.length === 0) {
    return false;
  }
  let tagBytes: Uint8Array;
  try {
    tagBytes = base64UrlToBytes(packet.signature);
  } catch {
    return false;
  }
  // HMAC-SHA-256 → exactly 32 bytes. Bail early on obviously malformed input.
  if (tagBytes.length !== 32) return false;
  try {
    const subtle = getSubtle();
    const data = canonicalSignedBytes(packet);
    return await subtle.verify(
      { name: 'HMAC' },
      candidateKey.key,
      tagBytes as unknown as BufferSource,
      data as unknown as BufferSource,
    );
  } catch {
    return false;
  }
}
