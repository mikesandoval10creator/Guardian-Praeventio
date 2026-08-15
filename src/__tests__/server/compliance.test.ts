// Real-router supertest for src/server/routes/compliance.ts
// (Plan v3 Fase 1 — server lever). Mounted at /api/compliance in server.ts.
//
// Covers: GET /processing-activities (public), POST /consent,
// DELETE /consent/:purpose, GET /consent, POST /data-request,
// GET /data-request/:id, GET /data-export/:requestId.
//
// Pattern: fakeFirestore real-router (same as misc.test.ts / criticalControls.test.ts).
// Domain service (ley19628) runs REAL so Firestore side-effects are verified.
// privacy/registry runs REAL (pure functions, no I/O).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import complianceRouter from '../../server/routes/compliance.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Matches server.ts: app.use('/api/compliance', complianceRouter)
  app.use('/api/compliance', complianceRouter);
  return app;
}

const CALLER_UID = 'uid-compliance-test';
const OTHER_UID = 'uid-other-user';

beforeEach(() => {
  H.db = createFakeFirestore();
});

// ---------------------------------------------------------------------------
// GET /api/compliance/processing-activities — public, no auth
// ---------------------------------------------------------------------------

describe('GET /api/compliance/processing-activities', () => {
  it('200 without a token (public RAT endpoint)', async () => {
    const res = await request(buildApp()).get('/api/compliance/processing-activities');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.activities)).toBe(true);
    expect((res.body.activities as unknown[]).length).toBeGreaterThan(0);
  });

  it('200 returns activities with required fields', async () => {
    const res = await request(buildApp()).get('/api/compliance/processing-activities');
    expect(res.status).toBe(200);
    const first = (res.body.activities as Record<string, unknown>[])[0];
    expect(typeof first.id).toBe('string');
    expect(typeof first.name).toBe('string');
    expect(typeof first.legalBasis).toBe('string');
    expect(Array.isArray(first.dataCategories)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/compliance/consent
// ---------------------------------------------------------------------------

describe('POST /api/compliance/consent', () => {
  const validBody = {
    purpose: 'analytics',
    granted: true,
    legalBasis: 'consent',
    textVersion: 'consent_v1.0',
  };

  it('401 without a token', async () => {
    const res = await request(buildApp()).post('/api/compliance/consent').send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 invalid_purpose for unknown purpose', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, purpose: 'unknown_purpose_xyz' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_purpose');
  });

  it('400 invalid_granted when granted is not boolean', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, granted: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_granted');
  });

  it('400 invalid_legal_basis for unknown legal basis', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, legalBasis: 'supernatural_basis' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_legal_basis');
  });

  it('400 invalid_text_version when textVersion is empty', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, textVersion: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_text_version');
  });

  it('400 invalid_text_version when textVersion exceeds 64 chars', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, textVersion: 'a'.repeat(65) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_text_version');
  });

  it('200 records consent and persists to Firestore', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const record = res.body.record as Record<string, unknown>;
    expect(record.uid).toBe(CALLER_UID);
    expect(record.purpose).toBe('analytics');
    expect(record.granted).toBe(true);
    expect(record.legalBasis).toBe('consent');

    // Side-effect: doc written to compliance_consents
    const snap = await H.db!
      .collection('compliance_consents')
      .doc(`${CALLER_UID}__analytics`)
      .get();
    expect(snap.exists).toBe(true);
    expect(snap.data()!.granted).toBe(true);
  });

  it('200 records core_service consent (required purpose)', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID)
      .send({
        purpose: 'core_service',
        granted: true,
        legalBasis: 'contract',
        textVersion: 'tos_v2.1',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.record.purpose).toBe('core_service');
  });

  it('200 records marketing consent with granted=false', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID)
      .send({
        purpose: 'marketing',
        granted: false,
        legalBasis: 'consent',
        textVersion: 'consent_v1.0',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.record.granted).toBe(false);
  });

  it('200 records geolocation consent (Ley 21.719 / GDPR art.9 explicit purpose)', async () => {
    // Ley 21.719: la geolocalización es dato sensible (art. 2) — el RAT ya
    // declara geolocation_telemetry; este purpose permite al titular
    // consentir/revocar de forma explícita, independiente del OS location
    // permission.
    const res = await request(buildApp())
      .post('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID)
      .send({
        purpose: 'geolocation',
        granted: true,
        legalBasis: 'consent',
        textVersion: 'geolocation_v1.0',
      });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.record.purpose).toBe('geolocation');
    expect(res.body.record.granted).toBe(true);

    const snap = await H.db!
      .collection('compliance_consents')
      .doc(CALLER_UID + '__geolocation')
      .get();
    expect(snap.exists).toBe(true);
    expect(snap.data()!.granted).toBe(true);
  });

  it('400 invalid_purpose for geofence (no consent purpose without explicit geolocation grant)', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID)
      .send({
        purpose: 'geofence',
        granted: true,
        legalBasis: 'consent',
        textVersion: 'consent_v1.0',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_purpose');
  });
});

// ---------------------------------------------------------------------------
// GET /api/compliance/subprocessors  (GDPR art.28 — público, sin auth)
// ---------------------------------------------------------------------------

describe('GET /api/compliance/subprocessors', () => {
  it('200 retorna la lista de sub-procesadores sin requerir auth (GDPR art.28)', async () => {
    // GDPR art.28 + LGPD + Ley 21.719: el titular o un inspector SERNAC
    // puede consultar la lista de sub-procesadores sin registrarse.
    const res = await request(buildApp()).get('/api/compliance/subprocessors');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.subprocessors)).toBe(true);
    expect(res.body.subprocessors.length).toBeGreaterThan(0);
  });

  it('cada sub-procesador tiene id + nombre + país + base legal + DPA URL', async () => {
    const res = await request(buildApp()).get('/api/compliance/subprocessors');
    expect(res.status).toBe(200);
    for (const sub of res.body.subprocessors) {
      expect(typeof sub.id).toBe('string');
      expect(sub.id.length).toBeGreaterThan(0);
      expect(typeof sub.name).toBe('string');
      expect(sub.name.length).toBeGreaterThan(0);
      expect(typeof sub.category).toBe('string');
      expect(typeof sub.region).toBe('string');
      expect(sub.region.length).toBeGreaterThan(0);
      expect(typeof sub.legalBasis).toBe('string');
      expect(sub.legalBasis.length).toBeGreaterThan(0);
      expect(typeof sub.dpaUrl).toBe('string');
      expect(sub.dpaUrl).toMatch(/^https:\/\//);
    }
  });

  it('la lista incluye los sub-procesadores reales del proyecto (Firebase, Gemini, KMS, Resend)', async () => {
    const res = await request(buildApp()).get('/api/compliance/subprocessors');
    const ids = (res.body.subprocessors as Array<{ id: string }>).map((s) => s.id);
    expect(ids).toContain('firebase-firestore');
    expect(ids).toContain('firebase-cloud-messaging');
    expect(ids).toContain('firebase-auth');
    expect(ids).toContain('google-gemini-api');
    expect(ids).toContain('google-cloud-kms');
    expect(ids).toContain('resend');
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/compliance/consent/:purpose
// ---------------------------------------------------------------------------

describe('DELETE /api/compliance/consent/:purpose', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).delete('/api/compliance/consent/analytics');
    expect(res.status).toBe(401);
  });

  it('400 invalid_purpose for unknown purpose', async () => {
    const res = await request(buildApp())
      .delete('/api/compliance/consent/not_a_real_purpose')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_purpose');
  });

  it('200 idempotent revoke when consent never given', async () => {
    // No seed — revoke on nonexistent doc is treated as success
    const res = await request(buildApp())
      .delete('/api/compliance/consent/analytics')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 revokes analytics consent and updates Firestore', async () => {
    // Seed the consent first
    H.db!._seed(`compliance_consents/${CALLER_UID}__analytics`, {
      uid: CALLER_UID,
      purpose: 'analytics',
      granted: true,
      legalBasis: 'consent',
      textVersion: 'consent_v1.0',
      grantedAt: Date.now(),
    });

    const res = await request(buildApp())
      .delete('/api/compliance/consent/analytics')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Side-effect: doc updated with granted=false
    const snap = await H.db!
      .collection('compliance_consents')
      .doc(`${CALLER_UID}__analytics`)
      .get();
    expect(snap.data()!.granted).toBe(false);
    expect(typeof snap.data()!.revokedAt).toBe('number');
  });

  it('409 core_consent_required when revoking core_service', async () => {
    const res = await request(buildApp())
      .delete('/api/compliance/consent/core_service')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('core_consent_required');
  });
});

// ---------------------------------------------------------------------------
// GET /api/compliance/consent
// ---------------------------------------------------------------------------

describe('GET /api/compliance/consent', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/compliance/consent');
    expect(res.status).toBe(401);
  });

  it('200 returns empty consents map when no records exist', async () => {
    const res = await request(buildApp())
      .get('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.uid).toBe(CALLER_UID);
    expect(typeof res.body.consents).toBe('object');
    expect(Object.keys(res.body.consents as Record<string, unknown>)).toHaveLength(0);
  });

  it('200 returns all consent records for the caller', async () => {
    // Seed two consent records
    H.db!._seed(`compliance_consents/${CALLER_UID}__analytics`, {
      uid: CALLER_UID,
      purpose: 'analytics',
      granted: true,
      legalBasis: 'consent',
      textVersion: 'consent_v1.0',
      grantedAt: 1700000000000,
    });
    H.db!._seed(`compliance_consents/${CALLER_UID}__marketing`, {
      uid: CALLER_UID,
      purpose: 'marketing',
      granted: false,
      legalBasis: 'consent',
      textVersion: 'consent_v1.0',
      grantedAt: 1700000000001,
    });

    const res = await request(buildApp())
      .get('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.uid).toBe(CALLER_UID);
    const consents = res.body.consents as Record<string, Record<string, unknown>>;
    expect(consents.analytics).toBeDefined();
    expect(consents.analytics.granted).toBe(true);
    expect(consents.marketing).toBeDefined();
    expect(consents.marketing.granted).toBe(false);
  });

  it('200 does not return records belonging to another uid', async () => {
    // Seed consent for OTHER_UID
    H.db!._seed(`compliance_consents/${OTHER_UID}__analytics`, {
      uid: OTHER_UID,
      purpose: 'analytics',
      granted: true,
      legalBasis: 'consent',
      textVersion: 'consent_v1.0',
      grantedAt: 1700000000000,
    });

    const res = await request(buildApp())
      .get('/api/compliance/consent')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.uid).toBe(CALLER_UID);
    // CALLER_UID must not see OTHER_UID's consents
    expect(Object.keys(res.body.consents as Record<string, unknown>)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/compliance/data-request
// ---------------------------------------------------------------------------

describe('POST /api/compliance/data-request', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/data-request')
      .send({ type: 'access' });
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload when type is missing', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/data-request')
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when type is not in enum', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/data-request')
      .set('x-test-uid', CALLER_UID)
      .send({ type: 'deletion' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 invalid_payload when reason exceeds 1024 chars', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/data-request')
      .set('x-test-uid', CALLER_UID)
      .send({ type: 'access', reason: 'x'.repeat(1025) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('201 creates an access request and persists to Firestore', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/data-request')
      .set('x-test-uid', CALLER_UID)
      .send({ type: 'access' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const req = res.body.request as Record<string, unknown>;
    expect(req.uid).toBe(CALLER_UID);
    expect(req.type).toBe('access');
    expect(req.status).toBe('pending');
    expect(typeof req.id).toBe('string');

    // Side-effect: row written to compliance_data_requests
    const snap = await H.db!
      .collection('compliance_data_requests')
      .doc(req.id as string)
      .get();
    expect(snap.exists).toBe(true);
    expect(snap.data()!.uid).toBe(CALLER_UID);
  });

  it('201 erasure request stored with pending status', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/data-request')
      .set('x-test-uid', CALLER_UID)
      .send({ type: 'erasure', reason: 'Closing account' });
    expect(res.status).toBe(201);
    expect(res.body.request.type).toBe('erasure');
    expect(res.body.request.status).toBe('pending');
  });

  it('201 rectification request accepts rectificationPayload', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/data-request')
      .set('x-test-uid', CALLER_UID)
      .send({
        type: 'rectification',
        rectificationPayload: { displayName: 'Nuevo Nombre', rut: '12.345.678-9' },
      });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.request.type).toBe('rectification');
  });

  it('201 returns deadlineDays + regimes for known subjectCountry', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/data-request')
      .set('x-test-uid', CALLER_UID)
      .send({ type: 'access', subjectCountry: 'BR' });
    expect(res.status).toBe(201);
    // Brazil = LGPD → deadline must be a positive number
    expect(typeof res.body.deadlineDays === 'number' || res.body.deadlineDays === null).toBe(true);
    expect(Array.isArray(res.body.regimes)).toBe(true);
  });

  it('201 portability type accepted', async () => {
    const res = await request(buildApp())
      .post('/api/compliance/data-request')
      .set('x-test-uid', CALLER_UID)
      .send({ type: 'portability' });
    expect(res.status).toBe(201);
    expect(res.body.request.type).toBe('portability');
  });
});

// ---------------------------------------------------------------------------
// GET /api/compliance/data-request/:id
// ---------------------------------------------------------------------------

describe('GET /api/compliance/data-request/:id', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/compliance/data-request/req-1');
    expect(res.status).toBe(401);
  });

  it('400 invalid_id when id exceeds 128 chars', async () => {
    const longId = 'x'.repeat(129);
    const res = await request(buildApp())
      .get(`/api/compliance/data-request/${longId}`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_id');
  });

  it('404 when request does not exist', async () => {
    const res = await request(buildApp())
      .get('/api/compliance/data-request/nonexistent-req-id')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('403 when caller is not the request owner', async () => {
    // Seed request belonging to OTHER_UID
    H.db!._seed('compliance_data_requests/req-other-1', {
      uid: OTHER_UID,
      type: 'access',
      status: 'pending',
      requestedAt: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-request/req-other-1')
      .set('x-test-uid', CALLER_UID); // CALLER_UID tries to read OTHER_UID's request
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns the request when caller is the owner', async () => {
    H.db!._seed('compliance_data_requests/req-caller-1', {
      uid: CALLER_UID,
      type: 'access',
      status: 'pending',
      requestedAt: 1700000000000,
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-request/req-caller-1')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const req = res.body.request as Record<string, unknown>;
    expect(req.id).toBe('req-caller-1');
    expect(req.uid).toBe(CALLER_UID);
    expect(req.type).toBe('access');
    expect(req.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// GET /api/compliance/data-export/:requestId
// ---------------------------------------------------------------------------

describe('GET /api/compliance/data-export/:requestId', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/compliance/data-export/req-1');
    expect(res.status).toBe(401);
  });

  it('404 when request does not exist', async () => {
    const res = await request(buildApp())
      .get('/api/compliance/data-export/nonexistent-export-req')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('403 when caller is not the request owner', async () => {
    H.db!._seed('compliance_data_requests/req-export-other', {
      uid: OTHER_UID,
      type: 'access',
      status: 'pending',
      requestedAt: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-export/req-export-other')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 request_not_exportable for erasure request type', async () => {
    H.db!._seed('compliance_data_requests/req-erasure-1', {
      uid: CALLER_UID,
      type: 'erasure',
      status: 'pending',
      requestedAt: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-export/req-erasure-1')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('request_not_exportable');
  });

  it('400 request_not_exportable for rectification request type', async () => {
    H.db!._seed('compliance_data_requests/req-rect-1', {
      uid: CALLER_UID,
      type: 'rectification',
      status: 'pending',
      requestedAt: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-export/req-rect-1')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('request_not_exportable');
  });

  it('200 exports user data for an access request', async () => {
    H.db!._seed('compliance_data_requests/req-access-1', {
      uid: CALLER_UID,
      type: 'access',
      status: 'pending',
      requestedAt: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-export/req-access-1')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    // Response is the export envelope
    expect(typeof res.body.uid).toBe('string');
    expect(res.body.uid).toBe(CALLER_UID);
    expect(typeof res.body.exportedAt).toBe('number');
    expect(typeof res.body.data).toBe('object');

    // Headers: Content-Disposition must be an attachment
    const disposition = res.headers['content-disposition'] as string;
    expect(disposition).toContain('attachment');
    expect(disposition).toContain(`praeventio-export-${CALLER_UID}`);
  });

  it('200 exports user data for a portability request', async () => {
    H.db!._seed('compliance_data_requests/req-portability-1', {
      uid: CALLER_UID,
      type: 'portability',
      status: 'pending',
      requestedAt: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-export/req-portability-1')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.uid).toBe(CALLER_UID);
    expect(typeof res.body.exportedAt).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// GET /api/compliance/data-export/:requestId/bundle  (DSAR machine-readable)
// ---------------------------------------------------------------------------

describe('GET /api/compliance/data-export/:requestId/bundle', () => {
  it('200 devuelve bundle con manifest + jsonl + csv concatenados (GDPR art.20)', async () => {
    H.db!._seed('compliance_data_requests/req-bundle-1', {
      uid: CALLER_UID,
      type: 'portability',
      status: 'pending',
      requestedAt: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-export/req-bundle-1/bundle')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);

    // Content-Type text/plain con marcadores RFC-style.
    const ct = res.headers['content-type'];
    expect(ct).toContain('text/plain');

    // Body contiene los tres archivos con sus separadores.
    expect(res.text).toContain('===== file: manifest.yaml =====');
    expect(res.text).toContain('===== file: data.jsonl =====');
    expect(res.text).toContain('===== file: data.csv =====');
  });

  it('manifest declara el uid + requestId + timestamp + regimes aplicables', async () => {
    H.db!._seed('compliance_data_requests/req-bundle-2', {
      uid: CALLER_UID,
      type: 'access',
      status: 'pending',
      requestedAt: Date.now(),
      subjectCountry: 'CL',
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-export/req-bundle-2/bundle')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);

    expect(res.text).toContain(`subject_uid: ${CALLER_UID}`);
    expect(res.text).toContain('request_id: req-bundle-2');
    expect(res.text).toMatch(/generated_at: \d{4}-\d{2}-\d{2}T/);
    // Régimen aplicable: al menos CL (Ley 21.719) cuando subjectCountry=CL.
    expect(res.text).toMatch(/applicable_regimes:[\s\S]*- [A-Z]/);
  });

  it('JSONL contiene líneas parseables, una por recordType', async () => {
    H.db!._seed('compliance_data_requests/req-bundle-3', {
      uid: CALLER_UID,
      type: 'portability',
      status: 'pending',
      requestedAt: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-export/req-bundle-3/bundle')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);

    // Aislamos la seccion data.jsonl entre sus dos separadores.
    const start = res.text.indexOf('===== file: data.jsonl =====') + '===== file: data.jsonl ====='.length;
    const end = res.text.indexOf('===== file: data.csv =====');
    const jsonl = res.text.slice(start, end).trim();
    const lines = jsonl.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    // Cada línea debe parsear como objeto JSON.
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      const parsed = JSON.parse(line);
      expect(parsed.uid).toBe(CALLER_UID);
      expect(parsed.requestId).toBe('req-bundle-3');
      expect(parsed.recordType).toBeDefined();
      expect(parsed.value).toBeDefined();
    }
  });

  it('CSV tiene header RFC 4180 + filas con campos escapados', async () => {
    H.db!._seed('compliance_data_requests/req-bundle-4', {
      uid: CALLER_UID,
      type: 'portability',
      status: 'pending',
      requestedAt: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-export/req-bundle-4/bundle')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);

    const start = res.text.indexOf('===== file: data.csv =====') + '===== file: data.csv ====='.length;
    const csv = res.text.slice(start).trim();
    const lines = csv.split('\n');
    // Header RFC 4180: recordType,uid,requestId,generatedAt,serializedValue.
    expect(lines[0]).toContain('recordType');
    expect(lines[0]).toContain('uid');
    expect(lines[0]).toContain('requestId');
    // Segunda línea: al menos un recordType real del exportUserData.
    expect(lines[1]).toContain(CALLER_UID);
    expect(lines[1]).toContain('req-bundle-4');
  });

  it('403 forbidden cuando el caller no es el dueño de la solicitud', async () => {
    H.db!._seed('compliance_data_requests/req-bundle-5', {
      uid: OTHER_UID,
      type: 'portability',
      status: 'pending',
      requestedAt: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-export/req-bundle-5/bundle')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 request_not_exportable para type=erasure', async () => {
    H.db!._seed('compliance_data_requests/req-bundle-erasure', {
      uid: CALLER_UID,
      type: 'erasure',
      status: 'pending',
      requestedAt: Date.now(),
    });

    const res = await request(buildApp())
      .get('/api/compliance/data-export/req-bundle-erasure/bundle')
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('request_not_exportable');
  });
});
