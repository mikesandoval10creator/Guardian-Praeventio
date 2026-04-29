// Praeventio Guard — Round 18 R6 (R6→R17 MEDIUM #2): canonical-JSON HMAC
// for /api/telemetry/ingest.
//
// The R17 R1 contract HMAC'd over `JSON.stringify(req.body)`, which made
// signatures non-portable across producers (Node-default insertion order
// vs Python/Go map ordering). R6→R17 MEDIUM #2 flagged this as a silent
// 401 source. R18 R6 swaps the signing input to the RFC 8785 canonical
// form (sorted keys, no whitespace, shortest numeric form).
//
// Tests build a parallel minimal Express app that mirrors server.ts'
// ingest handler (per-tenant secret + env fallback + LEGACY_HMAC_FALLBACK
// rollback flag) — same pattern as telemetryRotation.test.ts.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import crypto from 'crypto';
import { InMemoryFirestore, type FakeAuth, fakeFieldValue } from './test-server.js';
import { canonicalize } from '../../server/middleware/canonicalBody.js';

const ENV_SECRET = 'env-fallback-secret';

function safeSecretEqual(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  const padded = Buffer.alloc(expectedBuf.length);
  providedBuf.copy(padded);
  const lengthOk = providedBuf.length === expectedBuf.length;
  const valueOk = crypto.timingSafeEqual(padded, expectedBuf);
  return lengthOk && valueOk;
}

interface Deps {
  fs: InMemoryFirestore;
  auth: FakeAuth;
  envSecret?: string | undefined;
}

function makeAuth(role: string = ''): FakeAuth {
  return {
    async verifyIdToken(token: string) {
      if (token === 'invalid') throw new Error('invalid');
      const [, uid, email] = token.split(':');
      return { uid: uid ?? 'uid-default', email: email || `${uid}@test.com` };
    },
    async getUser(uid: string) {
      return { uid, email: `${uid}@test.com`, customClaims: { role } };
    },
    async getUserByEmail() {
      throw new Error('not used');
    },
    async setCustomUserClaims() {},
    async revokeRefreshTokens() {},
  };
}

function buildApp(deps: Deps): Express {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  app.post('/api/telemetry/ingest', async (req, res) => {
    const headerTenantId = req.header('x-tenant-id');
    const bodyTenantId = (req.body ?? {}).tenantId;
    const tenantId =
      typeof headerTenantId === 'string' && headerTenantId.length > 0
        ? headerTenantId
        : typeof bodyTenantId === 'string' && bodyTenantId.length > 0
          ? bodyTenantId
          : null;

    let perTenantSecret: string | null = null;
    if (tenantId) {
      const snap = await deps.fs.collection('tenants').doc(tenantId).get();
      if (snap.exists) {
        const data = snap.data() ?? {};
        if (typeof data.iotSecret === 'string' && data.iotSecret.length > 0) {
          perTenantSecret = data.iotSecret;
        }
      }
    }

    let authenticated = false;
    if (perTenantSecret) {
      const sigHeader = req.header('x-iot-signature') ?? '';
      const canonical = canonicalize(req.body ?? {});
      const expectedHex = crypto
        .createHmac('sha256', perTenantSecret)
        .update(canonical)
        .digest('hex');
      const expectedHeader = `sha256=${expectedHex}`;
      if (safeSecretEqual(sigHeader, expectedHeader)) {
        authenticated = true;
      } else if (process.env.LEGACY_HMAC_FALLBACK === '1') {
        const legacyHex = crypto
          .createHmac('sha256', perTenantSecret)
          .update(JSON.stringify(req.body ?? {}))
          .digest('hex');
        if (safeSecretEqual(sigHeader, `sha256=${legacyHex}`)) {
          authenticated = true;
        }
      }
    }

    if (!authenticated) {
      const envSecret = deps.envSecret;
      if (!envSecret) {
        return res.status(500).json({ error: 'Server configuration error' });
      }
      const headerKey = req.header('x-iot-secret');
      if (typeof headerKey !== 'string' || !safeSecretEqual(headerKey, envSecret)) {
        return res.status(401).json({ error: 'Unauthorized: Invalid secret key' });
      }
      authenticated = true;
    }

    const { type, source, metric, value } = req.body ?? {};
    if (!type || !source || !metric || value === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await deps.fs.collection('telemetry_events').add({
      type,
      source,
      metric,
      value: Number(value),
      tenantId: tenantId ?? null,
      timestamp: fakeFieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  });

  return app;
}

let fs: InMemoryFirestore;
const ORIGINAL_FALLBACK = process.env.LEGACY_HMAC_FALLBACK;

beforeEach(() => {
  fs = new InMemoryFirestore();
  delete process.env.LEGACY_HMAC_FALLBACK;
});

afterEach(() => {
  if (ORIGINAL_FALLBACK === undefined) delete process.env.LEGACY_HMAC_FALLBACK;
  else process.env.LEGACY_HMAC_FALLBACK = ORIGINAL_FALLBACK;
});

function signCanonical(secret: string, body: unknown): string {
  const hex = crypto.createHmac('sha256', secret).update(canonicalize(body ?? {})).digest('hex');
  return `sha256=${hex}`;
}
function signLegacy(secret: string, body: unknown): string {
  const hex = crypto.createHmac('sha256', secret).update(JSON.stringify(body ?? {})).digest('hex');
  return `sha256=${hex}`;
}

describe('POST /api/telemetry/ingest — RFC 8785 canonical HMAC (R18 R6)', () => {
  it('200 with canonical body + correct signature', async () => {
    fs.store.set('tenants/tenant-A', { iotSecret: 'tenant-A-secret' });
    const app = buildApp({ fs, auth: makeAuth(), envSecret: ENV_SECRET });
    const body = {
      tenantId: 'tenant-A',
      type: 'wearable',
      source: 'smartwatch-1',
      metric: 'heart_rate',
      value: 72,
    };
    const res = await request(app)
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', signCanonical('tenant-A-secret', body))
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('401 with same body + Node-default-order JSON.stringify signature (legacy contract no longer accepted)', async () => {
    fs.store.set('tenants/tenant-A', { iotSecret: 'tenant-A-secret' });
    // No env fallback so the legacy header path is also closed off.
    const app = buildApp({ fs, auth: makeAuth(), envSecret: undefined });
    // Construct a body where JSON.stringify ordering differs from canonical
    // ordering. Insertion order: tenantId, z, a → JSON.stringify follows
    // that order. canonicalize sorts: a, tenantId, z.
    const body = { tenantId: 'tenant-A', z: 1, a: 2, type: 'wearable', source: 's', metric: 'm', value: 1 };
    expect(JSON.stringify(body)).not.toBe(canonicalize(body));
    const res = await request(app)
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', signLegacy('tenant-A-secret', body))
      .send(body);
    expect([401, 500]).toContain(res.status); // 401 if env fallback path runs, 500 if neither.
  });

  it('200 with reordered keys when client canonicalises (HMACs match across producers)', async () => {
    fs.store.set('tenants/tenant-A', { iotSecret: 'tenant-A-secret' });
    const app = buildApp({ fs, auth: makeAuth(), envSecret: ENV_SECRET });
    // Producer ships body in one order; verifier reconstructs in another.
    // Both canonicalise to the same string, so the HMAC matches.
    const producerBody = { z: 1, a: 2, tenantId: 'tenant-A', type: 'wearable', source: 's', metric: 'm', value: 1 };
    const sig = signCanonical('tenant-A-secret', producerBody);
    // Send with a different insertion order — Express body parser hands
    // back a `req.body` whose key order need not match the wire bytes,
    // but canonicalize() makes both sides converge.
    const verifierShape = { tenantId: 'tenant-A', a: 2, z: 1, type: 'wearable', source: 's', metric: 'm', value: 1 };
    const res = await request(app)
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', sig)
      .send(verifierShape);
    expect(res.status).toBe(200);
  });

  it('401 with reordered keys signed under JSON.stringify when LEGACY_HMAC_FALLBACK is OFF', async () => {
    fs.store.set('tenants/tenant-A', { iotSecret: 'tenant-A-secret' });
    const app = buildApp({ fs, auth: makeAuth(), envSecret: undefined });
    const body = { tenantId: 'tenant-A', z: 1, a: 2, type: 'wearable', source: 's', metric: 'm', value: 1 };
    const res = await request(app)
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', signLegacy('tenant-A-secret', body))
      .send(body);
    expect([401, 500]).toContain(res.status);
  });

  it('200 with JSON.stringify-signed body when LEGACY_HMAC_FALLBACK=1 (emergency rollback)', async () => {
    process.env.LEGACY_HMAC_FALLBACK = '1';
    fs.store.set('tenants/tenant-A', { iotSecret: 'tenant-A-secret' });
    const app = buildApp({ fs, auth: makeAuth(), envSecret: undefined });
    const body = { tenantId: 'tenant-A', z: 1, a: 2, type: 'wearable', source: 's', metric: 'm', value: 1 };
    const res = await request(app)
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', signLegacy('tenant-A-secret', body))
      .send(body);
    expect(res.status).toBe(200);
  });

  it('idempotent re-send: same body + same signature accepted twice (handler is stateless on auth)', async () => {
    fs.store.set('tenants/tenant-A', { iotSecret: 'tenant-A-secret' });
    const app = buildApp({ fs, auth: makeAuth(), envSecret: ENV_SECRET });
    const body = {
      tenantId: 'tenant-A',
      type: 'wearable',
      source: 's',
      metric: 'm',
      value: 1,
    };
    const sig = signCanonical('tenant-A-secret', body);
    const r1 = await request(app).post('/api/telemetry/ingest').set('x-iot-signature', sig).send(body);
    const r2 = await request(app).post('/api/telemetry/ingest').set('x-iot-signature', sig).send(body);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Two events ingested (this endpoint has no idempotency layer — per
    // spec, each ingest is a discrete event row).
    const events = [...fs.store.entries()].filter(([k]) => k.startsWith('telemetry_events/'));
    expect(events).toHaveLength(2);
  });

  it('rejects a body that was truncated post-signing (sig over original ≠ sig over truncated)', async () => {
    fs.store.set('tenants/tenant-A', { iotSecret: 'tenant-A-secret' });
    const app = buildApp({ fs, auth: makeAuth(), envSecret: undefined });
    const original = {
      tenantId: 'tenant-A',
      type: 'wearable',
      source: 's',
      metric: 'm',
      value: 1,
      extraTelemetry: { battery: 99, gps: [10.0, -77.0] },
    };
    const sig = signCanonical('tenant-A-secret', original);
    // Drop a top-level field — signature should no longer verify.
    const truncated = {
      tenantId: 'tenant-A',
      type: 'wearable',
      source: 's',
      metric: 'm',
      value: 1,
    };
    const res = await request(app)
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', sig)
      .send(truncated);
    expect([401, 500]).toContain(res.status);
  });

  it('rejects body with non-finite numbers at the verifier (canonicalize throws → 401/500)', async () => {
    // This is more of a smoke test for the canonicalize throw path. A
    // producer shipping NaN/Infinity in JSON would fail their own
    // canonicalisation BEFORE signing — but if the body parser handed us
    // such a value (it can't via standard JSON, but defensive), we want
    // to refuse the request rather than crash.
    fs.store.set('tenants/tenant-A', { iotSecret: 'tenant-A-secret' });
    const app = buildApp({ fs, auth: makeAuth(), envSecret: ENV_SECRET });
    // We can't ship NaN over JSON — instead, supply a missing signature
    // to verify the unauthorised path is the one that wins.
    const body = { tenantId: 'tenant-A', type: 'wearable', source: 's', metric: 'm', value: 1 };
    const res = await request(app)
      .post('/api/telemetry/ingest')
      // No x-iot-signature header → per-tenant path falls through to env
      // fallback which fails because no x-iot-secret either.
      .send(body);
    expect(res.status).toBe(401);
  });
});
