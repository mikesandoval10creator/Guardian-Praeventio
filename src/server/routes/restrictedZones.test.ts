// Praeventio Guard — restrictedZones router contract tests.
//
// Wire-up contract: verify the router exposes the documented endpoints
// at the documented HTTP methods. Behavioural tests for the underlying
// engine live in `src/services/zones/restrictedZonesEngine.test.ts`.
//
// Security contract (Codex P1): the MUTATING `POST /define` handler must
// require an elevated role (admin/prevencionista/supervisor) on TOP of
// project membership — an ordinary member must not be able to create or
// overwrite zone safety rules for a whole site. The behavioural block at the
// bottom mounts the REAL router through fakeFirestore to assert the 403/200
// role gate. `POST /entry-event` is deliberately NOT role-gated (founder
// no-blocking directive: any worker records their own informed entry), so it
// is not part of this gate's contract.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as
    | ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore>
    | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') || undefined,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

vi.mock('../middleware/idempotencyKey.js', () => ({
  idempotencyKey:
    () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Pass the raw body straight through as `req.validated` so the role-gate test
// is not coupled to the (large) restrictedZoneSchema shape — the gate fires
// before any schema-specific field is consumed.
vi.mock('../middleware/validate.js', () => ({
  validate:
    () => (req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { validated: unknown }).validated = req.body;
      next();
    },
}));

vi.mock('../middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn(async () => undefined),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

import restrictedZonesRouter from './restrictedZones';

type Layer = { route?: { path: string; methods: Record<string, boolean> } };
const layers = (restrictedZonesRouter as unknown as { stack: Layer[] }).stack;

function hasMethod(
  path: string,
  method: 'get' | 'post' | 'put' | 'delete',
): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods[method] === true,
  );
}

describe('restrictedZonesRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(restrictedZonesRouter).toBeDefined();
    expect(typeof restrictedZonesRouter).toBe('function');
  });

  it('registers POST /define', () => {
    expect(hasMethod('/define', 'post')).toBe(true);
  });

  it('registers GET /by-site/:projectId', () => {
    expect(hasMethod('/by-site/:projectId', 'get')).toBe(true);
  });

  it('registers POST /check', () => {
    expect(hasMethod('/check', 'post')).toBe(true);
  });

  it('registers POST /entry-event', () => {
    expect(hasMethod('/entry-event', 'post')).toBe(true);
  });

  it('registers GET /entry-permissions/:projectId/:workerUid', () => {
    expect(
      hasMethod('/entry-permissions/:projectId/:workerUid', 'get'),
    ).toBe(true);
  });

  it('no route registers a DELETE method (founder directive: never block)', () => {
    // We do not expose a "remove zone" path that could be misused as
    // "block worker by destroying the zone they would otherwise be
    // recommended away from". Zone lifecycle is purely additive +
    // time-bound (activeUntil) per the engine contract.
    const anyDelete = layers.some(
      (l) => l.route?.methods.delete === true,
    );
    expect(anyDelete).toBe(false);
  });

  it('exposes exactly the documented endpoints (no orphans)', () => {
    const routes = layers
      .map((l) => l.route)
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => r.path)
      .sort();
    expect(routes).toEqual(
      [
        '/by-site/:projectId',
        '/check',
        '/define',
        '/entry-event',
        '/entry-permissions/:projectId/:workerUid',
      ].sort(),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Elevated-role gate on POST /define (Codex P1 — corrupt safety controls).
// Mounts the REAL router through fakeFirestore so the verifyAuth gate, the
// membership `guard`, and the new `callerCanWriteZones` gate all execute.
// ═════════════════════════════════════════════════════════════════════════════

const PROJECT_ID = 'proj-zone-1';
const TENANT_ID = 'tenant-zone-1';
const CALLER_UID = 'uid-member-1';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/zones', restrictedZonesRouter);
  return app;
}

/** Seed a project doc so assertProjectMember passes + tenant resolves. */
function seedProject(uid = CALLER_UID) {
  H.db!._seed(`projects/${PROJECT_ID}`, {
    members: [uid],
    createdBy: uid,
    tenantId: TENANT_ID,
  });
}

const validZone = {
  id: 'zone-hot-1',
  kind: 'hot',
  name: 'Soldadura sector A',
  rules: {
    requiredEpp: ['careta'],
    requiredTrainings: ['caliente'],
    responsibleUid: 'uid-resp-1',
  },
  activeFrom: '2026-01-01',
};

const definePayload = { projectId: PROJECT_ID, zone: validZone };

describe('POST /define — elevated-role gate', () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
  });

  it('401 — no token', async () => {
    const res = await request(buildApp()).post('/api/zones/define').send(definePayload);
    expect(res.status).toBe(401);
  });

  it('403 forbidden — project member WITHOUT an elevated role', async () => {
    seedProject();
    const res = await request(buildApp())
      .post('/api/zones/define')
      .set('x-test-uid', CALLER_UID) // member (guard passes) but no role header
      .send(definePayload);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('403 forbidden — member with a non-elevated role (worker)', async () => {
    seedProject();
    const res = await request(buildApp())
      .post('/api/zones/define')
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'worker')
      .send(definePayload);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden_role');
  });

  it('200 — member WITH an elevated role (supervisor) may define', async () => {
    seedProject();
    const res = await request(buildApp())
      .post('/api/zones/define')
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'supervisor')
      .send(definePayload);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.zoneId).toBe(validZone.id);
  });
});
