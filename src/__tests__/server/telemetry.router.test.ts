// Real-router supertest for src/server/routes/telemetry.ts
// (Round 19 R2 Phase 4 split — IoT telemetry ingest + per-tenant secret rotation).
// @vitest-environment node
//
// IMPORTANT — why this file exists alongside telemetryCanonical.test.ts and
// telemetryRotation.test.ts: those two suites build a PARALLEL hand-rewritten
// copy of the handler inside a local `buildApp()` (inline `app.post(...)`) and
// never import `src/server/routes/telemetry.ts`. They pass but cover ZERO lines
// of the real route — which is why telemetry.ts still reported 0% under v8.
// This suite mounts the ACTUAL router via the shared fakeFirestore + adminMock
// so v8 counts the real code (the parallel-copy → real-router lever from
// reference_test_coverage_architecture).
//
// Endpoints covered:
//   POST /api/telemetry/ingest          — IoT device/gateway webhook.
//       Auth #1 (per-tenant): HMAC-SHA256 over the RFC 8785 canonical JSON of
//         the body, header `x-iot-signature: sha256=<hex>`, secret read from
//         `tenants/{id}.iotSecret`. Replicated here with the real `canonicalize`.
//       Auth #2 (env fallback): shared `IOT_WEBHOOK_SECRET` via `x-iot-secret`
//         header (or deprecated body.secretKey).
//       Auth #3 (legacy rollback): `LEGACY_HMAC_FALLBACK=1` accepts a
//         `JSON.stringify(body)` HMAC.
//   POST /api/admin/iot/rotate-secret   — verifyAuth + admin-role gate; mints a
//         fresh 32-byte hex secret onto tenants/{id} and echoes it once.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import crypto from 'crypto';

// ─── hoisted mock state ───────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ─── firebase-admin — fakeFirestore + uid-keyed getUser for the rotate path ──
// rotate-secret calls admin.auth().getUser(callerUid) and checks
// isAdminRole(customClaims.role). uid 'admin-1' → admin; 'gerente-1' → gerente
// (both ADMIN_ROLES); everything else → 'worker' (→ 403). This drives every
// rotate-secret authz scenario from a single mock.
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!, {
    getUser: async (uid: string) => {
      // Dedicated uid that throws so the rotate-secret try/catch → 500 path is
      // reachable without fragile Firestore-write spying.
      if (uid === 'throws-1') throw new Error('auth backend down');
      return {
        uid,
        email: `${uid}@test.com`,
        customClaims:
          uid === 'admin-1'
            ? { role: 'admin' }
            : uid === 'gerente-1'
              ? { role: 'gerente' }
              : { role: 'worker' },
      };
    },
    verifyIdToken: async () => ({ uid: 'test' }),
  });
});

// ─── verifyAuth — inject req.user from x-test-uid (rotate-secret only) ────────
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));

// ─── logger — silence ─────────────────────────────────────────────────────────
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ─── safetyEngineBackend.autoValidateTelemetry — deterministic, no Gemini call ─
// The real impl makes a live @google/genai call (or returns undefined when no
// API_KEY). We stub it so the validation branch is controllable and offline.
// Default: null (→ status falls back to body status || 'normal', threatLevel
// 'None'). Override per-test via vi.mocked(...).mockResolvedValueOnce(...).
vi.mock('../../services/safetyEngineBackend.js', () => ({
  autoValidateTelemetry: vi.fn(async () => null),
}));

// ─── import REAL router + real helpers AFTER mocks ───────────────────────────
import telemetryRouter from '../../server/routes/telemetry.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { canonicalize } from '../../server/middleware/canonicalBody.js';
import { autoValidateTelemetry } from '../../services/safetyEngineBackend.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', telemetryRouter);
  return app;
}

// ─── shared constants + signing helpers (mirror the route's exact scheme) ────
const ENV_SECRET = 'env-fallback-secret-value';
const TENANT_ID = 'tenant-A';
const TENANT_SECRET = 'tenant-A-iot-secret';

const ORIGINAL_ENV_SECRET = process.env.IOT_WEBHOOK_SECRET;
const ORIGINAL_LEGACY = process.env.LEGACY_HMAC_FALLBACK;

/** sha256=<hex> over the RFC 8785 canonical JSON form — the route's primary path. */
function signCanonical(secret: string, body: unknown): string {
  const hex = crypto.createHmac('sha256', secret).update(canonicalize(body ?? {})).digest('hex');
  return `sha256=${hex}`;
}
/** sha256=<hex> over JSON.stringify(body) — only honored under LEGACY_HMAC_FALLBACK=1. */
function signLegacy(secret: string, body: unknown): string {
  const hex = crypto.createHmac('sha256', secret).update(JSON.stringify(body ?? {})).digest('hex');
  return `sha256=${hex}`;
}

const validPayload = {
  type: 'wearable',
  source: 'smartwatch-1',
  metric: 'heart_rate',
  value: 72,
};

function seedTenantSecret(secret = TENANT_SECRET) {
  H.db!._seed(`tenants/${TENANT_ID}`, { iotSecret: secret });
}

function eventRows(): Array<[string, Record<string, unknown>]> {
  return Object.entries(H.db!._dump()).filter(([k]) => k.startsWith('telemetry_events/')) as Array<
    [string, Record<string, unknown>]
  >;
}

beforeEach(() => {
  H.db = createFakeFirestore();
  vi.mocked(autoValidateTelemetry).mockReset().mockResolvedValue(null as never);
  // Default: env fallback secret present so the env-auth branch is reachable.
  process.env.IOT_WEBHOOK_SECRET = ENV_SECRET;
  delete process.env.LEGACY_HMAC_FALLBACK;
});

afterEach(() => {
  if (ORIGINAL_ENV_SECRET === undefined) delete process.env.IOT_WEBHOOK_SECRET;
  else process.env.IOT_WEBHOOK_SECRET = ORIGINAL_ENV_SECRET;
  if (ORIGINAL_LEGACY === undefined) delete process.env.LEGACY_HMAC_FALLBACK;
  else process.env.LEGACY_HMAC_FALLBACK = ORIGINAL_LEGACY;
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/telemetry/ingest — per-tenant HMAC auth
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/telemetry/ingest — per-tenant HMAC (x-iot-signature)', () => {
  it('200 ingests when the canonical-JSON HMAC matches the tenant secret', async () => {
    seedTenantSecret();
    const body = { tenantId: TENANT_ID, ...validPayload };
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', signCanonical(TENANT_SECRET, body))
      .send(body);

    expect(res.status).toBe(200);
    expect((res.body as { success: boolean }).success).toBe(true);
    expect((res.body as { message: string }).message).toMatch(/ingested/i);

    // Real route wrote a telemetry_events row via admin.firestore().add(...).
    const rows = eventRows();
    expect(rows).toHaveLength(1);
    const stored = rows[0][1];
    expect(stored.type).toBe('wearable');
    expect(stored.source).toBe('smartwatch-1');
    expect(stored.value).toBe(72);
    // autoValidateTelemetry returned null → status falls back to 'normal',
    // threatLevel to 'None', projectId to 'global'.
    expect(stored.status).toBe('normal');
    expect(stored.threatLevel).toBe('None');
    expect(stored.projectId).toBe('global');
  });

  it('200 honors the x-tenant-id HEADER over a body tenantId for secret lookup', async () => {
    // Secret registered under header tenant; body claims a different (unseeded)
    // tenant. Header must win, so the signature over `header` secret verifies.
    seedTenantSecret();
    const body = { tenantId: 'other-tenant', ...validPayload };
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-tenant-id', TENANT_ID)
      .set('x-iot-signature', signCanonical(TENANT_SECRET, body))
      .send(body);
    expect(res.status).toBe(200);
  });

  it('401 when the tenant secret is configured but the signature is wrong (env fallback present)', async () => {
    // beforeEach already set IOT_WEBHOOK_SECRET = ENV_SECRET, so the wrong-sig
    // path falls through to the env-fallback check, which fails (no x-iot-secret
    // header) → 401 rather than the 500 misconfigured branch.
    seedTenantSecret();
    const body = { tenantId: TENANT_ID, ...validPayload };
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', 'sha256=deadbeefdeadbeef')
      .send(body);
    // Sig mismatch → not authenticated → env fallback runs, no x-iot-secret → 401.
    expect(res.status).toBe(401);
    expect(eventRows()).toHaveLength(0);
  });

  it('500 when the tenant secret is configured, signature is wrong, AND env fallback is absent', async () => {
    delete process.env.IOT_WEBHOOK_SECRET;
    seedTenantSecret();
    const body = { tenantId: TENANT_ID, ...validPayload };
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', 'sha256=deadbeef')
      .send(body);
    // No env secret + no per-tenant match → iot_webhook_misconfigured → 500.
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBe('Server configuration error');
  });

  it('cross-tenant: a body signed with tenant A secret cannot ingest into tenant B (4xx, no row)', async () => {
    // Both tenants have distinct secrets. Body claims tenant B; signature uses
    // tenant A's secret. Verifier looks up B's secret, recompute fails.
    H.db!._seed(`tenants/${TENANT_ID}`, { iotSecret: TENANT_SECRET });
    H.db!._seed('tenants/tenant-B', { iotSecret: 'tenant-B-iot-secret' });
    const body = { tenantId: 'tenant-B', ...validPayload };
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', signCanonical(TENANT_SECRET, body))
      .send(body);
    expect(res.status).toBe(401); // env fallback present → 401 (legacy header missing)
    expect(eventRows()).toHaveLength(0);
  });

  it('LEGACY_HMAC_FALLBACK=1: a JSON.stringify-signed body is accepted (emergency rollback)', async () => {
    process.env.LEGACY_HMAC_FALLBACK = '1';
    seedTenantSecret();
    // Body whose insertion order differs from canonical so the canonical HMAC
    // does NOT match — only the legacy JSON.stringify HMAC can authenticate.
    const body = { tenantId: TENANT_ID, z: 1, a: 2, ...validPayload };
    expect(JSON.stringify(body)).not.toBe(canonicalize(body));
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', signLegacy(TENANT_SECRET, body))
      .send(body);
    expect(res.status).toBe(200);
  });

  it('legacy JSON.stringify signature is REJECTED when LEGACY_HMAC_FALLBACK is off', async () => {
    delete process.env.LEGACY_HMAC_FALLBACK;
    seedTenantSecret();
    const body = { tenantId: TENANT_ID, z: 1, a: 2, ...validPayload };
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', signLegacy(TENANT_SECRET, body))
      .send(body);
    // Canonical HMAC mismatch + legacy flag off → env fallback → 401.
    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/telemetry/ingest — env shared-secret fallback path
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/telemetry/ingest — env shared-secret fallback', () => {
  it('200 with a correct x-iot-secret header when the tenant has no per-tenant secret', async () => {
    H.db!._seed(`tenants/${TENANT_ID}`, { name: 'no secret yet' });
    const body = { tenantId: TENANT_ID, ...validPayload };
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-secret', ENV_SECRET)
      .send(body);
    expect(res.status).toBe(200);
    expect(eventRows()).toHaveLength(1);
  });

  it('200 with a correct x-iot-secret header when no tenant scope is supplied at all', async () => {
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-secret', ENV_SECRET)
      .send(validPayload);
    expect(res.status).toBe(200);
  });

  it('200 via the DEPRECATED body.secretKey fallback', async () => {
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .send({ ...validPayload, secretKey: ENV_SECRET });
    expect(res.status).toBe(200);
  });

  it('401 when x-iot-secret is wrong', async () => {
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-secret', 'WRONG-SECRET')
      .send(validPayload);
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toMatch(/Invalid secret key/);
  });

  it('401 when no secret is provided at all', async () => {
    const res = await request(buildApp()).post('/api/telemetry/ingest').send(validPayload);
    expect(res.status).toBe(401);
  });

  it('500 when IOT_WEBHOOK_SECRET is unset and no per-tenant secret applies', async () => {
    delete process.env.IOT_WEBHOOK_SECRET;
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-secret', 'anything')
      .send(validPayload);
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBe('Server configuration error');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/telemetry/ingest — payload validation (post-auth)
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/telemetry/ingest — payload validation', () => {
  // All validation tests authenticate via the env fallback so they exercise the
  // post-auth validation block.
  const ingestValid = (overrides: Record<string, unknown>) =>
    request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-secret', ENV_SECRET)
      .send({ ...validPayload, ...overrides });

  it('400 when a required field is missing (metric absent)', async () => {
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-secret', ENV_SECRET)
      .send({ type: 'wearable', source: 's', value: 1 });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Missing required fields');
  });

  it('400 when value is undefined (value === undefined guard)', async () => {
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-secret', ENV_SECRET)
      .send({ type: 'wearable', source: 's', metric: 'm' });
    expect(res.status).toBe(400);
  });

  it('400 when type is not in the IOT_TYPE_ALLOWLIST', async () => {
    const res = await ingestValid({ type: 'not_a_real_type' });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Invalid type');
  });

  it('400 when source exceeds 64 chars', async () => {
    const res = await ingestValid({ source: 'x'.repeat(65) });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Invalid source');
  });

  it('400 when metric exceeds 64 chars', async () => {
    const res = await ingestValid({ metric: 'm'.repeat(65) });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Invalid metric');
  });

  it('200 accepts every allowlisted type', async () => {
    for (const type of ['iot', 'wearable', 'machinery', 'environmental', 'machine']) {
      const res = await ingestValid({ type, source: `src-${type}`, metric: 'temp', value: 1 });
      expect(res.status).toBe(200);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/telemetry/ingest — AI auto-validation branch
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/telemetry/ingest — autoValidateTelemetry integration', () => {
  it('stamps status=alert + threatLevel when the validation reports an anomaly', async () => {
    vi.mocked(autoValidateTelemetry).mockResolvedValueOnce({
      isAnomalous: true,
      threatLevel: 'High',
      reason: 'spike',
      suggestedAction: 'inspect',
    } as never);

    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-secret', ENV_SECRET)
      .send({ ...validPayload, status: 'normal', projectId: 'proj-7' });
    expect(res.status).toBe(200);

    const stored = eventRows()[0][1];
    expect(stored.status).toBe('alert'); // anomaly overrides the body status
    expect(stored.threatLevel).toBe('High');
    expect(stored.projectId).toBe('proj-7');
    expect((res.body as { aiValidation: { isAnomalous: boolean } }).aiValidation.isAnomalous).toBe(
      true,
    );
  });

  // Arista C3 (2026-06-11): the gas soft-block on confined-space permits joins
  // telemetry to permits via `zoneId`. The ingest persists it when present so
  // the workPermits gas gate can query `projectId + zoneId + timestamp`.
  it('persists a valid zoneId so readings can be joined to work-permit zones', async () => {
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-secret', ENV_SECRET)
      .send({ ...validPayload, projectId: 'proj-7', zoneId: 'zona-7' });
    expect(res.status).toBe(200);
    const stored = eventRows()[0][1];
    expect(stored.zoneId).toBe('zona-7');
  });

  it('stores zoneId as null when absent or invalid (device-controlled field, sanitized)', async () => {
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-secret', ENV_SECRET)
      .send({ ...validPayload, zoneId: 12345 });
    expect(res.status).toBe(200);
    const stored = eventRows()[0][1];
    expect(stored.zoneId).toBeNull();
  });

  it('keeps the body status when validation is non-anomalous', async () => {
    vi.mocked(autoValidateTelemetry).mockResolvedValueOnce({
      isAnomalous: false,
      threatLevel: 'Low',
    } as never);
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-secret', ENV_SECRET)
      .send({ ...validPayload, status: 'warning' });
    expect(res.status).toBe(200);
    const stored = eventRows()[0][1];
    expect(stored.status).toBe('warning');
    expect(stored.threatLevel).toBe('Low');
  });

  it('500 (internal error, no leak) when the ingest try-block throws', async () => {
    // autoValidateTelemetry is awaited INSIDE the route's try-block (before the
    // telemetry_events write). A rejection there lands in the catch → generic
    // 500 with no internal leak. This exercises the catch path deterministically.
    vi.mocked(autoValidateTelemetry).mockRejectedValueOnce(new Error('boom') as never);
    const res = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-secret', ENV_SECRET)
      .send(validPayload);
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBe('Internal server error');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/iot/rotate-secret — admin-only secret rotation
// ══════════════════════════════════════════════════════════════════════════════
describe('POST /api/admin/iot/rotate-secret', () => {
  it('401 without an auth token (verifyAuth rejects)', async () => {
    const res = await request(buildApp())
      .post('/api/admin/iot/rotate-secret')
      .send({ tenantId: TENANT_ID });
    expect(res.status).toBe(401);
  });

  it('400 when tenantId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/iot/rotate-secret')
      .set('x-test-uid', 'admin-1')
      .send({});
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Invalid tenantId');
  });

  it('400 when tenantId exceeds 128 chars', async () => {
    const res = await request(buildApp())
      .post('/api/admin/iot/rotate-secret')
      .set('x-test-uid', 'admin-1')
      .send({ tenantId: 'x'.repeat(129) });
    expect(res.status).toBe(400);
  });

  it('403 when the caller is authenticated but lacks an admin role', async () => {
    const res = await request(buildApp())
      .post('/api/admin/iot/rotate-secret')
      .set('x-test-uid', 'worker-1') // mock → role 'worker'
      .send({ tenantId: TENANT_ID });
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toMatch(/admin role/);
  });

  it('200 happy path: mints a 64-hex secret, persists it + iotSecretRotatedAt, echoes once', async () => {
    const res = await request(buildApp())
      .post('/api/admin/iot/rotate-secret')
      .set('x-test-uid', 'admin-1')
      .send({ tenantId: TENANT_ID });
    expect(res.status).toBe(200);
    const secret = (res.body as { secret: string }).secret;
    expect(typeof secret).toBe('string');
    expect(secret).toHaveLength(64); // 32 bytes hex
    expect(secret).toMatch(/^[0-9a-f]{64}$/);

    // Persisted onto tenants/{id} with merge (secret + rotated-at timestamp).
    const tenant = H.db!._dump()[`tenants/${TENANT_ID}`];
    expect(tenant.iotSecret).toBe(secret);
    expect(tenant.iotSecretRotatedAt).toBeDefined();
  });

  it('200 for a gerente caller (gerente is an ADMIN_ROLE)', async () => {
    const res = await request(buildApp())
      .post('/api/admin/iot/rotate-secret')
      .set('x-test-uid', 'gerente-1')
      .send({ tenantId: TENANT_ID });
    expect(res.status).toBe(200);
  });

  it('writes an audit_logs row (admin.iot.secret_rotated) WITHOUT leaking the raw secret', async () => {
    const res = await request(buildApp())
      .post('/api/admin/iot/rotate-secret')
      .set('x-test-uid', 'admin-1')
      .send({ tenantId: TENANT_ID });
    const secret = (res.body as { secret: string }).secret;

    const auditRows = Object.entries(H.db!._dump()).filter(([k]) => k.startsWith('audit_logs/'));
    expect(auditRows.length).toBeGreaterThanOrEqual(1);
    const row = auditRows.find(([, v]) => (v as { action?: string }).action === 'admin.iot.secret_rotated');
    expect(row).toBeDefined();
    const details = (row![1] as { details: Record<string, unknown>; userId: string });
    expect(details.details).toMatchObject({ tenantId: TENANT_ID });
    expect(details.userId).toBe('admin-1'); // server-stamped from verifyAuth, not body
    // Compliance invariant: the raw secret must never bleed into the audit row.
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  it('rotation round-trips: the new secret can immediately sign a valid ingest', async () => {
    const rotateRes = await request(buildApp())
      .post('/api/admin/iot/rotate-secret')
      .set('x-test-uid', 'admin-1')
      .send({ tenantId: TENANT_ID });
    const newSecret = (rotateRes.body as { secret: string }).secret;

    const body = { tenantId: TENANT_ID, ...validPayload };
    const ingestRes = await request(buildApp())
      .post('/api/telemetry/ingest')
      .set('x-iot-signature', signCanonical(newSecret, body))
      .send(body);
    expect(ingestRes.status).toBe(200);
  });

  it('500 (generic) when the role lookup throws — error body never leaks internals', async () => {
    // uid 'throws-1' makes admin.auth().getUser reject inside the try-block →
    // catch → 500 with the generic message (no internal detail leaked).
    const res = await request(buildApp())
      .post('/api/admin/iot/rotate-secret')
      .set('x-test-uid', 'throws-1')
      .send({ tenantId: TENANT_ID });
    expect(res.status).toBe(500);
    expect((res.body as { error: string }).error).toBe('Internal server error');
    // The tenants doc must NOT have been written (failure before the set()).
    expect(H.db!._dump()[`tenants/${TENANT_ID}`]).toBeUndefined();
  });
});
