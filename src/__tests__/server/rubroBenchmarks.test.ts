// Épica Rubros SII — slice 4: GET /api/sii/:projectId/rubro-benchmarks.
//
// Real-router supertest over fakeFirestore (same harness as
// legalObligations.test.ts — NOT a router.stack wire-up test). Covers:
//   • 401 without token (verifyAuth gate)
//   • 400 invalid projectId
//   • 403 non-member (assertProjectMember — also covers nonexistent project)
//   • 200 available:false when the project has no SII rubro
//   • 200 below k threshold → eligible:false, NO k leak, NO distributions
//   • 200 above threshold → distributions present, own values correct,
//     incident dedupe across the dual storage paths, and — the critical
//     assertion — the response NEVER contains other projects' ids, names,
//     or tenant uids.
//   • single-tenant skew: many projects, <3 tenants → suppressed
//   • per-collection read failure degrades the metric, not the endpoint

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
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import rubroBenchmarksRouter from '../../server/routes/rubroBenchmarks.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

const PREFIX = '/api/sii';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, rubroBenchmarksRouter);
  return app;
}

const CALLER_UID = 'uid-prevencionista-1';
const OWN_PROJECT = 'proj-own';
const SECTOR = 'GP-AGR-CULT';
const SII_CODE = 11101; // CULTIVO DE TRIGO — real catalogue entry

const NOW = Date.now();
const RECENT = new Date(NOW - 30 * 86_400_000).toISOString(); // inside 12m
const ANCIENT = new Date(NOW - 500 * 86_400_000).toISOString(); // outside 12m
const FUTURE = new Date(NOW + 60 * 86_400_000).toISOString();
const PAST = new Date(NOW - 10 * 86_400_000).toISOString();

/** Seed the caller's own project with the rubro + known metric data. */
function seedOwnProject() {
  H.db!._seed(`projects/${OWN_PROJECT}`, {
    name: 'Faena Los Andes',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
    tenantId: CALLER_UID,
    metadata: { sectorId: SECTOR, codigoActividadSii: SII_CODE },
  });
  // 1 recent incident duplicated across BOTH storage paths (must dedupe to 1)
  // + 1 ancient incident (outside the 12-month window).
  H.db!._seed('incidents/inc-own-1', { projectId: OWN_PROJECT, ts: RECENT });
  H.db!._seed(`tenants/${CALLER_UID}/projects/${OWN_PROJECT}/incidents/inc-own-1`, {
    projectId: OWN_PROJECT,
    ts: RECENT,
  });
  H.db!._seed('incidents/inc-own-old', { projectId: OWN_PROJECT, ts: ANCIENT });
  // findings: 1 open + 1 closed → 50% open
  H.db!._seed(`projects/${OWN_PROJECT}/findings/f1`, { status: 'Abierto' });
  H.db!._seed(`projects/${OWN_PROJECT}/findings/f2`, { status: 'Cerrado' });
  // obligations: 1 future + 1 overdue → 50% al día
  H.db!._seed(`projects/${OWN_PROJECT}/legal_obligations/o1`, { nextDueAt: FUTURE });
  H.db!._seed(`projects/${OWN_PROJECT}/legal_obligations/o2`, { nextDueAt: PAST });
}

/** Seed a peer project of the same sector owned by another tenant. */
function seedPeer(n: number, opts: { tenant?: string; incidents?: number } = {}) {
  const pid = `proj-peer-${n}`;
  const tenant = opts.tenant ?? `tenant-otro-${n}`;
  H.db!._seed(`projects/${pid}`, {
    name: `EMPRESA-CONFIDENCIAL-${n}`,
    members: [tenant],
    createdBy: tenant,
    metadata: { sectorId: SECTOR, codigoActividadSii: SII_CODE },
  });
  const count = opts.incidents ?? n;
  for (let i = 0; i < count; i++) {
    H.db!._seed(`incidents/inc-${pid}-${i}`, { projectId: pid, ts: RECENT });
  }
  // every peer: 100% open findings, 100% al día
  H.db!._seed(`projects/${pid}/findings/f1`, { status: 'Abierto' });
  H.db!._seed(`projects/${pid}/legal_obligations/o1`, { nextDueAt: FUTURE });
  return pid;
}

beforeEach(() => {
  H.db = createFakeFirestore();
});

describe('GET /api/sii/:projectId/rubro-benchmarks', () => {
  it('401 sin token', async () => {
    const res = await request(buildApp()).get(`${PREFIX}/${OWN_PROJECT}/rubro-benchmarks`);
    expect(res.status).toBe(401);
  });

  it('400 con projectId inválido', async () => {
    const res = await request(buildApp())
      .get(`${PREFIX}/${'a'.repeat(200)}/rubro-benchmarks`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
  });

  it('403 cuando el caller no es miembro del proyecto', async () => {
    H.db!._seed(`projects/${OWN_PROJECT}`, {
      members: ['otro-uid'],
      createdBy: 'otro-uid',
      metadata: { sectorId: SECTOR },
    });
    const res = await request(buildApp())
      .get(`${PREFIX}/${OWN_PROJECT}/rubro-benchmarks`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
  });

  it('403 cuando el proyecto no existe (sin oráculo de existencia)', async () => {
    const res = await request(buildApp())
      .get(`${PREFIX}/no-existe/rubro-benchmarks`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
  });

  it('200 available:false cuando el proyecto no tiene rubro SII', async () => {
    H.db!._seed(`projects/${OWN_PROJECT}`, {
      members: [CALLER_UID],
      createdBy: CALLER_UID,
      metadata: { origin: 'manual' },
    });
    const res = await request(buildApp())
      .get(`${PREFIX}/${OWN_PROJECT}/rubro-benchmarks`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: false, reason: 'sin_rubro' });
  });

  it('200 bajo el umbral k: eligible:false, sin distribuciones y SIN filtrar k exacto', async () => {
    seedOwnProject();
    seedPeer(1);
    seedPeer(2);
    seedPeer(3); // 4 proyectos en total → bajo k=5
    const res = await request(buildApp())
      .get(`${PREFIX}/${OWN_PROJECT}/rubro-benchmarks`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.eligible).toBe(false);
    expect(res.body.requiredProjects).toBe(5);
    // Below threshold the exact sector population is itself a fingerprint
    // ("there are exactly 3 other projects") — it must NOT be echoed.
    expect(res.body.k).toBeUndefined();
    expect(res.body.kTenants).toBeUndefined();
    expect(res.body.perMetric).toBeUndefined();
    // own values are the caller's own data — always allowed
    expect(res.body.mine.incidentes12m).toBe(1);
  });

  it('200 sobre el umbral: distribución anónima + valores propios correctos', async () => {
    seedOwnProject(); // own: 1 recent incident (deduped), 50% open, 50% al día
    seedPeer(1, { incidents: 2 });
    seedPeer(2, { incidents: 3 });
    seedPeer(3, { incidents: 4 });
    seedPeer(4, { incidents: 5 }); // 5 proyectos / 5 tenants
    const res = await request(buildApp())
      .get(`${PREFIX}/${OWN_PROJECT}/rubro-benchmarks`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.eligible).toBe(true);
    expect(res.body.rubro).toEqual({
      siiCode: SII_CODE,
      descripcion: 'CULTIVO DE TRIGO',
      sectorId: SECTOR,
    });
    // mine: dual-path incident deduped to 1; ancient incident excluded.
    expect(res.body.mine).toEqual({
      incidentes12m: 1,
      hallazgosAbiertosPct: 50,
      obligacionesAlDiaPct: 50,
    });
    // distribution over [1,2,3,4,5] incidents → median 3
    expect(res.body.k).toBe(5);
    expect(res.body.perMetric.incidentes12m).toEqual({
      count: 5,
      median: 3,
      p25: 2,
      p75: 4,
    });
    expect(res.body.perMetric.hallazgosAbiertosPct?.count).toBe(5);
    expect(res.body.perMetric.obligacionesAlDiaPct?.count).toBe(5);

    // ── anonymity: nothing reversible about the OTHER projects ──────────
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('proj-peer');
    expect(text).not.toContain('EMPRESA-CONFIDENCIAL');
    expect(text).not.toContain('tenant-otro');
    // not even the caller's own project name needs to travel back
    expect(text).not.toContain('Faena Los Andes');
  });

  it('200 con sesgo de tenant: 6 proyectos pero 2 empresas → suprimido', async () => {
    seedOwnProject();
    for (let n = 1; n <= 5; n++) seedPeer(n, { tenant: 'tenant-unico' });
    const res = await request(buildApp())
      .get(`${PREFIX}/${OWN_PROJECT}/rubro-benchmarks`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(false);
    expect(res.body.perMetric).toBeUndefined();
  });

  it('la falla de lectura de una colección degrada la métrica, no el endpoint', async () => {
    seedOwnProject();
    for (let n = 1; n <= 4; n++) seedPeer(n);
    H.db!._failReads('findings');
    const res = await request(buildApp())
      .get(`${PREFIX}/${OWN_PROJECT}/rubro-benchmarks`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(true);
    expect(res.body.mine.hallazgosAbiertosPct).toBeNull();
    expect(res.body.perMetric.hallazgosAbiertosPct).toBeNull();
    expect(res.body.perMetric.incidentes12m).not.toBeNull();
  });
});
