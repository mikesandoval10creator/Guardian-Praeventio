// Praeventio Guard — Round 18 R2 (deferred from R17): MercadoPago IPN handler tests.
//
// MP delivers payment notifications to /api/billing/webhook/mercadopago. This
// file unit-tests the two pure entry points the route handler calls:
//
//   1. verifyMercadoPagoIpnSignature(body, signature, secret) — HMAC-SHA256.
//      MP signature scheme in production is `ts=<ts>,v1=<hex>` with a manifest
//      derived from id+request-id+ts. For round-18 we ship the simpler
//      "raw HMAC over body" variant — same shape as R1 R17 telemetry. Once
//      R19 ships the unified canonical-body fix, both telemetry and IPN will
//      switch to the manifest format together.
//
//   2. processMercadoPagoIpn(body) — fetches the payment via the
//      mercadoPagoAdapter, maps MP status to invoice outcome, updates the
//      invoice doc, audits, and is idempotent via processed_mp_ipn/{paymentId}.
//
// Mocks:
//   • `mercadoPagoAdapter` is mocked to control getPayment without real network.
//   • `firebase-admin` is mocked with a minimal in-memory shape.
//
// We run these tests with `vi.hoisted` so the mock object is shared between
// the vi.mock factory and the test body.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

// ───────────────────────────────────────────────────────────────────────────
// Hoisted mocks — shared between vi.mock factories and tests.
// ───────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => {
  const getPaymentMock = vi.fn();
  type StoreEntry = { data: any };
  const store = new Map<string, StoreEntry>();
  const getSpy = vi.fn();
  const setSpy = vi.fn();
  const updateSpy = vi.fn();
  const addSpy = vi.fn();

  const firestoreFactory = () => ({
    collection: (col: string) => ({
      doc: (id: string) => {
        const path = `${col}/${id}`;
        return {
          get: async () => {
            getSpy(path);
            const entry = store.get(path);
            return {
              exists: !!entry,
              data: () => entry?.data,
            };
          },
          set: async (data: any, opts?: { merge?: boolean }) => {
            setSpy(path, data, opts);
            const prev = store.get(path);
            if (opts?.merge && prev?.data) {
              store.set(path, { data: { ...prev.data, ...data } });
            } else {
              store.set(path, { data: { ...data } });
            }
          },
          update: async (data: any) => {
            updateSpy(path, data);
            const prev = store.get(path);
            if (!prev) throw new Error('cannot update missing doc');
            store.set(path, { data: { ...prev.data, ...data } });
          },
        };
      },
      add: async (data: any) => {
        addSpy(col, data);
        const id = `auto_${Math.random().toString(36).slice(2, 10)}`;
        store.set(`${col}/${id}`, { data: { ...data } });
        return { id };
      },
    }),
  });

  return { getPaymentMock, store, getSpy, setSpy, updateSpy, addSpy, firestoreFactory };
});

vi.mock('./mercadoPagoAdapter.js', () => ({
  mercadoPagoAdapter: {
    isConfigured: () => true,
    createPreference: vi.fn(),
    getPayment: mocks.getPaymentMock,
  },
  MercadoPagoAdapterError: class MercadoPagoAdapterError extends Error {
    method: string;
    constructor(method: string, cause: unknown) {
      super(`MercadoPagoAdapter.${method}() failed`);
      this.method = method;
    }
  },
}));

vi.mock('firebase-admin', () => {
  const factory = mocks.firestoreFactory;
  const FieldValue = {
    serverTimestamp: () => ({ __ts: true }),
  };
  const fs = factory();
  return {
    default: {
      firestore: Object.assign(() => fs, { FieldValue }),
    },
    firestore: Object.assign(() => fs, { FieldValue }),
  };
});

// Import AFTER vi.mock declarations so the module under test sees the stubs.
import {
  verifyMercadoPagoIpnSignature,
  verifyMercadoPagoIpnSignatureFromBody,
  verifyMercadoPagoIpnOidc,
  processMercadoPagoIpn,
} from './mercadoPagoIpn.js';
import { canonicalize } from '../../server/middleware/canonicalBody.js';
import {
  _resetMpJwksCacheForTests,
  _setJwksFetcherForTests,
} from './mpJwksCache.js';

beforeEach(() => {
  mocks.getPaymentMock.mockReset();
  mocks.store.clear();
  mocks.getSpy.mockReset();
  mocks.setSpy.mockReset();
  mocks.updateSpy.mockReset();
  mocks.addSpy.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ───────────────────────────────────────────────────────────────────────────
// Signature verify tests
// ───────────────────────────────────────────────────────────────────────────

describe('verifyMercadoPagoIpnSignature', () => {
  const SECRET = 'mp-ipn-secret-test';

  function sign(body: string): string {
    const hex = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    return `sha256=${hex}`;
  }

  it('accepts a valid signature', () => {
    const body = JSON.stringify({ type: 'payment', data: { id: '123' } });
    expect(verifyMercadoPagoIpnSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a tampered signature', () => {
    const body = JSON.stringify({ type: 'payment', data: { id: '123' } });
    const sig = sign(body);
    // Flip last hex char (still well-formed length)
    const tampered = sig.slice(0, -1) + (sig.slice(-1) === '0' ? '1' : '0');
    expect(verifyMercadoPagoIpnSignature(body, tampered, SECRET)).toBe(false);
  });

  it('rejects a missing/empty signature', () => {
    const body = JSON.stringify({ type: 'payment', data: { id: '123' } });
    expect(verifyMercadoPagoIpnSignature(body, '', SECRET)).toBe(false);
  });

  it('rejects a malformed signature header (no sha256= prefix)', () => {
    const body = JSON.stringify({ type: 'payment', data: { id: '123' } });
    const hex = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    // Missing the "sha256=" prefix → must reject.
    expect(verifyMercadoPagoIpnSignature(body, hex, SECRET)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Round 18 R6 — canonical-JSON variant.
// ───────────────────────────────────────────────────────────────────────────

describe('verifyMercadoPagoIpnSignatureFromBody (RFC 8785 canonical)', () => {
  const SECRET = 'mp-ipn-secret-test';
  const ORIGINAL_FALLBACK = process.env.LEGACY_HMAC_FALLBACK;

  function signCanonical(parsed: unknown): string {
    const hex = crypto
      .createHmac('sha256', SECRET)
      .update(canonicalize(parsed ?? {}))
      .digest('hex');
    return `sha256=${hex}`;
  }
  function signLegacy(parsed: unknown): string {
    const hex = crypto
      .createHmac('sha256', SECRET)
      .update(JSON.stringify(parsed ?? {}))
      .digest('hex');
    return `sha256=${hex}`;
  }

  beforeEach(() => {
    delete process.env.LEGACY_HMAC_FALLBACK;
  });
  afterEach(() => {
    if (ORIGINAL_FALLBACK === undefined) delete process.env.LEGACY_HMAC_FALLBACK;
    else process.env.LEGACY_HMAC_FALLBACK = ORIGINAL_FALLBACK;
  });

  it('accepts a body signed with the canonical-JSON form', () => {
    const body = { type: 'payment', data: { id: '123' } };
    expect(verifyMercadoPagoIpnSignatureFromBody(body, signCanonical(body), SECRET)).toBe(true);
  });

  it('accepts the same logical body regardless of producer key order', () => {
    // Two semantically-identical bodies with different key insertion orders
    // produce the SAME canonical string and thus the SAME HMAC.
    const orderA = { type: 'payment', data: { id: '123' } };
    const orderB = { data: { id: '123' }, type: 'payment' };
    const sig = signCanonical(orderA);
    expect(verifyMercadoPagoIpnSignatureFromBody(orderB, sig, SECRET)).toBe(true);
  });

  it('rejects a body whose HMAC was computed over JSON.stringify (non-canonical, fallback OFF)', () => {
    // Construct a body where JSON.stringify(body) !== canonicalize(body).
    // {b:2, a:1} stringifies as {"b":2,"a":1} but canonicalises to
    // {"a":1,"b":2} — different bytes, different HMAC.
    const body = { b: 2, a: 1 };
    expect(JSON.stringify(body)).not.toBe(canonicalize(body));
    expect(verifyMercadoPagoIpnSignatureFromBody(body, signLegacy(body), SECRET)).toBe(false);
  });

  it('accepts a JSON.stringify-signed body when LEGACY_HMAC_FALLBACK=1', () => {
    process.env.LEGACY_HMAC_FALLBACK = '1';
    const body = { b: 2, a: 1 };
    expect(verifyMercadoPagoIpnSignatureFromBody(body, signLegacy(body), SECRET)).toBe(true);
  });

  it('rejects a tampered body even with LEGACY_HMAC_FALLBACK=1', () => {
    process.env.LEGACY_HMAC_FALLBACK = '1';
    const original = { type: 'payment', data: { id: '123' } };
    const tampered = { type: 'payment', data: { id: '999' } };
    // Sig was over original — verifying tampered must fail under both paths.
    expect(verifyMercadoPagoIpnSignatureFromBody(tampered, signCanonical(original), SECRET)).toBe(
      false,
    );
  });

  it('rejects an empty signature regardless of body', () => {
    expect(verifyMercadoPagoIpnSignatureFromBody({ type: 'payment' }, '', SECRET)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// processMercadoPagoIpn tests
// ───────────────────────────────────────────────────────────────────────────

describe('processMercadoPagoIpn', () => {
  it('marks invoice as paid for status=approved', async () => {
    const invoiceId = 'inv_mp_123_aaa';
    mocks.store.set(`invoices/${invoiceId}`, {
      data: {
        id: invoiceId,
        status: 'pending-payment',
        paymentMethod: 'mercadopago',
        totals: { total: 100, currency: 'PEN' },
      },
    });
    mocks.getPaymentMock.mockResolvedValueOnce({
      status: 'approved',
      status_detail: 'accredited',
      external_reference: invoiceId,
      amount: 100,
      currency: 'PEN',
    });

    const result = await processMercadoPagoIpn({ type: 'payment', data: { id: 'pay_42' } });

    expect(result.outcome).toBe('paid');
    expect(result.invoiceId).toBe(invoiceId);
    expect(mocks.store.get(`invoices/${invoiceId}`)?.data.status).toBe('paid');
    // Audit log row was added.
    const auditCalls = mocks.addSpy.mock.calls.filter(([col]) => col === 'audit_logs');
    expect(auditCalls.length).toBe(1);
    expect(auditCalls[0][1]).toMatchObject({
      action: 'billing.mercadopago.ipn.processed',
      module: 'billing',
      details: { paymentId: 'pay_42', outcome: 'paid' },
    });
  });

  it('marks invoice as rejected for status=rejected', async () => {
    const invoiceId = 'inv_mp_123_bbb';
    mocks.store.set(`invoices/${invoiceId}`, {
      data: { id: invoiceId, status: 'pending-payment', paymentMethod: 'mercadopago' },
    });
    mocks.getPaymentMock.mockResolvedValueOnce({
      status: 'rejected',
      status_detail: 'cc_rejected_other_reason',
      external_reference: invoiceId,
    });

    const result = await processMercadoPagoIpn({ type: 'payment', data: { id: 'pay_43' } });
    expect(result.outcome).toBe('rejected');
    expect(mocks.store.get(`invoices/${invoiceId}`)?.data.status).toBe('rejected');
  });

  it('keeps invoice pending for status=pending|in_process', async () => {
    const invoiceId = 'inv_mp_123_ccc';
    mocks.store.set(`invoices/${invoiceId}`, {
      data: { id: invoiceId, status: 'pending-payment', paymentMethod: 'mercadopago' },
    });
    mocks.getPaymentMock.mockResolvedValueOnce({
      status: 'pending',
      status_detail: 'pending_waiting_payment',
      external_reference: invoiceId,
    });

    const result = await processMercadoPagoIpn({ type: 'payment', data: { id: 'pay_44' } });
    expect(result.outcome).toBe('pending');
    // Invoice doc still pending-payment.
    expect(mocks.store.get(`invoices/${invoiceId}`)?.data.status).toBe('pending-payment');
  });

  it('is idempotent on replay (second call does NOT re-process)', async () => {
    const invoiceId = 'inv_mp_123_ddd';
    mocks.store.set(`invoices/${invoiceId}`, {
      data: { id: invoiceId, status: 'pending-payment', paymentMethod: 'mercadopago' },
    });
    mocks.getPaymentMock.mockResolvedValue({
      status: 'approved',
      status_detail: 'accredited',
      external_reference: invoiceId,
    });

    const r1 = await processMercadoPagoIpn({ type: 'payment', data: { id: 'pay_dup' } });
    const r2 = await processMercadoPagoIpn({ type: 'payment', data: { id: 'pay_dup' } });

    expect(r1.outcome).toBe('paid');
    expect(r2.outcome).toBe('paid'); // replayed via processed_mp_ipn doc
    // getPayment called ONLY ONCE — second call short-circuits via idempotency.
    expect(mocks.getPaymentMock).toHaveBeenCalledTimes(1);
    // Only one audit log row.
    const auditCalls = mocks.addSpy.mock.calls.filter(([col]) => col === 'audit_logs');
    expect(auditCalls.length).toBe(1);
  });

  it('rejects non-payment notification types (returns pending without fetching)', async () => {
    // MP also delivers `merchant_order` and other types — we only care about
    // `payment`. Anything else short-circuits to {outcome:'pending'} without
    // touching the MP API or invoice doc.
    const result = await processMercadoPagoIpn({
      type: 'merchant_order',
      data: { id: 'mo_99' },
    });
    expect(result.outcome).toBe('pending');
    expect(result.invoiceId).toBe('');
    expect(mocks.getPaymentMock).not.toHaveBeenCalled();
  });

  it('throws when MP API call fails', async () => {
    mocks.getPaymentMock.mockRejectedValueOnce(new Error('MP 503 service unavailable'));

    await expect(
      processMercadoPagoIpn({ type: 'payment', data: { id: 'pay_err' } }),
    ).rejects.toThrow(/MP/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Round 19 (A9) — OIDC verify tests
//
// Strategy: generate an RSA keypair at module load, install it into the JWKS
// cache via the test-only fetcher seam, sign a real RS256 JWT against it,
// and round-trip through `verifyMercadoPagoIpnOidc`. This avoids depending
// on a transitive `jose` package while still exercising the full crypto
// path (sign + verify against the same JWK).
// ───────────────────────────────────────────────────────────────────────────

describe('verifyMercadoPagoIpnOidc', () => {
  const ISSUER = 'https://api.test.mercadopago.com';
  const AUDIENCE = 'praeventio-mp-client-id';
  const KID = 'mp-oidc-test-kid';

  // Generate one keypair for the whole describe block — keygen is slow.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string; kty: string };
  const jwks = {
    keys: [{ kty: 'RSA', kid: KID, alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }],
  };

  function b64url(buf: Buffer | string): string {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8');
    return b.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
  function signJwt(payload: Record<string, unknown>, opts?: { alg?: string; kid?: string | undefined }): string {
    const header = { alg: opts?.alg ?? 'RS256', typ: 'JWT', ...(opts?.kid !== undefined ? { kid: opts.kid } : { kid: KID }) };
    const headerB64 = b64url(JSON.stringify(header));
    const payloadB64 = b64url(JSON.stringify(payload));
    const signed = `${headerB64}.${payloadB64}`;
    const sig = crypto.sign('sha256', Buffer.from(signed, 'utf8'), privateKey);
    return `${signed}.${b64url(sig)}`;
  }

  beforeEach(() => {
    _resetMpJwksCacheForTests();
    _setJwksFetcherForTests(async () => ({
      ok: true,
      status: 200,
      json: async () => jwks,
    }));
    process.env.MP_OIDC_ISSUER = ISSUER;
    process.env.MP_OIDC_AUDIENCE = AUDIENCE;
  });
  afterEach(() => {
    _setJwksFetcherForTests(null);
    delete process.env.MP_OIDC_ISSUER;
    delete process.env.MP_OIDC_AUDIENCE;
  });

  it('rejects a missing or non-Bearer Authorization header', async () => {
    expect((await verifyMercadoPagoIpnOidc('')).valid).toBe(false);
    expect((await verifyMercadoPagoIpnOidc(undefined)).valid).toBe(false);
    expect((await verifyMercadoPagoIpnOidc('Basic abc123')).valid).toBe(false);
  });

  it('accepts a valid RS256 JWT (signature, iss, aud, exp all OK)', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const jwt = signJwt({ iss: ISSUER, aud: AUDIENCE, exp, payer: { email: 'buyer@example.cl' } });
    const result = await verifyMercadoPagoIpnOidc(`Bearer ${jwt}`);
    expect(result.valid).toBe(true);
    expect(result.payerEmail).toBe('buyer@example.cl');
    expect(result.expiresAt).toBe(exp);
  });

  it('rejects an expired JWT', async () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    const jwt = signJwt({ iss: ISSUER, aud: AUDIENCE, exp });
    const result = await verifyMercadoPagoIpnOidc(`Bearer ${jwt}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects a JWT with the wrong issuer', async () => {
    const jwt = signJwt({
      iss: 'https://evil.example.com',
      aud: AUDIENCE,
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const result = await verifyMercadoPagoIpnOidc(`Bearer ${jwt}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('issuer_mismatch');
  });

  it('rejects a JWT with the wrong audience', async () => {
    const jwt = signJwt({ iss: ISSUER, aud: 'someone-else', exp: Math.floor(Date.now() / 1000) + 600 });
    const result = await verifyMercadoPagoIpnOidc(`Bearer ${jwt}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('audience_mismatch');
  });

  it('rejects a JWT with a tampered signature', async () => {
    const jwt = signJwt({ iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 600 });
    // Flip one byte in the signature segment.
    const segs = jwt.split('.');
    const sigBytes = Buffer.from(segs[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    sigBytes[0] = sigBytes[0] ^ 0xff;
    const tampered = `${segs[0]}.${segs[1]}.${b64url(sigBytes)}`;
    const result = await verifyMercadoPagoIpnOidc(`Bearer ${tampered}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('rejects an alg=none token even with a real-looking signature', async () => {
    // Hand-roll a {"alg":"none"} JWT — must NOT pass even if the reduced
    // signature happens to match anything. Our verifier rejects on alg
    // before reaching signature checks.
    const headerB64 = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payloadB64 = b64url(
      JSON.stringify({ iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 600 }),
    );
    const jwt = `${headerB64}.${payloadB64}.`;
    const result = await verifyMercadoPagoIpnOidc(`Bearer ${jwt}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unsupported_alg');
  });

  it('refreshes the JWKS once if the kid is unknown, then succeeds', async () => {
    // Seed the cache with a JWKS that has a different kid, then arrange
    // the next fetch to return the real jwks. The verifier should call
    // `getJwks(true)` once after the first miss.
    const STALE_JWKS = { keys: [{ kty: 'RSA', kid: 'old-kid', n: 'a', e: 'AQAB' }] };
    let call = 0;
    _setJwksFetcherForTests(async () => ({
      ok: true,
      status: 200,
      json: async () => (++call === 1 ? STALE_JWKS : jwks),
    }));
    _resetMpJwksCacheForTests();

    const exp = Math.floor(Date.now() / 1000) + 600;
    const jwt = signJwt({ iss: ISSUER, aud: AUDIENCE, exp });
    const result = await verifyMercadoPagoIpnOidc(`Bearer ${jwt}`);
    expect(result.valid).toBe(true);
    expect(call).toBe(2); // initial + force-refresh
  });

  it('fails closed when MP_OIDC_AUDIENCE is unset', async () => {
    delete process.env.MP_OIDC_AUDIENCE;
    const jwt = signJwt({ iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 600 });
    const result = await verifyMercadoPagoIpnOidc(`Bearer ${jwt}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('audience_not_configured');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Round 20 (A5) — jose-backed verifier behavioural tests.
//
// Mirrors the R19 OIDC harness (in-process keypair + injected JWKS fetcher)
// but asserts behaviours specific to the jose swap: alg=none rejection
// goes through jose's `algorithms: ['RS256']` allow-list, signature
// verification uses jose's timing-safe RSASSA-PKCS1-v1_5, exp is enforced
// by jose's `JWTExpired`, and the `MP_OIDC_CLOCK_TOLERANCE_SEC` env knob
// is plumbed through to jose's `clockTolerance` option.
// ───────────────────────────────────────────────────────────────────────────

describe('verifyMercadoPagoIpnOidc — jose-backed (R20 A5)', () => {
  const ISSUER = 'https://api.test.mercadopago.com';
  const AUDIENCE = 'praeventio-mp-r20-client';
  const KID = 'mp-oidc-r20-kid';

  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: 'jwk' }) as { n: string; e: string; kty: string };
  const jwks = {
    keys: [{ kty: 'RSA', kid: KID, alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }],
  };

  function b64url(buf: Buffer | string): string {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8');
    return b.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  }
  function signRs256(payload: Record<string, unknown>): string {
    const headerB64 = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: KID }));
    const payloadB64 = b64url(JSON.stringify(payload));
    const signed = `${headerB64}.${payloadB64}`;
    const sig = crypto.sign('sha256', Buffer.from(signed, 'utf8'), privateKey);
    return `${signed}.${b64url(sig)}`;
  }

  beforeEach(() => {
    _resetMpJwksCacheForTests();
    _setJwksFetcherForTests(async () => ({
      ok: true,
      status: 200,
      json: async () => jwks,
    }));
    process.env.MP_OIDC_ISSUER = ISSUER;
    process.env.MP_OIDC_AUDIENCE = AUDIENCE;
  });
  afterEach(() => {
    _setJwksFetcherForTests(null);
    delete process.env.MP_OIDC_ISSUER;
    delete process.env.MP_OIDC_AUDIENCE;
    delete process.env.MP_OIDC_CLOCK_TOLERANCE_SEC;
  });

  it('jose.jwtVerify rejects alg=none even when no signature is provided', async () => {
    // Hand-roll a {"alg":"none"} JWT with an empty signature segment. Under
    // the in-house verifier we early-rejected on the alg check; under jose
    // it's the `algorithms: ['RS256']` allow-list inside jwtVerify that
    // surfaces JOSEAlgNotAllowed → 'unsupported_alg'.
    const headerB64 = b64url(JSON.stringify({ alg: 'none', typ: 'JWT', kid: KID }));
    const payloadB64 = b64url(
      JSON.stringify({ iss: ISSUER, aud: AUDIENCE, exp: Math.floor(Date.now() / 1000) + 600 }),
    );
    const token = `${headerB64}.${payloadB64}.`;
    const result = await verifyMercadoPagoIpnOidc(`Bearer ${token}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('unsupported_alg');
  });

  it('jose.jwtVerify rejects a token with a tampered signature', async () => {
    // Sign legitimately, then flip every byte of the signature so the
    // tampered token still parses but fails RSASSA-PKCS1-v1_5 verification.
    const exp = Math.floor(Date.now() / 1000) + 600;
    const token = signRs256({ iss: ISSUER, aud: AUDIENCE, exp });
    const segs = token.split('.');
    const sigBytes = Buffer.from(segs[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    for (let i = 0; i < sigBytes.length; i++) sigBytes[i] = sigBytes[i] ^ 0xff;
    const tampered = `${segs[0]}.${segs[1]}.${b64url(sigBytes)}`;

    const result = await verifyMercadoPagoIpnOidc(`Bearer ${tampered}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('signature_mismatch');
  });

  it('jose.jwtVerify rejects an expired exp claim (no clock tolerance)', async () => {
    // Sign a token with exp 60s in the past. With strict clockTolerance=0
    // (the default), jose's JWTExpired must fire → 'expired' reason.
    const exp = Math.floor(Date.now() / 1000) - 60;
    const token = signRs256({ iss: ISSUER, aud: AUDIENCE, exp });
    const result = await verifyMercadoPagoIpnOidc(`Bearer ${token}`);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
    expect(result.expiresAt).toBe(exp);
  });

  it('respects MP_OIDC_CLOCK_TOLERANCE_SEC for borderline-expired tokens', async () => {
    // exp 30s in the past, tolerance=120s → jose accepts; tolerance=10s → rejects.
    const exp = Math.floor(Date.now() / 1000) - 30;
    const token = signRs256({ iss: ISSUER, aud: AUDIENCE, exp });

    process.env.MP_OIDC_CLOCK_TOLERANCE_SEC = '120';
    const accepted = await verifyMercadoPagoIpnOidc(`Bearer ${token}`);
    expect(accepted.valid).toBe(true);
    expect(accepted.expiresAt).toBe(exp);

    process.env.MP_OIDC_CLOCK_TOLERANCE_SEC = '10';
    const rejected = await verifyMercadoPagoIpnOidc(`Bearer ${token}`);
    expect(rejected.valid).toBe(false);
    expect(rejected.reason).toBe('expired');
  });
});
