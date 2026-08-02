// Praeventio Guard — Sprint 27 audit P0 fix H2.
//
// Tests for the Apple App Store Server Notifications v2 webhook +
// service module (services/billing/appleSsn.ts). Covers:
//
//   • Outer-JWS verification: invalid signature → 401, missing x5c → 401.
//   • SUBSCRIBED activates entitlement (status=active, expiryDate set).
//   • DID_RENEW renews (status=active, expiryDate updated).
//   • REFUND revokes (status=revoked).
//   • Idempotency on notificationUUID — second delivery is a replay.
//   • Audit row written with verified_chain=true after trusted verification.
//
// Fixture strategy: trusted-chain tests use Apple's official library fixtures
// and SignedDataVerifier itself. Runtime-generated self-signed JWS values prove
// the former exploit is rejected. Business/idempotency cases use an explicit
// NODE_ENV=test-only verifier seam and do not stand in for cryptographic proof.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { generateKeyPairSync, createSign, randomBytes } from 'node:crypto';
import { SignJWT, decodeJwt, importPKCS8 } from 'jose';
import {
  Environment,
  SignedDataVerifier,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  type ResponseBodyV2DecodedPayload,
} from '@apple/app-store-server-library';

import { buildTestServer, type TestServerHandle, InMemoryFirestore } from './test-server.js';
import {
  verifyAndDecodeAppleSsn,
  AppleSsnVerificationError,
  actionForNotificationType,
  applyAppleEntitlement,
} from '../../services/billing/appleSsn.js';
import {
  __setAppleSignedDataVerifierForTests,
  type AppleSignedDataVerifierLike,
} from '../../services/billing/appleSignedDataVerifier.js';

const FIXTURE_ROOT = new URL('../fixtures/apple-ssn/testCA.der', import.meta.url);
const FIXTURE_NOTIFICATION = new URL(
  '../fixtures/apple-ssn/testNotification.jws',
  import.meta.url,
);
const FIXTURE_TRANSACTION = new URL(
  '../fixtures/apple-ssn/transactionInfo.jws',
  import.meta.url,
);
const FIXTURE_RENEWAL = new URL(
  '../fixtures/apple-ssn/renewalInfo.jws',
  import.meta.url,
);
const ORIGINAL_APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID;
const ORIGINAL_APPLE_IAP_ENVIRONMENT = process.env.APPLE_IAP_ENVIRONMENT;
const ORIGINAL_APPLE_APP_ID = process.env.APPLE_APP_ID;

const decodingBusinessVerifier: AppleSignedDataVerifierLike = {
  async verifyAndDecodeNotification(jws) {
    return decodeJwt(jws) as ResponseBodyV2DecodedPayload;
  },
  async verifyAndDecodeTransaction(jws) {
    return decodeJwt(jws) as JWSTransactionDecodedPayload;
  },
  async verifyAndDecodeRenewalInfo(jws) {
    return decodeJwt(jws) as JWSRenewalInfoDecodedPayload;
  },
};

function officialFixtureVerifier(bundleId = 'com.example'): SignedDataVerifier {
  return new SignedDataVerifier(
    [readFileSync(FIXTURE_ROOT)],
    false,
    Environment.SANDBOX,
    bundleId,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Fixture: generate a P-256 keypair + self-signed cert that we can
// sign outer/inner JWSes with. Built once per file (beforeAll) — the
// keypair and cert are deterministic-shape but freshly generated, so
// no fixture file shipping required.
// ───────────────────────────────────────────────────────────────────────────

interface TestSigningMaterial {
  privateKeyPem: string;
  /** Single-line base64 DER cert — the form Apple uses in `x5c[]`. */
  certB64Der: string;
}

/** Build a minimal self-signed X.509 v1 cert over a P-256 public key.
 *  We use an ASN.1 structure compatible with `crypto.createX509Certificate`
 *  on Node 20+ — but to avoid depending on that API, we hand-roll a
 *  TBSCertificate and ECDSA signature. Keeps the fixture self-contained.
 *  The verifier only consumes the SubjectPublicKeyInfo bytes, so the
 *  cert validity dates are nominal. */
function generateTestSigningMaterial(): TestSigningMaterial {
  // Node's keygen returns SPKI for the public side, which is exactly
  // what `importX509`'s verifier reads from the cert.
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const privateKeyPem = privateKey.export({
    format: 'pem',
    type: 'pkcs8',
  }) as string;
  const publicKeySpkiDer = publicKey.export({
    format: 'der',
    type: 'spki',
  }) as Buffer;

  // Build a minimal X.509v3 cert by hand. We construct the TBS section
  // (version, serial, sigalg, issuer, validity, subject, SPKI), sign
  // it ECDSA-SHA256, and assemble the final SEQUENCE. This is verbose
  // but means the test has zero external cert-gen dependencies.
  const tbs = encodeTbsCertificate(publicKeySpkiDer);
  const sigAlg = OID_ECDSA_WITH_SHA256_SEQ;

  const signer = createSign('SHA256');
  signer.update(tbs);
  signer.end();
  const signature = signer.sign({ key: privateKey, dsaEncoding: 'der' });

  const cert = derSequence(
    Buffer.concat([
      tbs,
      sigAlg,
      derBitString(signature),
    ]),
  );

  return {
    privateKeyPem,
    certB64Der: cert.toString('base64'),
  };
}

// ─── Tiny ASN.1 DER builders — only the subset we need. ────────────────

function derLen(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len <= 0xff) return Buffer.from([0x81, len]);
  if (len <= 0xffff) return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  if (len <= 0xffffff) {
    return Buffer.from([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  }
  throw new Error('len too large for test fixture');
}

function derWrap(tag: number, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(body.length), body]);
}

function derSequence(body: Buffer): Buffer {
  return derWrap(0x30, body);
}

function derSet(body: Buffer): Buffer {
  return derWrap(0x31, body);
}

function derInteger(value: number): Buffer {
  // Tiny — only used for version + serial. Always non-negative.
  if (value === 0) return Buffer.from([0x02, 0x01, 0x00]);
  const bytes: number[] = [];
  let v = value;
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v >>>= 8;
  }
  if (bytes[0] & 0x80) bytes.unshift(0); // disambiguate sign
  return Buffer.concat([Buffer.from([0x02, bytes.length]), Buffer.from(bytes)]);
}

function derBitString(content: Buffer): Buffer {
  // Leading 0x00 = "no unused bits".
  return derWrap(0x03, Buffer.concat([Buffer.from([0x00]), content]));
}

function derUtcTime(d: Date): Buffer {
  // YYMMDDHHMMSSZ
  const pad = (n: number) => String(n).padStart(2, '0');
  const s =
    pad(d.getUTCFullYear() % 100) +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z';
  return derWrap(0x17, Buffer.from(s, 'ascii'));
}

function derPrintableString(s: string): Buffer {
  return derWrap(0x13, Buffer.from(s, 'ascii'));
}

function derOid(...arcs: number[]): Buffer {
  // OID encoder for the small set we use.
  const bytes: number[] = [];
  bytes.push(arcs[0] * 40 + arcs[1]);
  for (let i = 2; i < arcs.length; i++) {
    let v = arcs[i];
    const stack: number[] = [v & 0x7f];
    v >>>= 7;
    while (v > 0) {
      stack.unshift((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    bytes.push(...stack);
  }
  return derWrap(0x06, Buffer.from(bytes));
}

const OID_COMMON_NAME = derOid(2, 5, 4, 3);
const OID_ECDSA_WITH_SHA256_SEQ = derSequence(derOid(1, 2, 840, 10045, 4, 3, 2));

function buildName(cn: string): Buffer {
  // Name ::= SEQUENCE OF RelativeDistinguishedName
  return derSequence(
    derSet(derSequence(Buffer.concat([OID_COMMON_NAME, derPrintableString(cn)]))),
  );
}

function encodeTbsCertificate(spkiDer: Buffer): Buffer {
  const version = derWrap(0xa0, derInteger(2)); // v3
  const serial = derInteger(1);
  const sigAlg = OID_ECDSA_WITH_SHA256_SEQ;
  const issuer = buildName('Test Apple-style Leaf');
  const subject = issuer;
  const notBefore = derUtcTime(new Date('2020-01-01T00:00:00Z'));
  const notAfter = derUtcTime(new Date('2099-12-31T23:59:59Z'));
  const validity = derSequence(Buffer.concat([notBefore, notAfter]));
  // SPKI is already a full SEQUENCE coming out of node:crypto SPKI export.
  return derSequence(
    Buffer.concat([version, serial, sigAlg, issuer, validity, subject, spkiDer]),
  );
}

// ───────────────────────────────────────────────────────────────────────────
// JWT builders — outer envelope + inner transactionInfo signing.
// ───────────────────────────────────────────────────────────────────────────

let signingMaterial: TestSigningMaterial;

async function signTransactionInfo(payload: Record<string, any>): Promise<string> {
  const key = await importPKCS8(signingMaterial.privateKeyPem, 'ES256');
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', x5c: [signingMaterial.certB64Der] })
    .sign(key);
}

interface OuterArgs {
  notificationType: string;
  notificationUUID?: string;
  subtype?: string;
  transactionInfo?: Record<string, any>;
  renewalInfo?: Record<string, any>;
}

async function signOuter(args: OuterArgs): Promise<string> {
  const key = await importPKCS8(signingMaterial.privateKeyPem, 'ES256');
  const data: Record<string, any> = {};
  if (args.transactionInfo) {
    data.signedTransactionInfo = await signTransactionInfo(args.transactionInfo);
  }
  if (args.renewalInfo) {
    data.signedRenewalInfo = await signTransactionInfo(args.renewalInfo);
  }
  const payload = {
    notificationType: args.notificationType,
    notificationUUID: args.notificationUUID ?? randomBytes(8).toString('hex'),
    ...(args.subtype ? { subtype: args.subtype } : {}),
    data,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'ES256', x5c: [signingMaterial.certB64Der] })
    .sign(key);
}

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

let handle: TestServerHandle;
let fs: InMemoryFirestore;

beforeAll(() => {
  signingMaterial = generateTestSigningMaterial();
});

afterEach(() => {
  __setAppleSignedDataVerifierForTests(null);
  if (ORIGINAL_APPLE_BUNDLE_ID === undefined) delete process.env.APPLE_BUNDLE_ID;
  else process.env.APPLE_BUNDLE_ID = ORIGINAL_APPLE_BUNDLE_ID;
  if (ORIGINAL_APPLE_IAP_ENVIRONMENT === undefined) {
    delete process.env.APPLE_IAP_ENVIRONMENT;
  } else {
    process.env.APPLE_IAP_ENVIRONMENT = ORIGINAL_APPLE_IAP_ENVIRONMENT;
  }
  if (ORIGINAL_APPLE_APP_ID === undefined) delete process.env.APPLE_APP_ID;
  else process.env.APPLE_APP_ID = ORIGINAL_APPLE_APP_ID;
});

describe('services/billing/appleSsn — pure helpers', () => {
  it('actionForNotificationType maps the documented types', () => {
    expect(actionForNotificationType('SUBSCRIBED')).toBe('grant');
    expect(actionForNotificationType('DID_RENEW')).toBe('grant');
    expect(actionForNotificationType('REFUND')).toBe('revoke');
    expect(actionForNotificationType('REVOKE')).toBe('revoke');
    expect(actionForNotificationType('EXPIRED')).toBe('expire');
    expect(actionForNotificationType('DID_FAIL_TO_RENEW')).toBe('expire');
    expect(actionForNotificationType('UNKNOWN_FUTURE_TYPE')).toBe('noop');
  });

  it('verifyAndDecodeAppleSsn rejects an empty payload', async () => {
    await expect(verifyAndDecodeAppleSsn('')).rejects.toBeInstanceOf(
      AppleSsnVerificationError,
    );
  });

  it('verifyAndDecodeAppleSsn rejects a JWS with no x5c header', async () => {
    // Hand-build a JWT with no x5c — should fail the header check.
    const key = await importPKCS8(signingMaterial.privateKeyPem, 'ES256');
    const jws = await new SignJWT({ notificationUUID: 'x', notificationType: 'SUBSCRIBED' })
      .setProtectedHeader({ alg: 'ES256' })
      .sign(key);
    await expect(verifyAndDecodeAppleSsn(jws)).rejects.toBeInstanceOf(
      AppleSsnVerificationError,
    );
  });

  it('rejects an attacker-signed JWS whose x5c chain is self-signed', async () => {
    process.env.APPLE_BUNDLE_ID = 'com.praeventio.guard';
    process.env.APPLE_IAP_ENVIRONMENT = 'Sandbox';
    const attackerJws = await signOuter({
      notificationType: 'SUBSCRIBED',
      notificationUUID: 'attacker-self-signed',
      transactionInfo: {
        appAccountToken: 'attacker-controlled-token',
        productId: 'praeventio_premium_monthly',
      },
    });

    await expect(verifyAndDecodeAppleSsn(attackerJws)).rejects.toBeInstanceOf(
      AppleSsnVerificationError,
    );
  });

  it('verifyAndDecodeAppleSsn flattens nested transactionInfo/renewalInfo', async () => {
    __setAppleSignedDataVerifierForTests(decodingBusinessVerifier);
    const jws = await signOuter({
      notificationType: 'SUBSCRIBED',
      notificationUUID: 'uuid-flatten-1',
      transactionInfo: {
        appAccountToken: 'aat-1',
        productId: 'praeventio_premium_monthly',
        originalTransactionId: 'orig-1',
        transactionId: 'tx-1',
        expiresDate: 1893456000000, // 2030-01-01
        type: 'AUTO_RENEWABLE',
      },
      renewalInfo: {
        autoRenewProductId: 'praeventio_premium_monthly',
        autoRenewStatus: 1,
      },
    });
    const { payload, verifiedChain } = await verifyAndDecodeAppleSsn(jws);
    expect(payload.notificationType).toBe('SUBSCRIBED');
    expect(payload.notificationUUID).toBe('uuid-flatten-1');
    expect(payload.transactionInfo?.productId).toBe('praeventio_premium_monthly');
    expect(payload.transactionInfo?.appAccountToken).toBe('aat-1');
    expect(payload.renewalInfo?.autoRenewStatus).toBe(1);
    expect(verifiedChain).toBe(true);
  });

  it('accepts an outer JWS only when it chains to the configured trusted root', async () => {
    __setAppleSignedDataVerifierForTests(officialFixtureVerifier());
    const fixture = readFileSync(FIXTURE_NOTIFICATION, 'utf8').trim();

    const verified = await verifyAndDecodeAppleSsn(fixture);

    expect(verified.verifiedChain).toBe(true);
    expect(verified.payload.notificationUUID).toBe(
      '9ad56bd2-0bc6-42e0-af24-fd996d87a1e6',
    );
  });

  it('rejects a trusted-chain notification for a different bundle id', async () => {
    __setAppleSignedDataVerifierForTests(
      officialFixtureVerifier('com.praeventio.guard'),
    );
    const fixture = readFileSync(FIXTURE_NOTIFICATION, 'utf8').trim();

    await expect(verifyAndDecodeAppleSsn(fixture)).rejects.toBeInstanceOf(
      AppleSsnVerificationError,
    );
  });

  it('rejects a trusted-chain notification from the wrong App Store environment', async () => {
    const productionVerifier = new SignedDataVerifier(
      [readFileSync(FIXTURE_ROOT)],
      false,
      Environment.PRODUCTION,
      'com.example',
      1234,
    );
    __setAppleSignedDataVerifierForTests(productionVerifier);
    const sandboxFixture = readFileSync(FIXTURE_NOTIFICATION, 'utf8').trim();

    await expect(verifyAndDecodeAppleSsn(sandboxFixture)).rejects.toBeInstanceOf(
      AppleSsnVerificationError,
    );
  });

  it('fails closed when Production is missing APPLE_APP_ID', async () => {
    __setAppleSignedDataVerifierForTests(null);
    process.env.APPLE_BUNDLE_ID = 'com.praeventio.guard';
    process.env.APPLE_IAP_ENVIRONMENT = 'Production';
    delete process.env.APPLE_APP_ID;

    await expect(verifyAndDecodeAppleSsn('attacker-controlled')).rejects.toThrow(
      /APPLE_APP_ID/,
    );
  });

  it('verifies nested transaction and renewal JWS values before exposing them', async () => {
    const realVerifier = officialFixtureVerifier();
    const signedTransactionInfo = readFileSync(FIXTURE_TRANSACTION, 'utf8').trim();
    const signedRenewalInfo = readFileSync(FIXTURE_RENEWAL, 'utf8').trim();
    __setAppleSignedDataVerifierForTests({
      async verifyAndDecodeNotification() {
        return {
          notificationUUID: 'nested-fixture',
          notificationType: 'DID_RENEW',
          data: {
            bundleId: 'com.example',
            environment: Environment.SANDBOX,
            signedTransactionInfo,
            signedRenewalInfo,
          },
        };
      },
      verifyAndDecodeTransaction: (jws) =>
        realVerifier.verifyAndDecodeTransaction(jws),
      verifyAndDecodeRenewalInfo: (jws) =>
        realVerifier.verifyAndDecodeRenewalInfo(jws),
    });

    const verified = await verifyAndDecodeAppleSsn('verified-outer-fixture');

    expect(verified.verifiedChain).toBe(true);
    expect(verified.payload.transactionInfo).toBeDefined();
    expect(verified.payload.renewalInfo).toBeDefined();
  });

  it('rejects the entire notification when a nested transaction signature is tampered', async () => {
    const realVerifier = officialFixtureVerifier();
    const signedTransactionInfo = readFileSync(FIXTURE_TRANSACTION, 'utf8').trim();
    const parts = signedTransactionInfo.split('.');
    const signature = Buffer.from(parts[2], 'base64url');
    signature[0] ^= 0xff;
    const tamperedTransaction = `${parts[0]}.${parts[1]}.${signature.toString('base64url')}`;
    __setAppleSignedDataVerifierForTests({
      async verifyAndDecodeNotification() {
        return {
          notificationUUID: 'tampered-inner',
          notificationType: 'SUBSCRIBED',
          data: {
            bundleId: 'com.example',
            environment: Environment.SANDBOX,
            signedTransactionInfo: tamperedTransaction,
          },
        };
      },
      verifyAndDecodeTransaction: (jws) =>
        realVerifier.verifyAndDecodeTransaction(jws),
      verifyAndDecodeRenewalInfo: (jws) =>
        realVerifier.verifyAndDecodeRenewalInfo(jws),
    });

    await expect(
      verifyAndDecodeAppleSsn('verified-outer-with-tampered-inner'),
    ).rejects.toBeInstanceOf(AppleSsnVerificationError);
  });

  it('rejects the entire notification when a nested renewal signature is tampered', async () => {
    const realVerifier = officialFixtureVerifier();
    const signedRenewalInfo = readFileSync(FIXTURE_RENEWAL, 'utf8').trim();
    const parts = signedRenewalInfo.split('.');
    const signature = Buffer.from(parts[2], 'base64url');
    signature[0] ^= 0xff;
    const tamperedRenewal = `${parts[0]}.${parts[1]}.${signature.toString('base64url')}`;
    __setAppleSignedDataVerifierForTests({
      async verifyAndDecodeNotification() {
        return {
          notificationUUID: 'tampered-renewal',
          notificationType: 'DID_RENEW',
          data: {
            bundleId: 'com.example',
            environment: Environment.SANDBOX,
            signedRenewalInfo: tamperedRenewal,
          },
        };
      },
      verifyAndDecodeTransaction: (jws) =>
        realVerifier.verifyAndDecodeTransaction(jws),
      verifyAndDecodeRenewalInfo: (jws) =>
        realVerifier.verifyAndDecodeRenewalInfo(jws),
    });

    await expect(
      verifyAndDecodeAppleSsn('verified-outer-with-tampered-renewal'),
    ).rejects.toBeInstanceOf(AppleSsnVerificationError);
  });

  it('applyAppleEntitlement returns noop without touching firestore for unknown types', async () => {
    fs = new InMemoryFirestore();
    const result = await applyAppleEntitlement({
      payload: {
        notificationUUID: 'u',
        notificationType: 'UNKNOWN_FUTURE_TYPE',
      },
      db: fs as any,
    });
    expect(result.action).toBe('noop');
    expect(result.userId).toBeNull();
  });
});

describe('POST /api/billing/webhook/apple', () => {
  beforeEach(() => {
    __setAppleSignedDataVerifierForTests(decodingBusinessVerifier);
    fs = new InMemoryFirestore();
    handle = buildTestServer({ firestore: fs });
  });

  it('returns 400 when signedPayload is missing', async () => {
    const res = await request(handle.app).post('/api/billing/webhook/apple').send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 on a bad signature (tampered JWS)', async () => {
    __setAppleSignedDataVerifierForTests(null);
    process.env.APPLE_BUNDLE_ID = 'com.praeventio.guard';
    process.env.APPLE_IAP_ENVIRONMENT = 'Sandbox';
    const jws = await signOuter({
      notificationType: 'SUBSCRIBED',
      transactionInfo: { appAccountToken: 'a' },
    });
    // Flip a byte in the signature segment to invalidate it.
    const parts = jws.split('.');
    const sig = Buffer.from(parts[2], 'base64url');
    sig[0] ^= 0xff;
    const tampered = `${parts[0]}.${parts[1]}.${sig.toString('base64url')}`;
    const res = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: tampered });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_signature');
    expect(
      [...fs.store.keys()].filter(
        (key) =>
          key.startsWith('processed_apple_ssn/') ||
          key.startsWith('apple_ssn_attempts/') ||
          key.startsWith('users/'),
      ),
    ).toHaveLength(0);
  });

  it('SUBSCRIBED activates entitlement on the matched user', async () => {
    fs.store.set('users/uid-A', {
      email: 'a@test.com',
      subscription: { appleAppAccountToken: 'aat-A' },
    });
    const expiresMs = Date.parse('2030-01-01T00:00:00Z');
    const jws = await signOuter({
      notificationType: 'SUBSCRIBED',
      notificationUUID: 'uuid-subscribed-1',
      transactionInfo: {
        appAccountToken: 'aat-A',
        productId: 'praeventio_premium_monthly',
        originalTransactionId: 'orig-A',
        expiresDate: expiresMs,
      },
    });
    const res = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: jws });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('grant');
    const user = fs.store.get('users/uid-A');
    expect(user.subscription.status).toBe('active');
    expect(user.subscription.expiryDate).toBe(new Date(expiresMs).toISOString());
    expect(user.subscription.provider).toBe('app-store');
    expect(user.subscription.paymentMethod).toBe('app-store');
    expect(user.subscription.appleOriginalTransactionId).toBe('orig-A');
    // Idempotency lock landed.
    expect(fs.store.get('processed_apple_ssn/uuid-subscribed-1')?.status).toBe('done');
    // Audit row truthfully records full-chain verification.
    const auditKey = [...fs.store.keys()].find((k) =>
      k.startsWith('apple_ssn_attempts/'),
    );
    expect(auditKey).toBeDefined();
    expect(fs.store.get(auditKey!).verified_chain).toBe(true);
    expect(fs.store.get(auditKey!).action).toBe('grant');
    // A grant stamps the purchased cycle on the audit row (observability).
    expect(fs.store.get(auditKey!).cycle).toBe('monthly');
  });

  it('DID_RENEW updates expiryDate on the matched user', async () => {
    fs.store.set('users/uid-B', {
      subscription: {
        appleAppAccountToken: 'aat-B',
        status: 'active',
        expiryDate: '2025-01-01T00:00:00.000Z',
      },
    });
    const newExpiryMs = Date.parse('2026-01-01T00:00:00Z');
    const jws = await signOuter({
      notificationType: 'DID_RENEW',
      notificationUUID: 'uuid-renew-1',
      transactionInfo: {
        appAccountToken: 'aat-B',
        productId: 'praeventio_premium_monthly',
        originalTransactionId: 'orig-B',
        expiresDate: newExpiryMs,
      },
    });
    const res = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: jws });
    expect(res.status).toBe(200);
    const user = fs.store.get('users/uid-B');
    expect(user.subscription.status).toBe('active');
    expect(user.subscription.expiryDate).toBe(new Date(newExpiryMs).toISOString());
  });

  it('DID_FAIL_TO_RENEW preserves access during an explicit Apple grace period', async () => {
    fs.store.set('users/uid-grace', {
      subscription: { appleAppAccountToken: 'aat-grace', planId: 'oro' },
    });
    const graceEndMs = Date.parse('2030-02-01T00:00:00Z');
    const jws = await signOuter({
      notificationType: 'DID_FAIL_TO_RENEW',
      subtype: 'GRACE_PERIOD',
      notificationUUID: 'uuid-grace-1',
      transactionInfo: {
        appAccountToken: 'aat-grace',
        originalTransactionId: 'orig-grace',
        expiresDate: Date.parse('2030-01-01T00:00:00Z'),
      },
      renewalInfo: { gracePeriodExpiresDate: graceEndMs },
    });
    const res = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: jws });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('grace');
    const subscription = fs.store.get('users/uid-grace').subscription;
    expect(subscription.status).toBe('grace_period');
    expect(subscription.gracePeriodEnd).toBe(new Date(graceEndMs).toISOString());
  });

  it('REFUND revokes the entitlement', async () => {
    fs.store.set('users/uid-C', {
      subscription: {
        appleAppAccountToken: 'aat-C',
        status: 'active',
      },
    });
    const jws = await signOuter({
      notificationType: 'REFUND',
      notificationUUID: 'uuid-refund-1',
      transactionInfo: {
        appAccountToken: 'aat-C',
        productId: 'praeventio_premium_monthly',
        originalTransactionId: 'orig-C',
      },
    });
    const res = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: jws });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('revoke');
    expect(fs.store.get('users/uid-C').subscription.status).toBe('revoked');
  });

  it('idempotency: redelivered notificationUUID is a no-op (still 200)', async () => {
    fs.store.set('users/uid-D', {
      subscription: { appleAppAccountToken: 'aat-D' },
    });
    const jws = await signOuter({
      notificationType: 'SUBSCRIBED',
      notificationUUID: 'uuid-dup-1',
      transactionInfo: {
        appAccountToken: 'aat-D',
        productId: 'praeventio_premium_monthly',
        originalTransactionId: 'orig-D',
      },
    });
    const first = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: jws });
    expect(first.status).toBe(200);
    // Mutate the user doc — if the second call re-applies, we'll see
    // it overwrite this sentinel.
    fs.store.set('users/uid-D', {
      subscription: {
        appleAppAccountToken: 'aat-D',
        status: 'manually-overridden',
      },
    });
    const second = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: jws });
    expect(second.status).toBe(200);
    expect(second.body.replay).toBe(true);
    // Sentinel preserved — second delivery did NOT re-apply.
    expect(fs.store.get('users/uid-D').subscription.status).toBe(
      'manually-overridden',
    );
    // Exactly one audit row written across both deliveries.
    const auditRows = [...fs.store.keys()].filter((k) =>
      k.startsWith('apple_ssn_attempts/'),
    );
    expect(auditRows).toHaveLength(1);
  });

  it('unmatched user → 200, audit row with matchedUserId=null, no user mutation', async () => {
    const jws = await signOuter({
      notificationType: 'SUBSCRIBED',
      notificationUUID: 'uuid-no-match-1',
      transactionInfo: {
        appAccountToken: 'aat-orphan',
        productId: 'praeventio_premium_monthly',
        originalTransactionId: 'orig-orphan',
      },
    });
    const res = await request(handle.app)
      .post('/api/billing/webhook/apple')
      .send({ signedPayload: jws });
    expect(res.status).toBe(200);
    const auditKey = [...fs.store.keys()].find((k) =>
      k.startsWith('apple_ssn_attempts/'),
    );
    expect(auditKey).toBeDefined();
    const audit = fs.store.get(auditKey!);
    expect(audit.matchedUserId).toBeNull();
    expect(audit.action).toBe('grant');
  });
});
