// Real-router supertest for the Data Quality HTTP surface
// (src/server/routes/dataQuality.ts). Two read-only GET endpoints:
//
//   GET /:projectId/data-quality       — runs the REAL incompletenessScanner
//                                         (scanAll + pickTopGaps) over the
//                                         project's canonical collections.
//   GET /:projectId/document-hygiene    — derives DocumentRecord[] from
//                                         documents + read_receipts + nodes.
//
// The router's `guard` first calls the REAL `assertProjectMember` against the
// fakeFirestore (403 is exercised by NOT seeding the caller into the project —
// never by mocking the gate), then `resolveTenantId` which reads the project
// doc's `tenantId` (404 when absent). verifyAuth + logger + observability are
// mocked; the scanner engine runs unmocked so the response shapes are real
// compute (we assert the engine's qualityScore / gap shapes, not a reimpl).

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

import dataQualityRouter from '../../server/routes/dataQuality.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', dataQualityRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1 (which carries a tenantId so the guard
  // resolves past 404). p2 exists but excludes u1 → 403. pNoTenant has u1 as a
  // member but no tenantId → 404 from resolveTenantId.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner', tenantId: 't1' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner', tenantId: 't2' });
  H.db._seed('projects/pNoTenant', { members: ['u1'], createdBy: 'owner' });
});

describe('GET /:projectId/data-quality', () => {
  const url = '/api/p1/data-quality';

  it('401 without auth', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp()).get('/api/p2/data-quality').set(uid);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp()).get('/api/ghost/data-quality').set(uid);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when the project exists but carries no tenantId', async () => {
    const res = await request(buildApp()).get('/api/pNoTenant/data-quality').set(uid);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 with no project data → only the project-doc gaps, qualityScore from the real engine', async () => {
    // The project doc p1 itself is scanned (thisProject). It has no name/
    // industry/workersCount/location → scanProjects emits 4 gaps (2 high +
    // 2 medium). totalDocs = 1, totalWeight = 3+3+2+2 = 10, capped at 1*3.
    // ratio = min(1, 10/3) = 1 → qualityScore = 0.
    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(200);
    expect(res.body.report.qualityScore).toBe(0);
    expect(res.body.report.byDomain.project).toBe(4);
    expect(res.body.report.totalGaps).toBe(4);
    // The four project gaps cover name/industry/workersCount/location.
    const fields = (res.body.report.gaps as Array<{ field: string; domain: string }>)
      .map((g) => g.field)
      .sort();
    expect(fields).toEqual(['industry', 'location', 'name', 'workersCount']);
  });

  it('200 surfaces a worker gap from the nested projects/{id}/workers collection', async () => {
    // Give the project complete metadata so it contributes no gaps, then add
    // one worker missing fullName/cargo/industry. The scanner runs over the
    // REAL nested read path (projectRef.collection('workers')).
    H.db!._seed('projects/p1', {
      members: ['u1'],
      createdBy: 'owner',
      tenantId: 't1',
      name: 'Faena Norte',
      industry: 'mineria',
      workersCount: 12,
      coordinates: { lat: -33.4, lng: -70.6 },
    });
    H.db!._seed('projects/p1/workers/w1', { rut: '11.111.111-1' });

    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(200);
    // Project doc now clean → all gaps come from the worker.
    expect(res.body.report.byDomain.project ?? 0).toBe(0);
    const workerGaps = (res.body.report.gaps as Array<{ docId: string; domain: string; field: string }>)
      .filter((g) => g.domain === 'worker');
    expect(workerGaps.map((g) => g.field).sort()).toEqual(['cargo', 'fullName', 'industry']);
    expect(workerGaps.every((g) => g.docId === 'w1')).toBe(true);
    // topGaps is the real pickTopGaps output (severity-sorted, capped at 10).
    expect(Array.isArray(res.body.topGaps)).toBe(true);
    expect(res.body.topGaps.length).toBeLessThanOrEqual(10);
    // fullName + cargo are 'high' so they sort ahead of the 'medium' industry gap.
    expect(res.body.topGaps[0].severity).toBe('high');
  });

  it('200 normalizes incident summary→description and rootCause string→category (no false gaps)', async () => {
    // A complete project so it adds no gaps, plus one incident that uses the
    // REAL persisted aliases (summary / rootCause). The router maps them so the
    // scanner sees description + rootCauseCategory and emits ZERO incident gaps.
    H.db!._seed('projects/p1', {
      members: ['u1'],
      createdBy: 'owner',
      tenantId: 't1',
      name: 'Faena Norte',
      industry: 'mineria',
      workersCount: 12,
      coordinates: { lat: -33.4, lng: -70.6 },
    });
    H.db!._seed('incidents/inc1', {
      projectId: 'p1',
      severity: 'major',
      occurredAt: '2026-05-01T08:00:00Z',
      summary: 'Caida de altura en andamio',
      rootCause: 'procedimiento',
    });

    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(200);
    const incidentGaps = (res.body.report.gaps as Array<{ domain: string }>).filter(
      (g) => g.domain === 'incident',
    );
    expect(incidentGaps).toEqual([]);
  });

  it('200 only scans incidents scoped to the requested projectId', async () => {
    H.db!._seed('projects/p1', {
      members: ['u1'],
      createdBy: 'owner',
      tenantId: 't1',
      name: 'Faena Norte',
      industry: 'mineria',
      workersCount: 12,
      coordinates: { lat: -33.4, lng: -70.6 },
    });
    // An incident belonging to a DIFFERENT project — must not leak into p1's report.
    H.db!._seed('incidents/other', { projectId: 'p2', severity: 'minor' });

    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(200);
    expect(res.body.report.byDomain.incident ?? 0).toBe(0);
    expect(res.body.report.totalGaps).toBe(0);
    expect(res.body.report.qualityScore).toBe(100);
  });
});

describe('GET /:projectId/document-hygiene', () => {
  const url = '/api/p1/document-hygiene';

  it('401 without auth', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp()).get('/api/p2/document-hygiene').set(uid);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when the project exists but carries no tenantId', async () => {
    const res = await request(buildApp()).get('/api/pNoTenant/document-hygiene').set(uid);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 honest empty when there are no documents', async () => {
    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ documents: [] });
  });

  it('200 derives the real hygiene record from documents + receipts + nodes', async () => {
    H.db!._seed('projects/p1/documents/doc1', {
      name: 'Reglamento Interno de Orden Higiene y Seguridad',
      category: 'legal',
      version: '2.1',
      approvedByUid: 'prev1',
      approvedAt: '2026-04-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    });
    // Two acuses, one recent (counts toward 90d), one old (does not).
    const recentAck = new Date().toISOString();
    H.db!._seed('projects/p1/read_receipts/r1', {
      documentId: 'doc1',
      acknowledgedAt: recentAck,
    });
    H.db!._seed('projects/p1/read_receipts/r2', {
      documentId: 'doc1',
      acknowledgedAt: '2020-01-01T00:00:00Z',
    });
    // A DOCUMENT node wired into the risk graph for doc1.
    H.db!._seed('nodes/n1', {
      projectId: 'p1',
      type: 'document',
      metadata: { documentId: 'doc1' },
    });

    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(1);
    const d = res.body.documents[0];
    expect(d.id).toBe('doc1');
    expect(d.title).toBe('Reglamento Interno de Orden Higiene y Seguridad');
    expect(d.version).toBe('2.1');
    expect(d.approvedByUid).toBe('prev1');
    // At least one acuse → valid signature.
    expect(d.hasValidSignature).toBe(true);
    // Both receipts count toward total; only the recent one counts toward 90d.
    expect(d.readReceiptCount).toBe(2);
    expect(d.accessCount90d).toBe(1);
    // category 'legal' → references a norm.
    expect(d.referencesNorm).toBe(true);
    // The DOCUMENT node points at doc1 → linked to operations.
    expect(d.isLinkedToOperations).toBe(true);
  });

  it('200 marks an unsigned, unlinked, non-norm document with honest negatives', async () => {
    H.db!._seed('projects/p1/documents/doc2', {
      name: 'Memo interno',
      category: 'general',
      createdAt: '2026-03-01T00:00:00Z',
    });
    // A node for a DIFFERENT project must not link doc2.
    H.db!._seed('nodes/n2', {
      projectId: 'p2',
      type: 'document',
      metadata: { documentId: 'doc2' },
    });

    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(200);
    expect(res.body.documents).toHaveLength(1);
    const d = res.body.documents[0];
    expect(d.id).toBe('doc2');
    expect(d.hasValidSignature).toBe(false);
    expect(d.readReceiptCount).toBe(0);
    expect(d.accessCount90d).toBe(0);
    expect(d.referencesNorm).toBe(false);
    expect(d.isLinkedToOperations).toBe(false);
    // No version → engine default '1.0'; createdAt used as updatedAt fallback.
    expect(d.version).toBe('1.0');
    expect(d.updatedAt).toBe('2026-03-01T00:00:00Z');
  });
});
