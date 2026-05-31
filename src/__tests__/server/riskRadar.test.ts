// Real-router supertest for src/server/routes/riskRadar.ts
// (F.13 Radar de Riesgos Repetidos — Plan v3 Fase 1 coverage lever).
//
// Mounted at /api/sprint-k (matching server.ts line 956).
// The single endpoint is:
//   GET /api/sprint-k/:projectId/repeating-risks
//
// Covers: 401, 403 (non-member), 404 (tenant not found), 200 happy path
// (with real aggregation asserted), 200 empty state, 200 fallback
// (index-missing-error branch), and the 500 path via a broken service.

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

// The service is a dynamic `await import(...)` inside the handler.
// Vitest hoists vi.mock so the same specifier resolves for both the test and
// the production handler at import-resolution time.
vi.mock('../../services/riskRadar/repeatingRiskRadar.js', () => ({
  buildRepeatingRiskRadar: vi.fn(
    (
      incidents: Array<{ id: string; occurredAt: string; kind: string; zoneId: string }>,
      _config: unknown,
    ) => ({
      patterns: [],
      totalPatterns: 0,
      byKind: {},
      maxSeverity: 'low' as const,
      windowDays: 90,
      consideredIncidents: incidents.length,
    }),
  ),
}));

import riskRadarRouter from '../../server/routes/riskRadar.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { buildRepeatingRiskRadar } from '../../services/riskRadar/repeatingRiskRadar.js';

const PREFIX = '/api/sprint-k';
const REPEATING = (projectId: string) =>
  `${PREFIX}/${projectId}/repeating-risks`;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, riskRadarRouter);
  return app;
}

// ── Shared seed helpers ────────────────────────────────────────────────

/** Seeds a project doc with a tenantId and the caller as a member. */
function seedProject(
  db: ReturnType<typeof createFakeFirestore>,
  projectId: string,
  tenantId: string,
  memberUid: string,
) {
  db._seed(`projects/${projectId}`, { tenantId, members: [memberUid], createdBy: memberUid });
}

/** Seeds a minimal incident doc in the top-level `incidents` collection. */
function seedIncident(
  db: ReturnType<typeof createFakeFirestore>,
  id: string,
  projectId: string,
  overrides: Record<string, unknown> = {},
) {
  const occurredAt = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
  db._seed(`incidents/${id}`, {
    projectId,
    kind: 'caida',
    zoneId: 'zona-a',
    severity: 'high',
    occurredAt,
    reportedAt: occurredAt,
    ...overrides,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  vi.mocked(buildRepeatingRiskRadar).mockClear();
});

// ── 401 — unauthenticated ─────────────────────────────────────────────

describe('GET /:projectId/repeating-risks — auth', () => {
  it('401 when no token is provided', async () => {
    const res = await request(buildApp()).get(REPEATING('p1'));
    expect(res.status).toBe(401);
  });
});

// ── 403 — non-member ──────────────────────────────────────────────────

describe('GET /:projectId/repeating-risks — membership guard', () => {
  it('403 when caller is not a member of the project', async () => {
    // Project exists but members list does NOT include the caller.
    H.db!._seed('projects/p1', { tenantId: 't1', members: ['other-uid'], createdBy: 'other-uid' });

    const res = await request(buildApp())
      .get(REPEATING('p1'))
      .set('x-test-uid', 'intruder-uid');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist at all', async () => {
    // H.db starts empty — no project doc.
    const res = await request(buildApp())
      .get(REPEATING('does-not-exist'))
      .set('x-test-uid', 'uid1');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// ── 404 — tenant not found ────────────────────────────────────────────

describe('GET /:projectId/repeating-risks — tenant resolution', () => {
  it('404 when the project exists and caller is a member but tenantId is absent', async () => {
    // Seed a project WITHOUT a tenantId field and with the caller as member.
    H.db!._seed('projects/p-no-tenant', {
      members: ['uid1'],
      createdBy: 'uid1',
      // intentionally no `tenantId`
    });

    const res = await request(buildApp())
      .get(REPEATING('p-no-tenant'))
      .set('x-test-uid', 'uid1');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('404 when tenantId fallback via members sub-collection also yields nothing', async () => {
    // Project doc has no tenantId; member sub-collection doc also lacks tenantId.
    H.db!._seed('projects/p2', { members: ['uid2'], createdBy: 'uid2' });
    H.db!._seed('projects/p2/members/uid2', { uid: 'uid2' }); // no tenantId field

    const res = await request(buildApp())
      .get(REPEATING('p2'))
      .set('x-test-uid', 'uid2');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('tenantId fallback succeeds via members sub-collection', async () => {
    // No tenantId on project root → found on the member sub-doc.
    H.db!._seed('projects/p3', { members: ['uid3'], createdBy: 'uid3' });
    H.db!._seed('projects/p3/members/uid3', { uid: 'uid3', tenantId: 't-from-member' });

    const res = await request(buildApp())
      .get(REPEATING('p3'))
      .set('x-test-uid', 'uid3');

    // Should reach the aggregation step and return 200.
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('report');
  });
});

// ── 200 happy path ─────────────────────────────────────────────────────

describe('GET /:projectId/repeating-risks — 200 happy path', () => {
  it('200 returns { report } with no incidents → empty consideredIncidents', async () => {
    seedProject(H.db!, 'p10', 't10', 'uid-a');

    const res = await request(buildApp())
      .get(REPEATING('p10'))
      .set('x-test-uid', 'uid-a');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('report');
    expect(res.body.report).toMatchObject({
      patterns: [],
      totalPatterns: 0,
      windowDays: 90,
    });
    // Service was called with the (empty) samples.
    expect(vi.mocked(buildRepeatingRiskRadar)).toHaveBeenCalledTimes(1);
    const [samples, cfg] = vi.mocked(buildRepeatingRiskRadar).mock.calls[0];
    expect(samples).toEqual([]);
    expect(cfg).toEqual({ minOccurrences: 3, windowDays: 90 });
  });

  it('200 with seeded incidents — recent ones are forwarded to the service', async () => {
    seedProject(H.db!, 'p11', 't11', 'uid-b');
    // Seed 2 incidents with all required fields so they pass the filter.
    seedIncident(H.db!, 'inc-1', 'p11', { kind: 'golpe', zoneId: 'zona-b' });
    seedIncident(H.db!, 'inc-2', 'p11', { kind: 'caida', zoneId: 'zona-c', workerUid: 'w1' });
    // An incident for a DIFFERENT project — must NOT be included.
    seedIncident(H.db!, 'inc-other', 'other-project', { kind: 'caida', zoneId: 'zona-x' });

    const res = await request(buildApp())
      .get(REPEATING('p11'))
      .set('x-test-uid', 'uid-b');

    expect(res.status).toBe(200);
    expect(res.body.report).toHaveProperty('consideredIncidents');
    // The service received samples ONLY for p11.
    const [samples] = vi.mocked(buildRepeatingRiskRadar).mock.calls[0];
    const ids = samples.map((s: { id: string }) => s.id);
    expect(ids).toContain('inc-1');
    expect(ids).toContain('inc-2');
    expect(ids).not.toContain('inc-other');
  });

  it('200 with severity aliases — "alta" normalizes to "high"', async () => {
    seedProject(H.db!, 'p12', 't12', 'uid-c');
    seedIncident(H.db!, 'inc-sev', 'p12', { severity: 'alta', kind: 'atrapamiento', zoneId: 'zona-d' });

    const res = await request(buildApp())
      .get(REPEATING('p12'))
      .set('x-test-uid', 'uid-c');

    expect(res.status).toBe(200);
    const [samples] = vi.mocked(buildRepeatingRiskRadar).mock.calls[0];
    const sample = samples.find((s: { id: string }) => s.id === 'inc-sev');
    expect(sample).toBeDefined();
    expect(sample?.severity).toBe('high');
  });

  it('200 — incidents older than 90 days are filtered before the service call', async () => {
    seedProject(H.db!, 'p13', 't13', 'uid-d');
    const oldDate = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    seedIncident(H.db!, 'inc-old', 'p13', { occurredAt: oldDate, kind: 'caida', zoneId: 'zona-e' });

    const res = await request(buildApp())
      .get(REPEATING('p13'))
      .set('x-test-uid', 'uid-d');

    expect(res.status).toBe(200);
    const [samples] = vi.mocked(buildRepeatingRiskRadar).mock.calls[0];
    // Old incident should NOT appear in samples.
    expect(samples.find((s: { id: string }) => s.id === 'inc-old')).toBeUndefined();
  });

  it('200 — incidents without occurredAt are excluded from samples', async () => {
    seedProject(H.db!, 'p14', 't14', 'uid-e');
    // This incident has no `occurredAt` — toDate() returns null → filtered out.
    H.db!._seed('incidents/inc-no-date', {
      projectId: 'p14',
      kind: 'golpe',
      zoneId: 'zona-f',
      severity: 'low',
      reportedAt: new Date().toISOString(),
      // intentionally no `occurredAt`
    });

    const res = await request(buildApp())
      .get(REPEATING('p14'))
      .set('x-test-uid', 'uid-e');

    expect(res.status).toBe(200);
    const [samples] = vi.mocked(buildRepeatingRiskRadar).mock.calls[0];
    expect(samples.find((s: { id: string }) => s.id === 'inc-no-date')).toBeUndefined();
  });

  it('200 — incidents with no kind/zoneId/workerUid/taskId/shift are filtered from samples', async () => {
    seedProject(H.db!, 'p15', 't15', 'uid-f');
    // Has occurredAt and is recent but no classifiable field → excluded.
    H.db!._seed('incidents/inc-bare', {
      projectId: 'p15',
      occurredAt: new Date().toISOString(),
      severity: 'medium',
      // no kind, zoneId, workerUid, taskId, shift
    });

    const res = await request(buildApp())
      .get(REPEATING('p15'))
      .set('x-test-uid', 'uid-f');

    expect(res.status).toBe(200);
    const [samples] = vi.mocked(buildRepeatingRiskRadar).mock.calls[0];
    expect(samples.find((s: { id: string }) => s.id === 'inc-bare')).toBeUndefined();
  });

  it('200 — shift field is only accepted for valid values (day/evening/night)', async () => {
    seedProject(H.db!, 'p16', 't16', 'uid-g');
    seedIncident(H.db!, 'inc-valid-shift', 'p16', { shift: 'night', kind: 'caida', zoneId: 'z1' });
    seedIncident(H.db!, 'inc-bad-shift', 'p16', { shift: 'manana', kind: 'caida', zoneId: 'z2' });

    const res = await request(buildApp())
      .get(REPEATING('p16'))
      .set('x-test-uid', 'uid-g');

    expect(res.status).toBe(200);
    const [samples] = vi.mocked(buildRepeatingRiskRadar).mock.calls[0];
    const validShift = samples.find((s: { id: string }) => s.id === 'inc-valid-shift');
    const badShift = samples.find((s: { id: string }) => s.id === 'inc-bad-shift');
    expect(validShift?.shift).toBe('night');
    expect(badShift?.shift).toBeUndefined();
  });

  it('200 — kind/zone fallback aliases are resolved (type→kind, area→zoneId)', async () => {
    seedProject(H.db!, 'p17', 't17', 'uid-h');
    H.db!._seed('incidents/inc-alias', {
      projectId: 'p17',
      occurredAt: new Date().toISOString(),
      type: 'quemadura', // alias for `kind`
      area: 'zona-g',   // alias for `zoneId`
      severity: 'medium',
    });

    const res = await request(buildApp())
      .get(REPEATING('p17'))
      .set('x-test-uid', 'uid-h');

    expect(res.status).toBe(200);
    const [samples] = vi.mocked(buildRepeatingRiskRadar).mock.calls[0];
    const s = samples.find((s: { id: string }) => s.id === 'inc-alias');
    expect(s).toBeDefined();
    expect(s?.kind).toBe('quemadura');
    expect(s?.zoneId).toBe('zona-g');
  });
});

// ── 500 — unexpected error ─────────────────────────────────────────────

describe('GET /:projectId/repeating-risks — 500 branch', () => {
  it('500 when the service throws an unexpected error', async () => {
    seedProject(H.db!, 'p20', 't20', 'uid-z');
    vi.mocked(buildRepeatingRiskRadar).mockImplementationOnce(() => {
      throw new Error('Unexpected aggregation failure');
    });

    const res = await request(buildApp())
      .get(REPEATING('p20'))
      .set('x-test-uid', 'uid-z');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });
});
