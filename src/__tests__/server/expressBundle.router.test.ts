// Real-router supertest for the Express Bundle (PDF audit index) HTTP surface
// (src/server/routes/expressBundle.ts). One stateless POST endpoint over the
// pure-compute engine in src/services/audit/expressBundleBuilder.ts:
//
//   POST /:projectId/express-bundle/build
//     body: { projectName, generatedBy, data }
//     200:  { manifest: { generatedAt, complianceSnapshot, summary, indexPdfBase64 } }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore — 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs UNMOCKED so every 200 asserts real compute. The engine
// generates a real PDF via pdfkit; we only assert the manifest shape (counts +
// base64 string) so no PDF decoding is needed.

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
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import expressBundleRouter from '../../server/routes/expressBundle.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', expressBundleRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

/** Minimal valid compliance snapshot. */
const minimalCompliance = {
  overall: 'green' as const,
  byCategory: [
    {
      category: 'training',
      light: 'green' as const,
      summary: 'All trainings current',
      criticalItemIds: [],
      warningCount: 0,
    },
  ],
  score: 95,
  computedAt: '2026-06-22T00:00:00.000Z',
};

/** Minimal valid body for the build endpoint. */
function buildBody(over: Record<string, unknown> = {}) {
  return {
    projectName: 'Faena Norte',
    generatedBy: {
      fullName: 'Ana González',
      role: 'Prevencionista',
    },
    data: {
      documents: [
        { id: 'doc1', type: 'RIOHS', title: 'Reglamento', status: 'vigente' },
      ],
      iperMatrix: [
        { id: 'iper1', risk: 'Caída de altura', severity: 'high', mitigation: 'Arnés' },
      ],
      trainings: [
        { id: 'tr1', course: 'Inducción', workerName: 'Pedro', workerRut: '11.111.111-1', status: 'vigente' },
        { id: 'tr2', course: 'EPP', workerName: 'María', workerRut: '22.222.222-2', status: 'vencido' },
      ],
      eppAssignments: [
        { workerName: 'Pedro', workerRut: '11.111.111-1', items: [{ label: 'Casco', receivedAt: '2026-01-01' }] },
      ],
      activeWorkers: [
        { uid: 'w1', fullName: 'Pedro López', rut: '11.111.111-1', role: 'Operario' },
      ],
      applicableProtocols: [],
      photoEvidences: [],
      recentAuditLogs: [
        { action: 'incident.create', timestamp: '2026-06-01T10:00:00.000Z', userId: 'u1' },
      ],
      complianceSnapshot: minimalCompliance,
    },
    ...over,
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// ────────────────────────────────────────────────────────────────────────
// 1. express-bundle/build
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/express-bundle/build', () => {
  const url = '/api/p1/express-bundle/build';

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send(buildBody());
    expect(res.status).toBe(401);
  });

  it('200 returns manifest with correct summary counts derived from real engine', async () => {
    // Engine computes summary from input arrays:
    //   documentsCount = 1, iperItems = 1, trainings.vigentes = 1, vencidos = 1,
    //   eppAssignments = 1, activeWorkers = 1, applicableProtocols = 0,
    //   photoEvidences = 0, recentAuditLogs = 1, fileCount = 1+0+1 = 2
    const res = await request(buildApp()).post(url).set(uid).send(buildBody());
    expect(res.status).toBe(200);

    const { manifest } = res.body as {
      manifest: {
        generatedAt: string;
        complianceSnapshot: typeof minimalCompliance;
        summary: {
          documentsCount: number;
          iperItems: number;
          trainings: { vigentes: number; vencidos: number };
          eppAssignments: number;
          activeWorkers: number;
          applicableProtocols: number;
          photoEvidences: number;
          recentAuditLogs: number;
          fileCount: number;
        };
        indexPdfBase64: string;
      };
    };

    // Summary counts must reflect the real engine computation.
    expect(manifest.summary.documentsCount).toBe(1);
    expect(manifest.summary.iperItems).toBe(1);
    expect(manifest.summary.trainings).toEqual({ vigentes: 1, vencidos: 1 });
    expect(manifest.summary.eppAssignments).toBe(1);
    expect(manifest.summary.activeWorkers).toBe(1);
    expect(manifest.summary.applicableProtocols).toBe(0);
    expect(manifest.summary.photoEvidences).toBe(0);
    expect(manifest.summary.recentAuditLogs).toBe(1);
    // fileCount = documents(1) + photoEvidences(0) + 1 (index PDF itself)
    expect(manifest.summary.fileCount).toBe(2);

    // Compliance snapshot echoed verbatim.
    expect(manifest.complianceSnapshot.overall).toBe('green');
    expect(manifest.complianceSnapshot.score).toBe(95);

    // generatedAt is a server-side ISO timestamp (not from body).
    expect(typeof manifest.generatedAt).toBe('string');
    expect(() => new Date(manifest.generatedAt)).not.toThrow();

    // indexPdfBase64 must be a non-empty base64 string (real pdfkit output).
    expect(typeof manifest.indexPdfBase64).toBe('string');
    expect(manifest.indexPdfBase64.length).toBeGreaterThan(100);
    // Validate it decodes to a PDF (magic bytes %PDF).
    const pdfStart = Buffer.from(manifest.indexPdfBase64, 'base64').toString('ascii', 0, 4);
    expect(pdfStart).toBe('%PDF');
  });

  it('200 with multiple protocols: summary.applicableProtocols reflects real engine count', async () => {
    const base = buildBody();
    const body = {
      ...base,
      data: {
        ...base.data,
        applicableProtocols: [
          {
            ruleId: 'r1',
            category: 'training',
            recommendation: 'Hacer capacitación',
            legalCitation: 'DS 594 art. 53',
            urgency: 'critical',
          },
          {
            ruleId: 'r2',
            category: 'committee',
            recommendation: 'Constituir CPHS',
            legalCitation: 'Ley 16.744 art. 66',
            urgency: 'recommended',
          },
        ],
      },
    };
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    expect(res.body.manifest.summary.applicableProtocols).toBe(2);
  });

  it('200 with empty data arrays: summary counts are all zero (no divide-by-zero)', async () => {
    const emptyCompliance = {
      overall: 'red' as const,
      byCategory: [],
      score: 0,
      computedAt: '2026-06-22T00:00:00.000Z',
    };
    const body = {
      projectName: 'Vacía',
      generatedBy: { fullName: 'A', role: 'B' },
      data: {
        documents: [],
        iperMatrix: [],
        trainings: [],
        eppAssignments: [],
        activeWorkers: [],
        applicableProtocols: [],
        photoEvidences: [],
        recentAuditLogs: [],
        complianceSnapshot: emptyCompliance,
      },
    };
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(200);
    expect(res.body.manifest.summary.documentsCount).toBe(0);
    expect(res.body.manifest.summary.trainings).toEqual({ vigentes: 0, vencidos: 0 });
    // fileCount = 0 + 0 + 1 (index PDF itself)
    expect(res.body.manifest.summary.fileCount).toBe(1);
  });

  it('400 when projectName is missing', async () => {
    const { projectName: _omit, ...body } = buildBody();
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a document has an invalid status enum', async () => {
    const base = buildBody();
    const body = {
      ...base,
      data: {
        ...base.data,
        documents: [{ id: 'd1', type: 'RIOHS', title: 'T', status: 'desconocido' }],
      },
    };
    const res = await request(buildApp()).post(url).set(uid).send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when generatedBy.fullName is missing', async () => {
    const body = buildBody();
    const { fullName: _omit, ...genBy } = body.generatedBy;
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...body, generatedBy: genBy });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/express-bundle/build')
      .set(uid)
      .send(buildBody());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/express-bundle/build')
      .set(uid)
      .send(buildBody());
    expect(res.status).toBe(403);
  });
});
