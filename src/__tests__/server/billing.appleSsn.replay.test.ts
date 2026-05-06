// Praeventio Guard — Sprint 35 audit P0 (Apple SSN replay defense).
//
// AUDIT CONTEXT
// -------------
// Sprint 27 H2 closed the production Apple App Store Server Notifications v2
// webhook (POST /api/billing/webhook/apple). The Sprint 35 audit asked for a
// replay-defense E2E covering token-replay → revenue-loss vectors. The
// existing src/__tests__/server/billing.appleSsn.test.ts has near-full
// coverage (incl. an idempotency case) but the audit row asked for a
// dedicated, attacker-shaped suite that names each replay scenario
// independently so a regression in any single defense is unmissable in CI.
//
// This file adds focused asserts for:
//   1. Valid SignedPayload → 200 + audit row + activated subscription.
//   2. Same SignedPayload redelivered → 200 replay=true, NO double-write,
//      NO second audit row.
//   3. Tampered (signature flip) → 401 invalid_signature, no Firestore writes.
//   4. Missing x5c header (forged unsigned token) → 401, no writes.
//   5. Malformed body (non-string signedPayload) → 400.
//
// We re-use the same JWS fixture machinery as billing.appleSsn.test.ts to
// avoid duplicating the (verbose) ASN.1 cert-builder. Importing from the
// sibling test file is intentionally avoided — vitest treats it as a test
// file and would re-run those describes here. We instead depend on the
// service module's own cert-tolerant verifyJwsLeafOnly path, building a
// fresh self-signed P-256 keypair per-suite.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { generateKeyPairSync, createSign, randomBytes } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';

import { buildTestServer, type TestServerHandle, InMemoryFirestore } from './test-server.js';

// ───────────────────────────────────────────────────────────────────────────
// Fixture: minimal self-signed P-256 cert + signing helpers. Mirrors
// billing.appleSsn.test.ts but kept local so this suite is independent.
// ───────────────────────────────────────────────────────────────────────────

interface SigMat {
  privateKeyPem: string;
  certB64Der: string;
}

function derLen(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len <= 0xff) return Buffer.from([0x81, len]);
  if (len <= 0xffff) return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  return Buffer.from([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}
function derWrap(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}
function derSequence(b: Buffer): Buffer { return derWrap(0x30, b); }
function derSet(b: Buffer): Buffer { return derWrap(0x31, b); }
function derInteger(v: number): Buffer {
  if (v === 0) return Buffer.from([0x02, 0x01, 0x00]);
  const bytes: number[] = [];
  let x = v;
  while (x > 0) { bytes.unshift(x & 0xff); x >>>= 8; }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return Buffer.concat([Buffer.from([0x02, bytes.length]), Buffer.from(bytes)]);
}
function derBitString(c: Buffer): Buffer {
  return derWrap(0x03, Buffer.concat([Buffer.from([0x00]), c]));
}
function derUtcTime(d: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, '0');
  const s = pad(d.getUTCFullYear() % 100) + pad(d.getUTCMonth() + 1)
    + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes())
    + pad(d.getUTCSeconds()) + 'Z';
  return derWrap(0x17, Buffer.from(s, 'ascii'));
}
function derPrintableString(s: string): Buffer {
  return derWrap(0x13, Buffer.from(s, 'ascii'));
}
function derOid(...arcs: number[]): Buffer {
  const bytes: number[] = [arcs[0] * 40 + arcs[1]];
  for (let i = 2; i < arcs.length; i++) {
    let v = arcs[i];
    const stack: number[] = [v & 0x7f];
    v >>>= 7;
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>>= 7; }
    bytes.push(...stack);
  }
  return derWrap(0x06, Buffer.from(bytes));
}

const OID_CN = derOid(2, 5, 4, 3);
const OID_ECDSA_SHA256 = derSequence(derOid(1, 2, 840, 10045, 4, 3, 2));

function buildName(cn: string): Buffer {
  return derSequence(derSet(derSequence(Buffer.concat([OID_CN, derPrintableString(cn)]))));
}
function buildTbs(spki: Buffer): Buffer {
  const version = derWrap(0xa0, derInteger(2));
  const serial = derInteger(1);
  const issuer = buildName('Replay Test Leaf');
  const validity = derSequence(Buffer.concat([
    derUtcTime(new Date('2020-01-01T00:00:00Z')),
    derUtcTime(new Date('2099-12-31T23:59:59Z')),
  ]));
  return derSequence(Buffer.concat([
    version, serial, OID_ECDSA_SHA256, issuer, validity, issuer, spki,
  ]));
}
function buildSigMat(): SigMat {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }) as string;
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const tbs = buildTbs(spki);
  const signer = createSign('SHA256');
  signer.update(tbs); signer.end();
  const signature = signer.sign({ key: privateKey, dsaEncoding: 'der' });
  const cert = derSequence(Buffer.concat([tbs, OID_ECDSA_SHA256, derBitString(signature)]));
  return { privateKeyPem, certB64Der: cert.toString('base64') };
}

let sigMat: SigMat;

async function signInner(payload: Record<string, any>): Promise<string> {
  const key = await importPKCS8(sigMat.privateKeyPem, 'ES256');
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', x5c: [sigMat.certB64Der] })
    .sign(key);
}
async function signOuter(args: {
  notificationType: string;
  notificationUUID?: string;
  transactionInfo?: Record<string, any>;
}): Promise<string> {
  const key = await importPKCS8(sigMat.privateKeyPem, 'ES256');
  const data: Record<string, any> = {};
  if (args.transactionInfo) {
    data.signedTransactionInfo = await signInner(args.transactionInfo);
  }
  return new SignJWT({
    notificationType: args.notificationType,
    notificationUUID: args.notificationUUID ?? randomBytes(8).toString('hex'),
    data,
  })
    .setProtectedHeader({ alg: 'ES256', x5c: [sigMat.certB64Der] })
    .sign(key);
}

// ───────────────────────────────────────────────────────────────────────────
// Suite
// ───────────────────────────────────────────────────────────────────────────

let handle: TestServerHandle;
let fs: InMemoryFirestore;

beforeAll(() => {
  sigMat = buildSigMat();
});

describe('Apple SSN replay defense — POST /api/billing/webhook/apple', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
    handle = buildTestServer({ firestore: fs });
  });

  it('case 1: valid SignedPayload activates entitlement + writes single audit row', async () => {
    fs.store.set('users/uid-replay-1', {
      subscription: { appleAppAccountToken: 'aat-1' },
    });
    const expiresMs = Date.parse('2030-06-01T00:00:00Z');
    const jws = await signOuter({
      notificationType: 'SUBSCRIBED',
      notificationUUID: 'uuid-fresh-1',
      transactionInfo: {
        appAccountToken: 'aat-1',
        productId: 'praeventio_premium_monthly',
        originalTransactionId: 'orig-1',
        expiresDate: expiresMs,
      },
    });
    const res = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: jws });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('grant');
    const user = fs.store.get('users/uid-replay-1');
    expect(user.subscription.status).toBe('active');
    const auditRows = [...fs.store.keys()].filter((k) =>
      k.startsWith('apple_ssn_attempts/'),
    );
    expect(auditRows).toHaveLength(1);
    // Idempotency lock landed under processed_apple_ssn/{uuid}.
    expect(fs.store.get('processed_apple_ssn/uuid-fresh-1')?.status).toBe('done');
  });

  it('case 2: redelivery of identical SignedPayload returns replay=true and is a no-op', async () => {
    fs.store.set('users/uid-replay-2', {
      subscription: { appleAppAccountToken: 'aat-2' },
    });
    const jws = await signOuter({
      notificationType: 'SUBSCRIBED',
      notificationUUID: 'uuid-replay-2',
      transactionInfo: {
        appAccountToken: 'aat-2',
        productId: 'praeventio_premium_monthly',
        originalTransactionId: 'orig-2',
      },
    });
    const first = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: jws });
    expect(first.status).toBe(200);
    // Manually overwrite the user doc with a sentinel so we can detect
    // any double-apply on the second delivery.
    fs.store.set('users/uid-replay-2', {
      subscription: {
        appleAppAccountToken: 'aat-2',
        status: 'manually-overridden-replay-sentinel',
      },
    });
    const second = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: jws });
    expect(second.status).toBe(200);
    expect(second.body.replay).toBe(true);
    // Sentinel preserved → handler short-circuited on the lock.
    expect(fs.store.get('users/uid-replay-2').subscription.status).toBe(
      'manually-overridden-replay-sentinel',
    );
    const auditRows = [...fs.store.keys()].filter((k) =>
      k.startsWith('apple_ssn_attempts/'),
    );
    expect(auditRows).toHaveLength(1);
  });

  it('case 3: tampered signature → 401 invalid_signature, no Firestore mutations', async () => {
    fs.store.set('users/uid-replay-3', {
      subscription: { appleAppAccountToken: 'aat-3' },
    });
    const before = fs.store.get('users/uid-replay-3');
    const jws = await signOuter({
      notificationType: 'SUBSCRIBED',
      notificationUUID: 'uuid-tampered',
      transactionInfo: { appAccountToken: 'aat-3' },
    });
    const parts = jws.split('.');
    const sig = Buffer.from(parts[2], 'base64url');
    sig[0] ^= 0xff;
    const tampered = `${parts[0]}.${parts[1]}.${sig.toString('base64url')}`;
    const res = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: tampered });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_signature');
    // No state change.
    expect(fs.store.get('users/uid-replay-3')).toEqual(before);
    expect(fs.store.has('processed_apple_ssn/uuid-tampered')).toBe(false);
    expect([...fs.store.keys()].some((k) => k.startsWith('apple_ssn_attempts/'))).toBe(false);
  });

  it('case 4: forged JWS without x5c header → 401, no writes', async () => {
    const key = await importPKCS8(sigMat.privateKeyPem, 'ES256');
    // Build a JWT WITHOUT the x5c header — verifier should reject before
    // any state mutation. This mirrors an attacker who tries to ship a
    // self-signed token without the cert chain Apple always carries.
    const jws = await new SignJWT({
      notificationUUID: 'uuid-no-x5c',
      notificationType: 'SUBSCRIBED',
    })
      .setProtectedHeader({ alg: 'ES256' })
      .sign(key);
    const res = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: jws });
    expect(res.status).toBe(401);
    expect([...fs.store.keys()].some((k) => k.startsWith('apple_ssn_attempts/'))).toBe(false);
    expect([...fs.store.keys()].some((k) => k.startsWith('processed_apple_ssn/'))).toBe(false);
  });

  it('case 5: malformed body (missing signedPayload) → 400', async () => {
    const res = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_signed_payload');
  });
});
