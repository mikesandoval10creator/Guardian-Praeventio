// Real-router supertest for src/server/routes/workerHistory.ts (Sprint 42 F.18).
//
// Three POST endpoints — all pure-compute (no Firestore writes):
//   POST /:projectId/worker-history/build-portable   → 200 { history }
//   POST /:projectId/worker-history/redact-pii       → 200 { history }
//   POST /:projectId/worker-history/serialize        → 200 { export }
//
// Auth chain: verifyAuth → validate(zod) → guard(assertProjectMember) → handler.
// The service functions (buildPortableHistory, redactPII, serializeAs*) are REAL
// — no mock — because they are pure functions with no I/O. Only firebase-admin,
// verifyAuth, logger, captureRouteError, and assertProjectMember are mocked.

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
      role: req.header('x-test-role') ?? undefined,
      tenantId: req.header('x-test-tenant') ?? undefined,
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

// observability — captureRouteError imports getErrorTracker internally; mock
// the whole module so tests are hermetic.
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import workerHistoryRouter from '../../server/routes/workerHistory.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Mounted at /api/sprint-k per server.ts line 1070.
  app.use('/api/sprint-k', workerHistoryRouter);
  return app;
}

// ────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ────────────────────────────────────────────────────────────────────────

const PROJECT_ID = 'proj-1';
const CALLER_UID = 'user-1';

/** Minimal valid WorkerData. */
const minimalWorker = {
  identity: { fullName: 'Juan Pérez', rut: '12345678-9' },
  employmentSpans: [
    {
      employerName: 'Minera Escondida',
      startDate: '2020-01-15',
      endDate: '2023-06-30',
      position: 'Operador',
      industry: 'minería',
    },
  ],
  completedTrainings: [
    {
      trainingCode: 'DS594-01',
      trainingName: 'Prevención de riesgos básica',
      obtainedAt: '2020-02-01',
      expiresAt: '2023-02-01',
      issuer: 'ACHS',
      hours: 8,
    },
  ],
  certifications: [
    {
      certificationCode: 'RIGGER-LVL1',
      certificationName: 'Rigger nivel 1',
      obtainedAt: '2021-03-10',
      expiresAt: '2024-03-10',
      issuer: 'SERNAGEOMIN',
      folio: 'F-001',
    },
  ],
  eppHistory: [
    {
      eppCategory: 'Casco de seguridad',
      eppModel: 'MSA V-Gard',
      deliveredAt: '2020-01-20',
      nextReplacementAt: '2022-01-20',
    },
  ],
  exposureLog: [
    { agent: 'ruido', totalHours: 480, year: 2021, averageMeasurement: 85, measurementUnit: 'dB(A)' },
  ],
};

const validBuildBody = {
  worker: minimalWorker,
  options: {
    redactionLevel: 'employer',
    exportedAt: '2024-06-01',
    requestedBy: { role: 'employer' },
  },
};

/** A pre-built PortableWorkerHistory to use in redact-pii / serialize tests. */
const sampleHistory = {
  schemaVersion: '1.0.0',
  exportedAt: '2024-06-01',
  redactionLevel: 'employer' as const,
  includesMedical: false,
  requestedBy: { uid: CALLER_UID, role: 'employer' as const },
  identity: {
    fullName: 'Juan Pérez',
    rutHash: 'abc123',
    rut: '12345678-9',
  },
  employmentSpans: minimalWorker.employmentSpans,
  completedTrainings: minimalWorker.completedTrainings,
  certifications: minimalWorker.certifications,
  eppHistory: minimalWorker.eppHistory,
  exposureLog: minimalWorker.exposureLog,
  medicalContext: 'REDACTED' as const,
  disclaimer: 'Praeventio nunca diagnostica.',
};

/** Seed the fake Firestore so assertProjectMember passes. */
function seedProject(db: ReturnType<typeof createFakeFirestore>, uid = CALLER_UID) {
  db._seed(`projects/${PROJECT_ID}`, { members: [uid], createdBy: uid });
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

// ────────────────────────────────────────────────────────────────────────
// POST /:projectId/worker-history/build-portable
// ────────────────────────────────────────────────────────────────────────

const BUILD = `/api/sprint-k/${PROJECT_ID}/worker-history/build-portable`;

describe('POST /:projectId/worker-history/build-portable', () => {
  it('401 when no token is supplied', async () => {
    const res = await request(buildApp()).post(BUILD).send(validBuildBody);
    expect(res.status).toBe(401);
  });

  it('400 when body fails Zod validation (missing worker)', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(BUILD)
      .set('x-test-uid', CALLER_UID)
      .send({ options: validBuildBody.options }); // no worker
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when options.redactionLevel is not a valid enum value', async () => {
    seedProject(H.db!);
    const body = {
      ...validBuildBody,
      options: { ...validBuildBody.options, redactionLevel: 'ultra_secret' },
    };
    const res = await request(buildApp())
      .post(BUILD)
      .set('x-test-uid', CALLER_UID)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when options.requestedBy.role is not a valid enum value', async () => {
    seedProject(H.db!);
    const body = {
      ...validBuildBody,
      options: { ...validBuildBody.options, requestedBy: { role: 'alien' } },
    };
    const res = await request(buildApp())
      .post(BUILD)
      .set('x-test-uid', CALLER_UID)
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when the caller is not a member of the project', async () => {
    // Project exists but caller is not in members / createdBy
    H.db!._seed(`projects/${PROJECT_ID}`, { members: ['other-user'], createdBy: 'other-user' });
    const res = await request(buildApp())
      .post(BUILD)
      .set('x-test-uid', CALLER_UID)
      .send(validBuildBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    // H.db is empty — project doc absent
    const res = await request(buildApp())
      .post(BUILD)
      .set('x-test-uid', CALLER_UID)
      .send(validBuildBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — returns a PortableWorkerHistory', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(BUILD)
      .set('x-test-uid', CALLER_UID)
      .send(validBuildBody);
    expect(res.status).toBe(200);
    const history = res.body.history;
    expect(history.schemaVersion).toBe('1.0.0');
    expect(history.redactionLevel).toBe('employer');
    expect(history.identity.fullName).toBe('Juan Pérez');
    // RUT visible at 'employer' level
    expect(history.identity.rut).toBe('12345678-9');
    // rutHash must be a 64-char hex (SHA-256)
    expect(history.identity.rutHash).toMatch(/^[0-9a-f]{64}$/);
    expect(history.employmentSpans).toHaveLength(1);
    expect(history.completedTrainings).toHaveLength(1);
    expect(history.certifications).toHaveLength(1);
    expect(history.eppHistory).toHaveLength(1);
    expect(history.exposureLog).toHaveLength(1);
    // No medical included by default
    expect(history.medicalContext).toBe('REDACTED');
    expect(history.includesMedical).toBe(false);
    expect(history.disclaimer).toContain('Praeventio nunca diagnostica');
  });

  it('200 — requestedBy.uid is stamped from the verified token, not the body', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(BUILD)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...validBuildBody,
        options: {
          ...validBuildBody.options,
          requestedBy: { role: 'self' },
        },
      });
    expect(res.status).toBe(200);
    // Server forces requestedBy.uid = callerUid (the authenticated uid)
    expect(res.body.history.requestedBy.uid).toBe(CALLER_UID);
    expect(res.body.history.requestedBy.role).toBe('self');
  });

  it('200 — public redactionLevel redacts exact dates to YYYY-MM-XX and hides rut', async () => {
    seedProject(H.db!);
    const body = {
      worker: minimalWorker,
      options: {
        redactionLevel: 'public',
        exportedAt: '2024-06-01',
        requestedBy: { role: 'inspector' },
      },
    };
    const res = await request(buildApp())
      .post(BUILD)
      .set('x-test-uid', CALLER_UID)
      .send(body);
    expect(res.status).toBe(200);
    const history = res.body.history;
    expect(history.redactionLevel).toBe('public');
    // RUT in-clear is not present at public level
    expect(history.identity.rut).toBeUndefined();
    // rutHash always present
    expect(history.identity.rutHash).toMatch(/^[0-9a-f]{64}$/);
    // Dates are redacted to YYYY-MM-XX
    expect(history.employmentSpans[0].startDate).toMatch(/^\d{4}-\d{2}-XX$/);
    expect(history.certifications[0].folio).toBeUndefined();
  });

  it('200 — medical context included only when includeMedical=true AND level=medical', async () => {
    seedProject(H.db!);
    const workerWithMedical = {
      ...minimalWorker,
      medicalContext: [
        { category: 'audiometria', summary: 'Normal', recordedAt: '2023-01-01', source: 'IST' },
      ],
    };
    const body = {
      worker: workerWithMedical,
      options: {
        includeMedical: true,
        redactionLevel: 'medical',
        exportedAt: '2024-06-01',
        requestedBy: { role: 'physician' },
      },
    };
    const res = await request(buildApp())
      .post(BUILD)
      .set('x-test-uid', CALLER_UID)
      .send(body);
    expect(res.status).toBe(200);
    const history = res.body.history;
    expect(history.includesMedical).toBe(true);
    expect(Array.isArray(history.medicalContext)).toBe(true);
    expect(history.medicalContext[0].category).toBe('audiometria');
  });

  it('200 — medical context stays REDACTED when includeMedical=true but level != medical', async () => {
    seedProject(H.db!);
    const workerWithMedical = {
      ...minimalWorker,
      medicalContext: [
        { category: 'audiometria', summary: 'Hipoacusia leve', recordedAt: '2023-01-01' },
      ],
    };
    const body = {
      worker: workerWithMedical,
      options: {
        includeMedical: true,
        redactionLevel: 'employer', // not 'medical'
        exportedAt: '2024-06-01',
        requestedBy: { role: 'employer' },
      },
    };
    const res = await request(buildApp())
      .post(BUILD)
      .set('x-test-uid', CALLER_UID)
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.history.medicalContext).toBe('REDACTED');
    expect(res.body.history.includesMedical).toBe(false);
  });

  it('200 — empty worker arrays produce valid history with empty arrays', async () => {
    seedProject(H.db!);
    const emptyWorker = {
      identity: { fullName: 'Sin historial', rut: '11111111-1' },
      employmentSpans: [],
      completedTrainings: [],
      certifications: [],
      eppHistory: [],
      exposureLog: [],
    };
    const res = await request(buildApp())
      .post(BUILD)
      .set('x-test-uid', CALLER_UID)
      .send({
        worker: emptyWorker,
        options: { redactionLevel: 'employer', exportedAt: '2024-06-01', requestedBy: { role: 'self' } },
      });
    expect(res.status).toBe(200);
    expect(res.body.history.employmentSpans).toHaveLength(0);
    expect(res.body.history.completedTrainings).toHaveLength(0);
    expect(res.body.history.certifications).toHaveLength(0);
  });

  it('200 — the createdBy path qualifies as project member', async () => {
    // createdBy but NOT in members[]
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [], createdBy: CALLER_UID });
    const res = await request(buildApp())
      .post(BUILD)
      .set('x-test-uid', CALLER_UID)
      .send(validBuildBody);
    expect(res.status).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────────
// POST /:projectId/worker-history/redact-pii
// ────────────────────────────────────────────────────────────────────────

const REDACT = `/api/sprint-k/${PROJECT_ID}/worker-history/redact-pii`;

describe('POST /:projectId/worker-history/redact-pii', () => {
  it('401 when no token is supplied', async () => {
    const res = await request(buildApp())
      .post(REDACT)
      .send({ history: sampleHistory, level: 'public' });
    expect(res.status).toBe(401);
  });

  it('400 when body fails Zod validation (missing level)', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(REDACT)
      .set('x-test-uid', CALLER_UID)
      .send({ history: sampleHistory }); // no level
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when level is not a valid enum value', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(REDACT)
      .set('x-test-uid', CALLER_UID)
      .send({ history: sampleHistory, level: 'classified' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when the caller is not a project member', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: ['stranger'], createdBy: 'stranger' });
    const res = await request(buildApp())
      .post(REDACT)
      .set('x-test-uid', CALLER_UID)
      .send({ history: sampleHistory, level: 'public' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 happy path — redacts to public level', async () => {
    seedProject(H.db!);
    // Seed a history with rut in-clear (employer level)
    const employerHistory = { ...sampleHistory, rut: '12345678-9' };
    const res = await request(buildApp())
      .post(REDACT)
      .set('x-test-uid', CALLER_UID)
      .send({ history: employerHistory, level: 'public' });
    expect(res.status).toBe(200);
    const h = res.body.history;
    expect(h.redactionLevel).toBe('public');
    // After redacting to public: rut should be removed from identity
    expect(h.identity.rut).toBeUndefined();
    expect(h.medicalContext).toBe('REDACTED');
    expect(h.includesMedical).toBe(false);
  });

  it('200 happy path — redacting employer → employer is idempotent', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(REDACT)
      .set('x-test-uid', CALLER_UID)
      .send({ history: sampleHistory, level: 'employer' });
    expect(res.status).toBe(200);
    expect(res.body.history.redactionLevel).toBe('employer');
    // Medical stays REDACTED (was already REDACTED)
    expect(res.body.history.medicalContext).toBe('REDACTED');
  });

  it('200 — redacting to medical keeps medicalContext as REDACTED when already absent', async () => {
    // sampleHistory.medicalContext is already 'REDACTED', so upgrading level to 'medical'
    // cannot recover it — the original data is gone. Result: medicalContext remains 'REDACTED'.
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(REDACT)
      .set('x-test-uid', CALLER_UID)
      .send({ history: sampleHistory, level: 'medical' });
    expect(res.status).toBe(200);
    // 'medical' level does NOT re-inject medical data — it only avoids stripping it.
    // Since sampleHistory already has REDACTED, it stays REDACTED.
    const h = res.body.history;
    expect(h.redactionLevel).toBe('medical');
    expect(h.medicalContext).toBe('REDACTED');
  });
});

// ────────────────────────────────────────────────────────────────────────
// POST /:projectId/worker-history/serialize
// ────────────────────────────────────────────────────────────────────────

const SERIALIZE = `/api/sprint-k/${PROJECT_ID}/worker-history/serialize`;

describe('POST /:projectId/worker-history/serialize', () => {
  it('401 when no token is supplied', async () => {
    const res = await request(buildApp())
      .post(SERIALIZE)
      .send({ history: sampleHistory, format: 'json' });
    expect(res.status).toBe(401);
  });

  it('400 when body fails Zod validation (missing format)', async () => {
    seedProject(H.db!);
    // historySchema is now z.record(z.string(), z.unknown()), so a missing history
    // field also yields 400. This probe sends a valid history but omits format —
    // either missing field independently triggers the 400.
    const res = await request(buildApp())
      .post(SERIALIZE)
      .set('x-test-uid', CALLER_UID)
      .send({ history: sampleHistory }); // no format
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when format is not json or markdown', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(SERIALIZE)
      .set('x-test-uid', CALLER_UID)
      .send({ history: sampleHistory, format: 'xml' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when the caller is not a project member', async () => {
    H.db!._seed(`projects/${PROJECT_ID}`, { members: [], createdBy: 'someone-else' });
    const res = await request(buildApp())
      .post(SERIALIZE)
      .set('x-test-uid', CALLER_UID)
      .send({ history: sampleHistory, format: 'json' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 JSON format — returns body + checksum + contentType', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(SERIALIZE)
      .set('x-test-uid', CALLER_UID)
      .send({ history: sampleHistory, format: 'json' });
    expect(res.status).toBe(200);
    const out = res.body.export;
    expect(out.contentType).toBe('application/json');
    expect(typeof out.body).toBe('string');
    // body must be parseable JSON
    expect(() => JSON.parse(out.body)).not.toThrow();
    // checksum is a 64-char hex SHA-256
    expect(out.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('200 JSON format — canonical body is alphabetically sorted (deterministic checksum)', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(SERIALIZE)
      .set('x-test-uid', CALLER_UID)
      .send({ history: sampleHistory, format: 'json' });
    expect(res.status).toBe(200);
    const { body: rawBody } = res.body.export;
    // Canonical JSON keys are sorted — schemaVersion comes after requestedBy alphabetically
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    expect(keys).toEqual([...keys].sort());
  });

  it('200 markdown format — returns Markdown body with correct contentType', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(SERIALIZE)
      .set('x-test-uid', CALLER_UID)
      .send({ history: sampleHistory, format: 'markdown' });
    expect(res.status).toBe(200);
    const out = res.body.export;
    expect(out.contentType).toBe('text/markdown');
    expect(out.body).toContain('# Historial Profesional Portátil');
    expect(out.body).toContain('Praeventio nunca diagnostica');
    // checksum is a 64-char hex SHA-256
    expect(out.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('200 markdown — REDACTED medical context produces the expected disclaimer line', async () => {
    seedProject(H.db!);
    const res = await request(buildApp())
      .post(SERIALIZE)
      .set('x-test-uid', CALLER_UID)
      .send({ history: sampleHistory, format: 'markdown' });
    expect(res.status).toBe(200);
    expect(res.body.export.body).toContain('REDACTED');
  });

  it('200 — two identical calls produce the same checksum (determinism)', async () => {
    seedProject(H.db!);
    const payload = { history: sampleHistory, format: 'json' };
    const app = buildApp();
    const res1 = await request(app).post(SERIALIZE).set('x-test-uid', CALLER_UID).send(payload);
    const res2 = await request(app).post(SERIALIZE).set('x-test-uid', CALLER_UID).send(payload);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.export.checksum).toBe(res2.body.export.checksum);
  });
});
