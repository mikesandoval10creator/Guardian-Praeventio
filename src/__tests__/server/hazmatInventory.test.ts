// Praeventio Guard — Plan v3 Fase 1: real-router supertest for
// src/server/routes/hazmatInventory.ts (Sprint 39 G.1 — 7 endpoints, 0 prior
// real-router coverage). Mounts the ACTUAL production router so every
// middleware in the chain (verifyAuth → idempotencyKey → validate → guard →
// auditStorageLocation/buildSpillPlan) runs. The engine itself is
// deterministic pure-compute so no Firestore writes are expected here; only
// assertProjectMember reads projects/<id> via the fake.
//
// Compliance note (DS 43/2016): the spill-plan endpoint RECOMMENDS response
// steps — we assert it is advisory only (no machinery "blocked" flags).
//
// Mounted at: app.use('/api/sprint-k', hazmatInventoryRouter)
//   → POST /api/sprint-k/:projectId/hazmat/substance
//   → POST /api/sprint-k/:projectId/hazmat/substance/get
//   → POST /api/sprint-k/:projectId/hazmat/inventory
//   → POST /api/sprint-k/:projectId/hazmat/substance/update
//   → POST /api/sprint-k/:projectId/hazmat/substance/delete
//   → POST /api/sprint-k/:projectId/hazmat/compatibility-check
//   → POST /api/sprint-k/:projectId/hazmat/spill-plan

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import type { HazmatItem } from '../../services/hazmat/hazmatInventory.js';

// ── fakeFirestore holder (vi.hoisted so the vi.mock factory can close over it)
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  // No auth claims needed by the route (it only calls admin.firestore() inside
  // assertProjectMember; auth is handled by our verifyAuth mock below).
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

// idempotencyKey: pass-through (we test the business logic, not the cache layer).
vi.mock('../../server/middleware/idempotencyKey.js', () => ({
  idempotencyKey: () => (_req: Request, _res: Response, next: NextFunction) => next(),
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

import hazmatInventoryRouter from '../../server/routes/hazmatInventory.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── App factory ─────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', hazmatInventoryRouter);
  return app;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const PROJECT = 'proj-hazmat';

/** Seed the fake Firestore so assertProjectMember passes for uid 'member'. */
function seedMembership(uid: string = 'member') {
  H.db!._seed(`projects/${PROJECT}`, {
    members: [uid],
    createdBy: uid,
    name: 'Proyecto Hazmat Test',
  });
}

function mkItem(
  id: string,
  name: string,
  classes: HazmatItem['hazardClasses'],
  overrides: Partial<HazmatItem> = {},
): HazmatItem {
  return {
    id,
    name,
    hazardClasses: classes,
    stockQty: 10,
    stockUnit: 'L',
    locationId: 'loc-A',
    requiredEpp: ['guantes nitrilo'],
    ...overrides,
  };
}

// ── beforeEach ───────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
});

// ── 401 guards (one per endpoint) ─────────────────────────────────────────

describe('401 — all endpoints require authentication', () => {
  const paths = [
    [`/api/sprint-k/${PROJECT}/hazmat/substance`, { item: mkItem('1', 'X', ['toxic']) }],
    [`/api/sprint-k/${PROJECT}/hazmat/substance/get`, { itemId: '1', inventory: [] }],
    [`/api/sprint-k/${PROJECT}/hazmat/inventory`, { inventory: [] }],
    [`/api/sprint-k/${PROJECT}/hazmat/substance/update`, { item: mkItem('1', 'X', ['toxic']), inventory: [] }],
    [`/api/sprint-k/${PROJECT}/hazmat/substance/delete`, { itemId: '1', inventory: [] }],
    [`/api/sprint-k/${PROJECT}/hazmat/compatibility-check`, { inventory: [] }],
    [`/api/sprint-k/${PROJECT}/hazmat/spill-plan`, { item: mkItem('1', 'X', ['toxic']) }],
  ] as const;

  for (const [path, body] of paths) {
    it(`POST ${path} → 401 without token`, async () => {
      const res = await request(buildApp()).post(path as string).send(body);
      expect(res.status).toBe(401);
    });
  }
});

// ── 403 — project membership guard ──────────────────────────────────────────

describe('403 — non-member is rejected', () => {
  it('POST substance → 403 when caller is not in project members[]', async () => {
    seedMembership('member'); // 'outsider' is NOT seeded
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/substance`)
      .set('x-test-uid', 'outsider')
      .send({ item: mkItem('1', 'Acetona', ['flammable']) });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ── 400 — Zod validation (validate middleware) ─────────────────────────────

describe('400 — invalid_payload (Zod)', () => {
  beforeEach(() => seedMembership());

  it('POST substance → 400 when item has empty hazardClasses (min 1)', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/substance`)
      .set('x-test-uid', 'member')
      .send({ item: { ...mkItem('1', 'X', ['toxic']), hazardClasses: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('POST inventory → 400 when inventory field is missing', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/inventory`)
      .set('x-test-uid', 'member')
      .send({}); // no inventory
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('POST spill-plan → 400 when item is missing entirely', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/spill-plan`)
      .set('x-test-uid', 'member')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// ── POST /:projectId/hazmat/substance — add ────────────────────────────────

describe('POST /:projectId/hazmat/substance (add)', () => {
  beforeEach(() => seedMembership());

  it('200 — adds item to empty inventory, returns next-state inventory + issues', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/substance`)
      .set('x-test-uid', 'member')
      .send({ item: mkItem('1', 'Gasolina', ['flammable']) });
    expect(res.status).toBe(200);
    expect(res.body.item.id).toBe('1');
    expect(res.body.inventory).toHaveLength(1);
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('200 — detects incompatible co-location (flammable + oxidizer same loc)', async () => {
    const existing = mkItem('1', 'Gasolina', ['flammable'], { locationId: 'loc-A' });
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/substance`)
      .set('x-test-uid', 'member')
      .send({
        item: mkItem('2', 'Cloro', ['oxidizer'], { locationId: 'loc-A' }),
        inventory: [existing],
      });
    expect(res.status).toBe(200);
    expect(res.body.inventory).toHaveLength(2);
    expect(res.body.issues.length).toBeGreaterThan(0);
    expect(res.body.issues[0].level).toBe('incompatible');
  });

  it('409 — duplicate_substance_id when same id already in inventory', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/substance`)
      .set('x-test-uid', 'member')
      .send({
        item: mkItem('dup', 'Gasolina', ['flammable']),
        inventory: [mkItem('dup', 'Gasolina', ['flammable'])],
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('duplicate_substance_id');
  });
});

// ── POST /:projectId/hazmat/substance/get — lookup ─────────────────────────

describe('POST /:projectId/hazmat/substance/get (lookup)', () => {
  beforeEach(() => seedMembership());

  it('200 — returns matching item from supplied inventory', async () => {
    const inventory = [
      mkItem('a1', 'Acetona', ['flammable']),
      mkItem('a2', 'Ácido Clorhídrico', ['corrosive']),
    ];
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/substance/get`)
      .set('x-test-uid', 'member')
      .send({ itemId: 'a2', inventory });
    expect(res.status).toBe(200);
    expect(res.body.item.id).toBe('a2');
    expect(res.body.item.name).toBe('Ácido Clorhídrico');
  });

  it('404 — substance_not_found when itemId is absent from inventory', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/substance/get`)
      .set('x-test-uid', 'member')
      .send({ itemId: 'ghost', inventory: [mkItem('a1', 'Acetona', ['flammable'])] });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('substance_not_found');
  });
});

// ── POST /:projectId/hazmat/inventory — list + filters ────────────────────

describe('POST /:projectId/hazmat/inventory (list)', () => {
  beforeEach(() => seedMembership());

  const baseInventory: HazmatItem[] = [
    mkItem('1', 'Gasolina', ['flammable'], { locationId: 'loc-A' }),
    mkItem('2', 'Ácido sulfúrico', ['corrosive'], { locationId: 'loc-B' }),
    mkItem('3', 'Cloro', ['oxidizer'], { locationId: 'loc-A' }),
    mkItem('4', 'Acetona', ['flammable'], { cas: '67-64-1', locationId: 'loc-C' }),
  ];

  it('200 — returns full list when no filters', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/inventory`)
      .set('x-test-uid', 'member')
      .send({ inventory: baseInventory });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.items).toHaveLength(4);
  });

  it('200 — filters by locationId', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/inventory`)
      .set('x-test-uid', 'member')
      .send({ inventory: baseInventory, filters: { locationId: 'loc-A' } });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((i: HazmatItem) => i.id).sort()).toEqual(['1', '3']);
  });

  it('200 — filters by hazardClass', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/inventory`)
      .set('x-test-uid', 'member')
      .send({ inventory: baseInventory, filters: { hazardClass: 'flammable' } });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items.map((i: HazmatItem) => i.id).sort()).toEqual(['1', '4']);
  });

  it('200 — search matches name (case-insensitive)', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/inventory`)
      .set('x-test-uid', 'member')
      .send({ inventory: baseInventory, filters: { search: 'aceton' } });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].id).toBe('4');
  });

  it('200 — search matches CAS number', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/inventory`)
      .set('x-test-uid', 'member')
      .send({ inventory: baseInventory, filters: { search: '67-64-1' } });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].id).toBe('4');
  });

  it('200 — expiringWithinDays surfaces items inside horizon only', async () => {
    const inventory: HazmatItem[] = [
      mkItem('exp-soon', 'A', ['toxic'], { expiresAt: '2026-05-25T00:00:00Z' }),
      mkItem('exp-later', 'B', ['toxic'], { expiresAt: '2027-06-01T00:00:00Z' }),
      mkItem('no-exp', 'C', ['toxic']),
    ];
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/inventory`)
      .set('x-test-uid', 'member')
      .send({
        inventory,
        now: '2026-05-19T00:00:00Z',
        filters: { expiringWithinDays: 30 },
      });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].id).toBe('exp-soon');
  });
});

// ── POST /:projectId/hazmat/substance/update — replace ────────────────────

describe('POST /:projectId/hazmat/substance/update (update)', () => {
  beforeEach(() => seedMembership());

  it('200 — replaces item by id, returns updated inventory + recomputed issues', async () => {
    const inventory = [mkItem('1', 'Gasolina', ['flammable'], { stockQty: 10 })];
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/substance/update`)
      .set('x-test-uid', 'member')
      .send({
        item: mkItem('1', 'Gasolina 95', ['flammable'], { stockQty: 99 }),
        inventory,
      });
    expect(res.status).toBe(200);
    expect(res.body.inventory).toHaveLength(1);
    expect(res.body.inventory[0].name).toBe('Gasolina 95');
    expect(res.body.inventory[0].stockQty).toBe(99);
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('404 — substance_not_found when id is missing from inventory', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/substance/update`)
      .set('x-test-uid', 'member')
      .send({
        item: mkItem('ghost', 'X', ['toxic']),
        inventory: [],
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('substance_not_found');
  });
});

// ── POST /:projectId/hazmat/substance/delete — remove ────────────────────

describe('POST /:projectId/hazmat/substance/delete (delete)', () => {
  beforeEach(() => seedMembership());

  it('200 — removes item by id and returns shrunk inventory', async () => {
    const inventory = [
      mkItem('1', 'Gasolina', ['flammable']),
      mkItem('2', 'Cloro', ['oxidizer']),
    ];
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/substance/delete`)
      .set('x-test-uid', 'member')
      .send({ itemId: '1', inventory });
    expect(res.status).toBe(200);
    expect(res.body.itemId).toBe('1');
    expect(res.body.inventory).toHaveLength(1);
    expect(res.body.inventory[0].id).toBe('2');
  });

  it('404 — substance_not_found when itemId absent from inventory', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/substance/delete`)
      .set('x-test-uid', 'member')
      .send({
        itemId: 'ghost',
        inventory: [mkItem('1', 'Gasolina', ['flammable'])],
      });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('substance_not_found');
  });
});

// ── POST /:projectId/hazmat/compatibility-check ────────────────────────────

describe('POST /:projectId/hazmat/compatibility-check', () => {
  beforeEach(() => seedMembership());

  it('200 — empty inventory yields zero issues', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/compatibility-check`)
      .set('x-test-uid', 'member')
      .send({ inventory: [] });
    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(0);
    expect(res.body.summary).toEqual({ total: 0, incompatible: 0, caution: 0 });
  });

  it('200 — detects incompatible (flammable+oxidizer) and caution (flammable+corrosive)', async () => {
    const inventory: HazmatItem[] = [
      mkItem('1', 'Gasolina', ['flammable'], { locationId: 'loc-A' }),
      mkItem('2', 'Cloro', ['oxidizer'], { locationId: 'loc-A' }),
      mkItem('3', 'Ácido sulfúrico', ['corrosive'], { locationId: 'loc-A' }),
    ];
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/compatibility-check`)
      .set('x-test-uid', 'member')
      .send({ inventory });
    expect(res.status).toBe(200);
    expect(res.body.summary.incompatible).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.caution).toBeGreaterThanOrEqual(1);
    expect(res.body.summary.total).toBe(
      res.body.summary.incompatible + res.body.summary.caution,
    );
  });

  it('200 — items in different locations are not flagged as incompatible', async () => {
    const inventory: HazmatItem[] = [
      mkItem('1', 'Gasolina', ['flammable'], { locationId: 'loc-A' }),
      mkItem('2', 'Cloro', ['oxidizer'], { locationId: 'loc-B' }), // different location
    ];
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/compatibility-check`)
      .set('x-test-uid', 'member')
      .send({ inventory });
    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveLength(0);
  });
});

// ── POST /:projectId/hazmat/spill-plan ────────────────────────────────────

describe('POST /:projectId/hazmat/spill-plan', () => {
  beforeEach(() => seedMembership());

  it('200 — returns flammable-specific plan for a flammable item', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/spill-plan`)
      .set('x-test-uid', 'member')
      .send({ item: mkItem('1', 'Gasolina', ['flammable']) });
    expect(res.status).toBe(200);
    expect(res.body.plan.itemName).toBe('Gasolina');
    expect(res.body.plan.emergencyContact).toMatch(/Bomberos/);
    expect(res.body.plan.steps.length).toBeGreaterThan(0);
    expect(res.body.plan.absorbentMaterial).toBeDefined();
    expect(res.body.plan.disposalRoute).toBeDefined();
  });

  it('200 — returns corrosive-specific plan for a corrosive item', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/spill-plan`)
      .set('x-test-uid', 'member')
      .send({ item: mkItem('2', 'Ácido Clorhídrico', ['corrosive']) });
    expect(res.status).toBe(200);
    expect(res.body.plan.steps.length).toBeGreaterThan(0);
    // The plan RECOMMENDS actions — it must NEVER encode a hard machinery-block flag.
    for (const step of res.body.plan.steps as string[]) {
      expect(step.toLowerCase()).not.toMatch(/bloqueado|blocked|hard.?stop/);
    }
  });

  it('200 — returns generic fallback plan for an unknown/other class', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/spill-plan`)
      .set('x-test-uid', 'member')
      .send({ item: mkItem('3', 'Sustancia desconocida', ['other']) });
    expect(res.status).toBe(200);
    expect(res.body.plan.steps).toBeDefined();
    expect(res.body.plan.steps.length).toBeGreaterThan(0);
    // Generic fallback still RECOMMENDS contacting a specialist — advisory, not blocking.
    const stepsText = (res.body.plan.steps as string[]).join(' ').toLowerCase();
    expect(stepsText).not.toMatch(/bloqueado|blocked/);
  });

  it('200 — plan includes requiredEpp from the item', async () => {
    const item = mkItem('4', 'Cloro gas', ['toxic'], {
      requiredEpp: ['respirador P100', 'traje Tyvek', 'guantes nitrilo'],
    });
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT}/hazmat/spill-plan`)
      .set('x-test-uid', 'member')
      .send({ item });
    expect(res.status).toBe(200);
    expect(res.body.plan.requiredEpp).toEqual(item.requiredEpp);
  });
});
