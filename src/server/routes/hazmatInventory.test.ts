// Praeventio Guard — hazmatInventory router contract tests.
//
// Mirrors the readReceipts/visitors test pattern: a wire-up contract test
// (`router.stack` introspection) for the router export, plus a supertest
// harness that exercises the request/response surface against a minimal
// Express clone of the real handlers. The engine itself
// (`auditStorageLocation`, `buildSpillPlan`) is exercised through the
// harness so the contract verifies "JSON-in → engine → JSON-out" rather
// than re-testing pure compute that lives in the service unit tests.

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import hazmatInventoryRouter from './hazmatInventory.js';
import {
  auditStorageLocation,
  buildSpillPlan,
  type HazmatItem,
  type HazmatClass,
} from '../../services/hazmat/hazmatInventory.js';

// ────────────────────────────────────────────────────────────────────────
// Section 1 — wire-up contract (mirror of readReceipts.test.ts)
// ────────────────────────────────────────────────────────────────────────

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (hazmatInventoryRouter as unknown as { stack: Layer[] }).stack;

function hasPost(path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods.post === true,
  );
}

describe('hazmatInventoryRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(hazmatInventoryRouter).toBeDefined();
    expect(typeof hazmatInventoryRouter).toBe('function');
  });

  const paths = [
    '/:projectId/hazmat/substance',
    '/:projectId/hazmat/substance/get',
    '/:projectId/hazmat/inventory',
    '/:projectId/hazmat/substance/update',
    '/:projectId/hazmat/substance/delete',
    '/:projectId/hazmat/compatibility-check',
    '/:projectId/hazmat/spill-plan',
  ];

  for (const p of paths) {
    it(`registers POST ${p}`, () => {
      expect(hasPost(p)).toBe(true);
    });
  }
});

// ────────────────────────────────────────────────────────────────────────
// Section 2 — supertest harness (mirror of visitors.test.ts)
// ────────────────────────────────────────────────────────────────────────

interface FakeUser {
  uid: string;
}
interface HazmatTestDeps {
  users: Map<string, FakeUser>;
  /** members[projectId] = uids[] */
  memberships: Map<string, Set<string>>;
}

const hazmatClassSchema = z.enum([
  'oxidizer',
  'flammable',
  'corrosive',
  'toxic',
  'reactive_water',
  'compressed_gas',
  'explosive',
  'radioactive',
  'biohazard',
  'other',
]) as unknown as z.ZodType<HazmatClass>;

const hazmatItemSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(500),
  cas: z.string().min(1).max(50).optional(),
  unNumber: z.string().min(1).max(10).optional(),
  hazardClasses: z.array(hazmatClassSchema).min(1).max(20),
  stockQty: z.number().nonnegative().max(1_000_000_000),
  stockUnit: z.enum(['L', 'kg', 'unit']),
  locationId: z.string().min(1).max(200),
  expiresAt: z.string().min(10).optional(),
  requiredEpp: z.array(z.string().min(1).max(200)).max(50),
  sdsUrl: z.string().max(2048).optional(),
}) as unknown as z.ZodType<HazmatItem>;

const inventorySchema = z.array(hazmatItemSchema).max(10_000);

function buildHazmatApp(deps: HazmatTestDeps): Express {
  const app = express();
  app.use(express.json());

  const verifyAuth = (req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = auth.slice('Bearer '.length);
    const user = deps.users.get(token);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    req.user = user;
    next();
  };

  const guard = (callerUid: string, projectId: string, res: any): boolean => {
    const members = deps.memberships.get(projectId);
    if (!members || !members.has(callerUid)) {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    return true;
  };

  // add
  app.post(
    '/api/sprint-k/:projectId/hazmat/substance',
    verifyAuth,
    validate(z.object({ item: hazmatItemSchema, inventory: inventorySchema.optional() })),
    (req: any, res: any) => {
      if (!guard(req.user.uid, req.params.projectId, res)) return undefined;
      const body = req.validated;
      const inventory = body.inventory ?? [];
      if (inventory.some((it: HazmatItem) => it.id === body.item.id)) {
        return res.status(409).json({ error: 'duplicate_substance_id' });
      }
      const nextInventory = [...inventory, body.item];
      const issues = auditStorageLocation(nextInventory);
      return res.json({ item: body.item, inventory: nextInventory, issues });
    },
  );

  // get
  app.post(
    '/api/sprint-k/:projectId/hazmat/substance/get',
    verifyAuth,
    validate(z.object({ itemId: z.string(), inventory: inventorySchema })),
    (req: any, res: any) => {
      if (!guard(req.user.uid, req.params.projectId, res)) return undefined;
      const body = req.validated;
      const item = body.inventory.find((it: HazmatItem) => it.id === body.itemId);
      if (!item) return res.status(404).json({ error: 'substance_not_found' });
      return res.json({ item });
    },
  );

  // list
  app.post(
    '/api/sprint-k/:projectId/hazmat/inventory',
    verifyAuth,
    validate(
      z.object({
        inventory: inventorySchema,
        filters: z
          .object({
            locationId: z.string().optional(),
            hazardClass: hazmatClassSchema.optional(),
            search: z.string().optional(),
            expiringWithinDays: z.number().int().min(0).max(3650).optional(),
          })
          .optional(),
        now: z.string().optional(),
      }),
    ),
    (req: any, res: any) => {
      if (!guard(req.user.uid, req.params.projectId, res)) return undefined;
      const body = req.validated;
      const now = body.now ? new Date(body.now) : new Date();
      const filters = body.filters ?? {};
      let items: HazmatItem[] = body.inventory.slice();
      if (filters.locationId) {
        items = items.filter((it) => it.locationId === filters.locationId);
      }
      if (filters.hazardClass) {
        items = items.filter((it) =>
          it.hazardClasses.includes(filters.hazardClass as HazmatClass),
        );
      }
      if (filters.search) {
        const needle = filters.search.toLowerCase();
        items = items.filter(
          (it) =>
            it.name.toLowerCase().includes(needle) ||
            (it.cas ?? '').toLowerCase().includes(needle) ||
            (it.unNumber ?? '').toLowerCase().includes(needle),
        );
      }
      if (typeof filters.expiringWithinDays === 'number') {
        const horizonMs =
          now.getTime() + filters.expiringWithinDays * 24 * 60 * 60 * 1000;
        items = items.filter((it) => {
          if (!it.expiresAt) return false;
          const expMs = Date.parse(it.expiresAt);
          return Number.isFinite(expMs) && expMs <= horizonMs;
        });
      }
      return res.json({ items, total: items.length });
    },
  );

  // update
  app.post(
    '/api/sprint-k/:projectId/hazmat/substance/update',
    verifyAuth,
    validate(z.object({ item: hazmatItemSchema, inventory: inventorySchema })),
    (req: any, res: any) => {
      if (!guard(req.user.uid, req.params.projectId, res)) return undefined;
      const body = req.validated;
      const idx = body.inventory.findIndex((it: HazmatItem) => it.id === body.item.id);
      if (idx < 0) return res.status(404).json({ error: 'substance_not_found' });
      const nextInventory = body.inventory.slice();
      nextInventory[idx] = body.item;
      const issues = auditStorageLocation(nextInventory);
      return res.json({ item: body.item, inventory: nextInventory, issues });
    },
  );

  // delete
  app.post(
    '/api/sprint-k/:projectId/hazmat/substance/delete',
    verifyAuth,
    validate(z.object({ itemId: z.string(), inventory: inventorySchema })),
    (req: any, res: any) => {
      if (!guard(req.user.uid, req.params.projectId, res)) return undefined;
      const body = req.validated;
      const idx = body.inventory.findIndex((it: HazmatItem) => it.id === body.itemId);
      if (idx < 0) return res.status(404).json({ error: 'substance_not_found' });
      const nextInventory = body.inventory.filter(
        (it: HazmatItem) => it.id !== body.itemId,
      );
      return res.json({ itemId: body.itemId, inventory: nextInventory });
    },
  );

  // compatibility-check
  app.post(
    '/api/sprint-k/:projectId/hazmat/compatibility-check',
    verifyAuth,
    validate(z.object({ inventory: inventorySchema })),
    (req: any, res: any) => {
      if (!guard(req.user.uid, req.params.projectId, res)) return undefined;
      const body = req.validated;
      const issues = auditStorageLocation(body.inventory);
      const summary = {
        total: issues.length,
        incompatible: issues.filter((i) => i.level === 'incompatible').length,
        caution: issues.filter((i) => i.level === 'caution').length,
      };
      return res.json({ issues, summary });
    },
  );

  // spill-plan
  app.post(
    '/api/sprint-k/:projectId/hazmat/spill-plan',
    verifyAuth,
    validate(z.object({ item: hazmatItemSchema })),
    (req: any, res: any) => {
      if (!guard(req.user.uid, req.params.projectId, res)) return undefined;
      const body = req.validated;
      const plan = buildSpillPlan(body.item);
      return res.json({ plan });
    },
  );

  return app;
}

function item(
  id: string,
  name: string,
  classes: HazmatClass[],
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

describe('/api/sprint-k/:projectId/hazmat', () => {
  let deps: HazmatTestDeps;

  beforeEach(() => {
    deps = {
      users: new Map([
        ['member-token', { uid: 'uid_member' }],
        ['stranger-token', { uid: 'uid_stranger' }],
      ]),
      memberships: new Map([['proj-alpha', new Set(['uid_member'])]]),
    };
  });

  // ── add ──────────────────────────────────────────────────────────────

  it('add: 200 + returns next inventory and compat issues', async () => {
    const app = buildHazmatApp(deps);
    const existing = item('1', 'Gasolina', ['flammable']);
    const r = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/substance')
      .set('Authorization', 'Bearer member-token')
      .send({
        item: item('2', 'Cloro', ['oxidizer']),
        inventory: [existing],
      });
    expect(r.status).toBe(200);
    expect(r.body.inventory).toHaveLength(2);
    // flammable + oxidizer co-located → incompatible pair surfaced
    expect(r.body.issues.length).toBeGreaterThan(0);
    expect(r.body.issues[0].level).toBe('incompatible');
  });

  it('add: 401 without bearer token', async () => {
    const app = buildHazmatApp(deps);
    const r = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/substance')
      .send({ item: item('1', 'Gasolina', ['flammable']) });
    expect(r.status).toBe(401);
  });

  it('add: 403 when caller is not a project member', async () => {
    const app = buildHazmatApp(deps);
    const r = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/substance')
      .set('Authorization', 'Bearer stranger-token')
      .send({ item: item('1', 'Gasolina', ['flammable']) });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('forbidden');
  });

  it('add: 409 when item id already exists in inventory', async () => {
    const app = buildHazmatApp(deps);
    const r = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/substance')
      .set('Authorization', 'Bearer member-token')
      .send({
        item: item('dup', 'Gasolina', ['flammable']),
        inventory: [item('dup', 'Gasolina', ['flammable'])],
      });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('duplicate_substance_id');
  });

  it('add: 400 when item payload fails Zod (no hazardClasses)', async () => {
    const app = buildHazmatApp(deps);
    const r = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/substance')
      .set('Authorization', 'Bearer member-token')
      .send({
        item: { ...item('1', 'X', ['flammable']), hazardClasses: [] },
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_payload');
  });

  // ── list / inventory ─────────────────────────────────────────────────

  it('list: filters by locationId', async () => {
    const app = buildHazmatApp(deps);
    const inventory = [
      item('1', 'A', ['flammable'], { locationId: 'loc-A' }),
      item('2', 'B', ['toxic'], { locationId: 'loc-B' }),
      item('3', 'C', ['corrosive'], { locationId: 'loc-A' }),
    ];
    const r = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/inventory')
      .set('Authorization', 'Bearer member-token')
      .send({ inventory, filters: { locationId: 'loc-A' } });
    expect(r.status).toBe(200);
    expect(r.body.items).toHaveLength(2);
    expect(r.body.total).toBe(2);
  });

  it('list: search matches name OR cas', async () => {
    const app = buildHazmatApp(deps);
    const inventory = [
      item('1', 'Acetona', ['flammable'], { cas: '67-64-1' }),
      item('2', 'Hipoclorito de sodio', ['oxidizer'], { cas: '7681-52-9' }),
    ];
    const byName = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/inventory')
      .set('Authorization', 'Bearer member-token')
      .send({ inventory, filters: { search: 'aceton' } });
    expect(byName.body.items).toHaveLength(1);
    expect(byName.body.items[0].id).toBe('1');
    const byCas = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/inventory')
      .set('Authorization', 'Bearer member-token')
      .send({ inventory, filters: { search: '7681' } });
    expect(byCas.body.items).toHaveLength(1);
    expect(byCas.body.items[0].id).toBe('2');
  });

  it('list: expiringWithinDays surfaces only items inside horizon', async () => {
    const app = buildHazmatApp(deps);
    const inventory = [
      item('soon', 'A', ['toxic'], { expiresAt: '2026-05-25T00:00:00Z' }),
      item('later', 'B', ['toxic'], { expiresAt: '2027-01-01T00:00:00Z' }),
      item('noexp', 'C', ['toxic']),
    ];
    const r = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/inventory')
      .set('Authorization', 'Bearer member-token')
      .send({
        inventory,
        now: '2026-05-19T00:00:00Z',
        filters: { expiringWithinDays: 30 },
      });
    expect(r.status).toBe(200);
    const ids = r.body.items.map((it: HazmatItem) => it.id);
    expect(ids).toEqual(['soon']);
  });

  // ── update ───────────────────────────────────────────────────────────

  it('update: replaces item by id and recomputes issues', async () => {
    const app = buildHazmatApp(deps);
    const inventory = [item('1', 'Gasolina', ['flammable'])];
    const r = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/substance/update')
      .set('Authorization', 'Bearer member-token')
      .send({
        item: item('1', 'Gasolina 95', ['flammable'], { stockQty: 99 }),
        inventory,
      });
    expect(r.status).toBe(200);
    expect(r.body.inventory).toHaveLength(1);
    expect(r.body.inventory[0].name).toBe('Gasolina 95');
    expect(r.body.inventory[0].stockQty).toBe(99);
  });

  it('update: 404 when item id is not in inventory', async () => {
    const app = buildHazmatApp(deps);
    const r = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/substance/update')
      .set('Authorization', 'Bearer member-token')
      .send({ item: item('ghost', 'X', ['toxic']), inventory: [] });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('substance_not_found');
  });

  // ── delete ───────────────────────────────────────────────────────────

  it('delete: removes by id (200) and 404 when missing', async () => {
    const app = buildHazmatApp(deps);
    const inventory = [
      item('1', 'A', ['flammable']),
      item('2', 'B', ['toxic']),
    ];
    const ok = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/substance/delete')
      .set('Authorization', 'Bearer member-token')
      .send({ itemId: '1', inventory });
    expect(ok.status).toBe(200);
    expect(ok.body.inventory).toHaveLength(1);
    expect(ok.body.inventory[0].id).toBe('2');

    const miss = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/substance/delete')
      .set('Authorization', 'Bearer member-token')
      .send({ itemId: 'ghost', inventory });
    expect(miss.status).toBe(404);
  });

  // ── compatibility-check ──────────────────────────────────────────────

  it('compatibility-check: returns issues + summary buckets', async () => {
    const app = buildHazmatApp(deps);
    const inventory = [
      item('1', 'Gasolina', ['flammable'], { locationId: 'loc-A' }),
      item('2', 'Cloro', ['oxidizer'], { locationId: 'loc-A' }), // incompat
      item('3', 'Ácido sulfúrico', ['corrosive'], { locationId: 'loc-A' }),
      // flammable + corrosive co-located → caution
    ];
    const r = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/compatibility-check')
      .set('Authorization', 'Bearer member-token')
      .send({ inventory });
    expect(r.status).toBe(200);
    expect(r.body.summary.total).toBeGreaterThanOrEqual(2);
    expect(r.body.summary.incompatible).toBeGreaterThanOrEqual(1);
    expect(r.body.summary.caution).toBeGreaterThanOrEqual(1);
  });

  // ── spill-plan ───────────────────────────────────────────────────────

  it('spill-plan: returns a flammable-specific plan for flammable items', async () => {
    const app = buildHazmatApp(deps);
    const r = await request(app)
      .post('/api/sprint-k/proj-alpha/hazmat/spill-plan')
      .set('Authorization', 'Bearer member-token')
      .send({ item: item('1', 'Gasolina', ['flammable']) });
    expect(r.status).toBe(200);
    expect(r.body.plan.itemName).toBe('Gasolina');
    expect(r.body.plan.emergencyContact).toMatch(/Bomberos/);
    expect(r.body.plan.steps.length).toBeGreaterThan(0);
  });
});
