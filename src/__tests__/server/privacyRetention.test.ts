// Praeventio Guard — Plan v3 Fase 1: real-router supertest for
// src/server/routes/privacyRetention.ts (Sprint 44 §125-128 — 4 stateless
// endpoints, 0 prior coverage). Mounts the ACTUAL production router so every
// middleware in the chain (verifyAuth → validate → assertProjectMember →
// engine functions) runs. The engine (dataRetentionPolicy.ts) is fully
// deterministic and performs no Firestore writes; assertProjectMember reads
// projects/<id> via the fakeFirestore.
//
// Compliance note (Ley 21.719 / GDPR-like): all four endpoints carry high
// legal value — retention decisions, consent checks, PII bucket routing,
// and sensitivity classification.
//
// Mounted at: app.use('/api/sprint-k', privacyRetentionRouter)
//   → POST /api/sprint-k/:projectId/privacy/decide-retention
//   → POST /api/sprint-k/:projectId/privacy/check-consent
//   → POST /api/sprint-k/:projectId/privacy/pii-bucket
//   → POST /api/sprint-k/:projectId/privacy/sensitivity-for-category

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── fakeFirestore holder (vi.hoisted so the vi.mock factory can close over it)
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  // Route only calls admin.firestore() inside assertProjectMember; auth is
  // handled by the verifyAuth mock below.
  return adminMock(() => H.db!);
});

// verifyAuth mock: uid from x-test-uid header; 401 when absent.
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

// logger: silent stubs.
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// captureRouteError: no-op (observability must not break tests).
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

// observability (verifyAuth imports it indirectly via getErrorTracker).
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import privacyRetentionRouter from '../../server/routes/privacyRetention.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── App factory ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', privacyRetentionRouter);
  return app;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const PROJECT = 'proj-privacy-test';
const MEMBER_UID = 'user-member';
const OUTSIDER_UID = 'user-outsider';

function seedMembership(uid: string = MEMBER_UID) {
  H.db!._seed(`projects/${PROJECT}`, {
    members: [uid],
    createdBy: uid,
    name: 'Proyecto Privacy Test',
  });
}

// ISO-8601 date helpers (deterministic)
const RECENT_DATE = '2025-01-01T00:00:00.000Z'; // recent — keep_active for most

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
});

// ════════════════════════════════════════════════════════════════════════════
// 1. POST /:projectId/privacy/decide-retention
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/privacy/decide-retention', () => {
  const app = buildApp();
  const url = (pid = PROJECT) => `/api/sprint-k/${pid}/privacy/decide-retention`;

  const validRecord = {
    id: 'rec-001',
    category: 'incident',
    jurisdiction: 'CL',
    createdAt: RECENT_DATE,
  };

  const validBody = { record: validRecord };

  it('401 when no Authorization token', async () => {
    const res = await request(app).post(url()).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 when body is missing required record field', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when record.category is an invalid enum value', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ record: { ...validRecord, category: 'not_a_category' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when record.jurisdiction is an invalid enum value', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ record: { ...validRecord, jurisdiction: 'ZZ' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    // project doc seeded without OUTSIDER_UID
    seedMembership(MEMBER_UID);
    const res = await request(app)
      .post(url())
      .set('x-test-uid', OUTSIDER_UID)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 keep_active for a recent incident record (CL)', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('decision');
    const { decision } = res.body;
    expect(decision.recordId).toBe('rec-001');
    expect(decision.action).toBe('keep_active');
    expect(typeof decision.daysAge).toBe('number');
    expect(typeof decision.rationale).toBe('string');
    expect(typeof decision.blockedByLegalHold).toBe('boolean');
  });

  it('200 archive_immutable for an old incident outside active window but inside total', async () => {
    seedMembership();
    // createdAt ~2015: ~3650 days ago. Incident CL: activeDays=1825, totalDays=3650.
    // At exactly boundary this may vary — use a date guaranteed to be in the
    // archive window (past activeDays but not yet at totalDays).
    const archiveDate = '2015-06-01T00:00:00.000Z'; // ~10y ago → daysAge ~3650; near total
    // Use customRules to guarantee we land in archive range deterministically.
    const body = {
      record: { ...validRecord, createdAt: archiveDate },
      options: {
        now: '2020-01-01T00:00:00.000Z', // ~1675 days from archiveDate: past 1825? No.
        // Actually 2020-01-01 minus 2015-06-01 ≈ 1674 days < 1825 activeDays → keep_active.
        // Use customRules with short activeDays so we land in archive band.
        customRules: [
          { category: 'incident', jurisdiction: 'CL', activeDays: 100, totalDays: 9000 },
        ],
      },
    };
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.decision.action).toBe('archive_immutable');
  });

  it('200 purge for a record past total retention window via customRules', async () => {
    seedMembership();
    const body = {
      record: { ...validRecord, createdAt: '2015-01-01T00:00:00.000Z' },
      options: {
        now: '2020-06-01T00:00:00.000Z', // ~1977 days
        customRules: [
          { category: 'incident', jurisdiction: 'CL', activeDays: 10, totalDays: 100 },
        ],
      },
    };
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.decision.action).toBe('purge');
  });

  it('200 archive_immutable (not purge) when legal hold is active and would-purge', async () => {
    seedMembership();
    const body = {
      record: {
        ...validRecord,
        createdAt: '2015-01-01T00:00:00.000Z',
        legalHold: true,
      },
      options: {
        now: '2020-06-01T00:00:00.000Z',
        customRules: [
          { category: 'incident', jurisdiction: 'CL', activeDays: 10, totalDays: 100 },
        ],
      },
    };
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.decision.action).toBe('archive_immutable');
    expect(res.body.decision.blockedByLegalHold).toBe(true);
  });

  it('403 when project doc does not exist', async () => {
    // H.db is fresh — no project seeded
    const res = await request(app)
      .post(url('nonexistent-project'))
      .set('x-test-uid', MEMBER_UID)
      .send(validBody);
    expect(res.status).toBe(403);
  });

  it('200 medical_aptitude keep_active for EU jurisdiction', async () => {
    seedMembership();
    const body = {
      record: {
        id: 'apt-001',
        category: 'medical_aptitude',
        jurisdiction: 'EU',
        createdAt: RECENT_DATE,
      },
    };
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.decision.action).toBe('keep_active');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. POST /:projectId/privacy/check-consent
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/privacy/check-consent', () => {
  const app = buildApp();
  const url = (pid = PROJECT) => `/api/sprint-k/${pid}/privacy/check-consent`;

  const validArtifact = {
    subjectUid: 'worker-uid-001',
    purpose: 'data_processing_basic',
    grantedAt: '2024-01-01T00:00:00.000Z',
    legalTextVersion: 'v1.0',
    signatureMethod: 'biometric',
  };

  const validOptions = {
    currentLegalTextVersion: 'v1.0',
  };

  const validBody = {
    artifact: validArtifact,
    options: validOptions,
  };

  it('401 when no Authorization token', async () => {
    const res = await request(app).post(url()).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 when options is missing', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ artifact: validArtifact });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when options.currentLegalTextVersion is missing', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ artifact: validArtifact, options: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when artifact.purpose is invalid enum', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({
        artifact: { ...validArtifact, purpose: 'invalid_purpose' },
        options: validOptions,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when artifact.signatureMethod is invalid enum', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({
        artifact: { ...validArtifact, signatureMethod: 'usb_key' },
        options: validOptions,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    seedMembership(MEMBER_UID);
    const res = await request(app)
      .post(url())
      .set('x-test-uid', OUTSIDER_UID)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 granted:true for current matching consent', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('check');
    const { check } = res.body;
    expect(check.granted).toBe(true);
    expect(check.revoked).toBe(false);
    expect(typeof check.rationale).toBe('string');
  });

  it('200 granted:false revoked:true for revoked consent', async () => {
    seedMembership();
    const body = {
      artifact: {
        ...validArtifact,
        revokedAt: '2024-06-01T00:00:00.000Z',
      },
      options: {
        ...validOptions,
        now: '2024-07-01T00:00:00.000Z', // after revocation date
      },
    };
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.check.granted).toBe(false);
    expect(res.body.check.revoked).toBe(true);
  });

  it('200 null artifact returns granted:false with no consent rationale', async () => {
    seedMembership();
    const body = {
      artifact: null,
      options: validOptions,
    };
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.check.granted).toBe(false);
    expect(res.body.check.revoked).toBe(false);
    expect(res.body.check.rationale).toBeTruthy();
  });

  it('200 gracePeriod:true when legal text changed but within grace window', async () => {
    seedMembership();
    const body = {
      artifact: {
        ...validArtifact,
        legalTextVersion: 'v1.0',
        grantedAt: '2024-06-20T00:00:00.000Z',
      },
      options: {
        currentLegalTextVersion: 'v2.0', // changed
        now: '2024-06-25T00:00:00.000Z', // only 5 days after grantedAt, within 14d grace
        graceDays: 14,
      },
    };
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.check.granted).toBe(true);
    expect(res.body.check.gracePeriod).toBe(true);
  });

  it('200 granted:false when legal text changed and grace period expired', async () => {
    seedMembership();
    const body = {
      artifact: {
        ...validArtifact,
        legalTextVersion: 'v1.0',
        grantedAt: '2024-01-01T00:00:00.000Z',
      },
      options: {
        currentLegalTextVersion: 'v2.0', // changed
        now: '2024-06-01T00:00:00.000Z', // 151 days after grant, well outside 14d grace
        graceDays: 14,
      },
    };
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.check.granted).toBe(false);
    expect(res.body.check.gracePeriod).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. POST /:projectId/privacy/pii-bucket
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/privacy/pii-bucket', () => {
  const app = buildApp();
  const url = (pid = PROJECT) => `/api/sprint-k/${pid}/privacy/pii-bucket`;

  it('401 when no Authorization token', async () => {
    const res = await request(app).post(url()).send({ sensitivity: 'public' });
    expect(res.status).toBe(401);
  });

  it('400 when sensitivity field is missing', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when sensitivity is invalid enum', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ sensitivity: 'top_secret' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    seedMembership(MEMBER_UID);
    const res = await request(app)
      .post(url())
      .set('x-test-uid', OUTSIDER_UID)
      .send({ sensitivity: 'public' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 public → public/ paths, no medical role required', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ sensitivity: 'public' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('bucket');
    const { bucket } = res.body;
    expect(bucket.storagePathPrefix).toBe('public/');
    expect(bucket.firestoreCollectionPrefix).toBe('public/');
    expect(bucket.requiresMedicalRoleClaim).toBe(false);
  });

  it('200 internal → tenants/ collection, no medical role', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ sensitivity: 'internal' });
    expect(res.status).toBe(200);
    expect(res.body.bucket.storagePathPrefix).toBe('internal/');
    expect(res.body.bucket.firestoreCollectionPrefix).toBe('tenants/');
    expect(res.body.bucket.requiresMedicalRoleClaim).toBe(false);
  });

  it('200 sensitive → tenants_sensitive/ collection, no medical role', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ sensitivity: 'sensitive' });
    expect(res.status).toBe(200);
    expect(res.body.bucket.storagePathPrefix).toBe('sensitive/');
    expect(res.body.bucket.firestoreCollectionPrefix).toBe('tenants_sensitive/');
    expect(res.body.bucket.requiresMedicalRoleClaim).toBe(false);
  });

  it('200 medical → tenants_medical/ collection, requiresMedicalRoleClaim:true (ADR 0012 double-lock)', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ sensitivity: 'medical' });
    expect(res.status).toBe(200);
    expect(res.body.bucket.storagePathPrefix).toBe('medical/');
    expect(res.body.bucket.firestoreCollectionPrefix).toBe('tenants_medical/');
    expect(res.body.bucket.requiresMedicalRoleClaim).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. POST /:projectId/privacy/sensitivity-for-category
// ════════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/privacy/sensitivity-for-category', () => {
  const app = buildApp();
  const url = (pid = PROJECT) => `/api/sprint-k/${pid}/privacy/sensitivity-for-category`;

  it('401 when no Authorization token', async () => {
    const res = await request(app).post(url()).send({ category: 'incident' });
    expect(res.status).toBe(401);
  });

  it('400 when category is missing', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when category is an invalid enum value', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ category: 'biometric_fingerprint' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    seedMembership(MEMBER_UID);
    const res = await request(app)
      .post(url())
      .set('x-test-uid', OUTSIDER_UID)
      .send({ category: 'incident' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 incident → sensitive', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ category: 'incident' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sensitivity');
    expect(res.body.sensitivity).toBe('sensitive');
  });

  it('200 medical_aptitude → medical (ADR 0012 double-lock enforced)', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ category: 'medical_aptitude' });
    expect(res.status).toBe(200);
    expect(res.body.sensitivity).toBe('medical');
  });

  it('200 medical_diagnosis → medical', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ category: 'medical_diagnosis' });
    expect(res.status).toBe(200);
    expect(res.body.sensitivity).toBe('medical');
  });

  it('200 audit_log → sensitive', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ category: 'audit_log' });
    expect(res.status).toBe(200);
    expect(res.body.sensitivity).toBe('sensitive');
  });

  it('200 consent_artifact → sensitive', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ category: 'consent_artifact' });
    expect(res.status).toBe(200);
    expect(res.body.sensitivity).toBe('sensitive');
  });

  it('200 training_record → internal', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ category: 'training_record' });
    expect(res.status).toBe(200);
    expect(res.body.sensitivity).toBe('internal');
  });

  it('200 epp_assignment → internal', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ category: 'epp_assignment' });
    expect(res.status).toBe(200);
    expect(res.body.sensitivity).toBe('internal');
  });

  it('200 attendance → internal', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ category: 'attendance' });
    expect(res.status).toBe(200);
    expect(res.body.sensitivity).toBe('internal');
  });

  it('200 sensor_telemetry → internal', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ category: 'sensor_telemetry' });
    expect(res.status).toBe(200);
    expect(res.body.sensitivity).toBe('internal');
  });

  it('200 communication_log → internal', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ category: 'communication_log' });
    expect(res.status).toBe(200);
    expect(res.body.sensitivity).toBe('internal');
  });

  it('200 document_version → internal', async () => {
    seedMembership();
    const res = await request(app)
      .post(url())
      .set('x-test-uid', MEMBER_UID)
      .send({ category: 'document_version' });
    expect(res.status).toBe(200);
    expect(res.body.sensitivity).toBe('internal');
  });
});
