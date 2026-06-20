// Real-router supertest for F.29 incident-trend indicators. Pure analytics
// over the incidents collection (top-level + nested), so this covers the real
// math: windowing, severity-weighted buckets, leading indicators (near-miss
// ratio, closure rate, avg days open), de-dup across paths, and the trend
// regression gate. Mounts the actual router via fakeFirestore.

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
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

import trendsRouter from '../../server/routes/incidentTrends.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { assertProjectMember, ProjectMembershipError } from '../../services/auth/projectMembership.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', trendsRouter);
  return app;
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString();
const get = (q = '') =>
  request(buildApp()).get(`/api/sprint-k/p1/incidents/trends${q}`).set('x-test-uid', 'u1');

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1', name: 'Faena' });
});

describe('GET /api/sprint-k/:projectId/incidents/trends', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/sprint-k/p1/incidents/trends');
    expect(res.status).toBe(401);
  });

  it('403 for a non-member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('nope'));
    const res = await get();
    expect(res.status).toBe(403);
  });

  it('404 when the tenant cannot be resolved', async () => {
    H.db!._seed('projects/p1', { name: 'no tenant' });
    const res = await get();
    expect(res.status).toBe(404);
  });

  it('computes totals + leading indicators over the window', async () => {
    H.db!._seed('incidents/i1', { projectId: 'p1', occurredAt: daysAgo(10), severity: 'alta', status: 'open' });
    H.db!._seed('incidents/i2', { projectId: 'p1', occurredAt: daysAgo(10), severity: 'critical', status: 'closed', closedAt: daysAgo(8) });
    H.db!._seed('incidents/i3', { projectId: 'p1', occurredAt: daysAgo(9), incidentType: 'near_miss', severity: 'baja' });
    H.db!._seed('incidents/i4', { projectId: 'p1', occurredAt: daysAgo(10), type: 'caida', severity: 'media', status: 'resolved', resolvedAt: daysAgo(9) });

    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.totalIncidents).toBe(4);
    expect(res.body.leading.nearMissRatio).toBe(0.25); // 1/4
    expect(res.body.leading.closureRate).toBe(0.5); // i2 + i4
    expect(res.body.leading.averageDaysOpen).toBe(1.5); // (2 + 1) / 2
    expect(res.body.window).toBe('12m');
    expect(res.body.group).toBe('month');
    expect(['improving', 'stable', 'worsening']).toContain(res.body.trend);
  });

  it('honors ?window and ?group query params', async () => {
    const res = await get('?window=3m&group=week');
    expect(res.body.window).toBe('3m');
    expect(res.body.group).toBe('week');
  });

  it('excludes incidents older than the window', async () => {
    H.db!._seed('incidents/old', { projectId: 'p1', occurredAt: '2019-01-01T00:00:00.000Z', severity: 'alta' });
    const res = await get('?window=3m');
    expect(res.body.totalIncidents).toBe(0);
  });

  it('de-duplicates the same incident id across top-level and nested paths', async () => {
    H.db!._seed('incidents/dup', { projectId: 'p1', occurredAt: daysAgo(5), severity: 'media' });
    H.db!._seed('tenants/t1/projects/p1/incidents/dup', { projectId: 'p1', occurredAt: daysAgo(5), severity: 'media' });
    H.db!._seed('incidents/solo', { projectId: 'p1', occurredAt: daysAgo(5), severity: 'media' });
    const res = await get();
    expect(res.body.totalIncidents).toBe(2); // dup counted once + solo
  });
});

// ── F3 — GET /:projectId/incidents/list (Incident Flow Hub) ──────────────
const list = (q = '') =>
  request(buildApp()).get(`/api/sprint-k/p1/incidents/list${q}`).set('x-test-uid', 'u1');

describe('GET /api/sprint-k/:projectId/incidents/list', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/sprint-k/p1/incidents/list');
    expect(res.status).toBe(401);
  });

  it('403 for a non-member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValue(new ProjectMembershipError('nope'));
    const res = await list();
    expect(res.status).toBe(403);
  });

  it('404 when the tenant cannot be resolved', async () => {
    H.db!._seed('projects/p1', { name: 'no tenant' });
    const res = await list();
    expect(res.status).toBe(404);
  });

  it('returns the real incidents with mapped fields, newest first', async () => {
    H.db!._seed('incidents/i1', {
      projectId: 'p1',
      occurredAt: daysAgo(2),
      severity: 'high',
      type: 'caida',
      status: 'open',
      description: 'Caída en plataforma',
      location: 'Sector C',
    });
    H.db!._seed('incidents/i2', {
      projectId: 'p1',
      occurredAt: daysAgo(10),
      severity: 'baja',
      incidentType: 'near_miss',
    });
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    // Newest first → i1 before i2.
    expect(res.body.incidents.map((x: { id: string }) => x.id)).toEqual(['i1', 'i2']);
    const i1 = res.body.incidents[0];
    expect(i1.severity).toBe('high');
    expect(i1.incidentType).toBe('caida'); // type → incidentType fallback
    expect(i1.status).toBe('open');
    expect(i1.summary).toBe('Caída en plataforma'); // description → summary fallback
    expect(i1.location).toBe('Sector C');
    expect(i1.nearMiss).toBe(false);
    expect(res.body.incidents[1].nearMiss).toBe(true); // i2 is a near-miss
  });

  it('de-duplicates across top-level and nested paths', async () => {
    H.db!._seed('incidents/dup', { projectId: 'p1', occurredAt: daysAgo(3), severity: 'media' });
    H.db!._seed('tenants/t1/projects/p1/incidents/dup', { projectId: 'p1', occurredAt: daysAgo(3), severity: 'media' });
    H.db!._seed('incidents/solo', { projectId: 'p1', occurredAt: daysAgo(4), severity: 'media' });
    const res = await list();
    expect(res.body.total).toBe(2);
  });

  it('honors ?limit (clamped) and returns an honest empty list', async () => {
    const empty = await list();
    expect(empty.status).toBe(200);
    expect(empty.body.total).toBe(0);
    expect(empty.body.incidents).toEqual([]);

    H.db!._seed('incidents/a', { projectId: 'p1', occurredAt: daysAgo(1), severity: 'low' });
    H.db!._seed('incidents/b', { projectId: 'p1', occurredAt: daysAgo(2), severity: 'low' });
    const res = await list('?limit=1');
    expect(res.body.total).toBe(2); // total reflects all
    expect(res.body.incidents).toHaveLength(1); // page limited to 1
  });
});
