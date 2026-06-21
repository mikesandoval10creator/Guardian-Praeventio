// Real-router supertest for the Waste Inventory HTTP surface
// (src/server/routes/waste.ts). One GET endpoint:
//
//   GET /:projectId/waste/inventory → { wastes, pendingManifests, permits }
//
// The router's `guard` runs the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the
// project (never by mocking the gate). After membership it reads the
// project's `tenantId` field — a project with no tenantId yields 404
// (`tenant_not_found`). The REAL `WasteAdapter` then reads the tenant-scoped
// subcollections; its filtering (in-stock = no manifestId, pending = no
// receivedAt) and permit ordering (by expiresAt asc) run unmocked, so the
// 200 assertions pin the adapter's real shape rather than reimplementing it.
//
// verifyAuth + logger + observability are mocked; the adapter + engine run
// unmocked so every 200 asserts real persistence output.

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

import wasteRouter from '../../server/routes/waste.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import type {
  WasteRecord,
  WasteManifest,
  EnvironmentalPermit,
} from '../../services/environmental/environmentalCompliance.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', wasteRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };
const TID = 't1';

// Tenant-scoped subcollection paths the REAL WasteAdapter reads from.
const wastePath = (id: string) => `tenants/${TID}/projects/p1/waste_records/${id}`;
const manifestPath = (id: string) => `tenants/${TID}/projects/p1/waste_manifests/${id}`;
const permitPath = (id: string) => `tenants/${TID}/projects/p1/environmental_permits/${id}`;

// In-stock record (no manifestId → listInStock keeps it).
const inStock: WasteRecord = {
  id: 'w-stock',
  kind: 'hazardous',
  wasteCode: 'SISS-101',
  description: 'Aceite usado',
  quantityKg: 42,
  generatedAt: '2026-05-01T00:00:00.000Z',
  storageLocation: 'Bodega A',
};
// Dispatched record (has manifestId → listInStock filters it OUT).
const dispatched: WasteRecord = {
  id: 'w-gone',
  kind: 'recyclable',
  description: 'Chatarra',
  quantityKg: 10,
  generatedAt: '2026-05-02T00:00:00.000Z',
  storageLocation: 'Bodega B',
  manifestId: 'm-received',
};
// Pending manifest (no receivedAt → listManifestsPendingReception keeps it).
const pendingManifest: WasteManifest = {
  id: 'm-pending',
  wasteIds: ['w-stock'],
  transporterId: 'tr-1',
  receiverId: 'rc-1',
  dispatchedAt: '2026-05-03T00:00:00.000Z',
  hasDiscrepancy: false,
};
// Received manifest (has receivedAt → filtered OUT of pending).
const receivedManifest: WasteManifest = {
  id: 'm-received',
  wasteIds: ['w-gone'],
  transporterId: 'tr-2',
  receiverId: 'rc-2',
  dispatchedAt: '2026-05-02T00:00:00.000Z',
  receivedAt: '2026-05-04T00:00:00.000Z',
  hasDiscrepancy: false,
};
// Two permits seeded out of order; listPermits orders by expiresAt asc.
const permitLate: EnvironmentalPermit = {
  id: 'p-late',
  kind: 'RCA',
  issuedAt: '2025-01-01T00:00:00.000Z',
  expiresAt: '2027-12-31T00:00:00.000Z',
  reference: 'RCA-999',
};
const permitEarly: EnvironmentalPermit = {
  id: 'p-early',
  kind: 'DIA',
  issuedAt: '2025-01-01T00:00:00.000Z',
  expiresAt: '2026-08-01T00:00:00.000Z',
  reference: 'DIA-111',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1 (which carries a tenantId).
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner', tenantId: TID });
  // p2 exists but excludes u1.
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner', tenantId: TID });
  // p3: u1 IS a member, but the project has NO tenantId → 404 tenant_not_found.
  H.db._seed('projects/p3', { members: ['u1'], createdBy: 'owner' });
});

describe('GET /:projectId/waste/inventory', () => {
  const url = '/api/sprint-k/p1/waste/inventory';

  it('401 without auth', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .get('/api/sprint-k/p2/waste/inventory')
      .set(uid);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .get('/api/sprint-k/ghost/waste/inventory')
      .set(uid);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when the project has no tenantId', async () => {
    const res = await request(buildApp())
      .get('/api/sprint-k/p3/waste/inventory')
      .set(uid);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 returns only in-stock wastes, pending manifests, and permits ordered by expiry', async () => {
    H.db!._seed(wastePath(inStock.id), inStock as unknown as Record<string, unknown>);
    H.db!._seed(wastePath(dispatched.id), dispatched as unknown as Record<string, unknown>);
    H.db!._seed(manifestPath(pendingManifest.id), pendingManifest as unknown as Record<string, unknown>);
    H.db!._seed(manifestPath(receivedManifest.id), receivedManifest as unknown as Record<string, unknown>);
    // Seed late first, early second — proves the adapter orders, not insertion.
    H.db!._seed(permitPath(permitLate.id), permitLate as unknown as Record<string, unknown>);
    H.db!._seed(permitPath(permitEarly.id), permitEarly as unknown as Record<string, unknown>);

    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(200);

    // wastes = only records WITHOUT a manifestId (the real listInStock filter).
    expect(res.body.wastes).toHaveLength(1);
    expect(res.body.wastes[0].id).toBe('w-stock');
    expect(res.body.wastes[0].quantityKg).toBe(42);
    // The dispatched record (manifestId set) must NOT appear.
    expect(res.body.wastes.some((w: WasteRecord) => w.id === 'w-gone')).toBe(false);

    // pendingManifests = only manifests WITHOUT receivedAt.
    expect(res.body.pendingManifests).toHaveLength(1);
    expect(res.body.pendingManifests[0].id).toBe('m-pending');
    expect(res.body.pendingManifests.some((m: WasteManifest) => m.id === 'm-received')).toBe(false);

    // permits ordered ascending by expiresAt — early (2026) before late (2027).
    expect(res.body.permits.map((p: EnvironmentalPermit) => p.id)).toEqual([
      'p-early',
      'p-late',
    ]);
  });

  it('200 returns empty arrays when the tenant has no waste data', async () => {
    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ wastes: [], pendingManifests: [], permits: [] });
  });

  it('200 is tenant-isolated: data under another tenant is not returned', async () => {
    // Seed a waste record under a DIFFERENT tenant but the same project id.
    H.db!._seed(
      `tenants/other-tenant/projects/p1/waste_records/leak`,
      { ...inStock, id: 'leak' } as unknown as Record<string, unknown>,
    );
    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(200);
    expect(res.body.wastes).toEqual([]);
  });

  it('500 with no internals leaked when Firestore reads fail', async () => {
    // Membership + tenant resolution succeed (project doc reads ok), then the
    // adapter's subcollection reads fail — exercises the catch → internal_error.
    H.db!._failReads('waste_records');
    const res = await request(buildApp()).get(url).set(uid);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal_error' });
    // No stack / no raw message leaked.
    expect(JSON.stringify(res.body)).not.toMatch(/forced read failure/);
  });
});
