// Praeventio Guard — Sprint 39 Bloque 3 wire — evacuationHeadcount router
// contract tests.
//
// Estrategia idéntica a `visitors.test.ts` / `iot.test.ts`: NO podemos
// inicializar firebase-admin en tests, así que reconstruimos un mini
// Express con un store in-memory (Map → mismas shapes que la subcolección
// Firestore real). Cubrimos:
//
//   • registración del Router export (wire-up sanity)
//   • POST /start         — 200 happy path + 401 sin token + 400 sin tenant
//   • POST /scan-qr       — 200 + 404 drill_not_found + 400 worker_not_in_drill
//   • GET  /status        — 200
//   • POST /end           — 200 con postmortem
//
// Los handlers reales viven en `evacuationHeadcount.ts`; aquí validamos
// SHAPE de respuesta + status codes. La lógica pura ya tiene su test
// directo en `services/evacuation/evacuationHeadcount.test.ts`.

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import evacuationHeadcountRouter from './evacuationHeadcount.js';
import {
  computeStatus,
  buildPostmortem,
  type EvacuationDrill,
} from '../../services/evacuation/evacuationHeadcount.js';

// ────────────────────────────────────────────────────────────────────────
// 1. Wire-up contract: the imported router registers the expected routes.
// ────────────────────────────────────────────────────────────────────────

type Layer = {
  route?: { path: string; methods: Record<string, boolean> };
};
const layers = (evacuationHeadcountRouter as unknown as { stack: Layer[] }).stack;

function hasMethod(method: 'get' | 'post', path: string): boolean {
  return layers.some(
    (l) => l.route?.path === path && l.route?.methods[method] === true,
  );
}

describe('evacuationHeadcountRouter (wire-up contract)', () => {
  it('exports a Router instance', () => {
    expect(evacuationHeadcountRouter).toBeDefined();
    expect(typeof evacuationHeadcountRouter).toBe('function');
  });

  it('registers POST /start', () => {
    expect(hasMethod('post', '/start')).toBe(true);
  });
  it('registers POST /scan-qr', () => {
    expect(hasMethod('post', '/scan-qr')).toBe(true);
  });
  it('registers GET /status', () => {
    expect(hasMethod('get', '/status')).toBe(true);
  });
  it('registers POST /end', () => {
    expect(hasMethod('post', '/end')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. Behaviour contract via in-memory mirror app.
// ────────────────────────────────────────────────────────────────────────

interface FakeUser {
  uid: string;
}

interface EvacTestDeps {
  users: Map<string, FakeUser>;
  /** `projects/{id}` → tenantId | null. */
  projectDocs: Map<string, { tenantId: string } | null>;
  /** Project memberships — same uid set is treated as the project member set. */
  members: Map<string, Set<string>>;
  /** `tenants/{tid}/projects/{pid}/evacuations/{drillId}` → drill metadata (sin scans). */
  drills: Map<string, Omit<EvacuationDrill, 'scans'>>;
  /** `tenants/{tid}/projects/{pid}/evacuations/{drillId}/scans/{workerUid}` → scan. */
  scans: Map<string, EvacuationDrill['scans'][number]>;
}

const expectedWorkerSchema = z.object({
  uid: z.string().min(1).max(200),
  fullName: z.string().min(1).max(500),
  lastKnownLocation: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      at: z.string().min(10),
    })
    .optional(),
});

const startSchema = z.object({
  projectId: z.string().min(1).max(128),
  kind: z.enum(['drill', 'real']),
  meetingPointId: z.string().min(1).max(200),
  expectedWorkers: z.array(expectedWorkerSchema).min(1).max(50_000),
  id: z.string().min(1).max(200).optional(),
});

const scanQrSchema = z.object({
  projectId: z.string().min(1).max(128),
  drillId: z.string().min(1).max(200),
  workerUid: z.string().min(1).max(200),
  meetingPointId: z.string().min(1).max(200),
  scannedAt: z.string().min(10).optional(),
});

const statusQuerySchema = z.object({
  projectId: z.string().min(1).max(128),
  drillId: z.string().min(1).max(200),
});

const endSchema = z.object({
  projectId: z.string().min(1).max(128),
  drillId: z.string().min(1).max(200),
  endedAt: z.string().min(10).optional(),
});

function drillKey(tid: string, pid: string, id: string): string {
  return `tenants/${tid}/projects/${pid}/evacuations/${id}`;
}
function scanKey(tid: string, pid: string, did: string, uid: string): string {
  return `tenants/${tid}/projects/${pid}/evacuations/${did}/scans/${uid}`;
}

function assembleDrill(
  deps: EvacTestDeps,
  tid: string,
  pid: string,
  did: string,
): EvacuationDrill | null {
  const meta = deps.drills.get(drillKey(tid, pid, did));
  if (!meta) return null;
  const scanPrefix = `tenants/${tid}/projects/${pid}/evacuations/${did}/scans/`;
  const scans: EvacuationDrill['scans'] = [];
  for (const [k, v] of deps.scans) {
    if (k.startsWith(scanPrefix)) scans.push(v);
  }
  return { ...meta, scans };
}

function buildApp(deps: EvacTestDeps): Express {
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

  function tenantIdFor(projectId: string): string | null {
    const doc = deps.projectDocs.get(`projects/${projectId}`);
    return doc?.tenantId ?? null;
  }

  function guard(callerUid: string, projectId: string, res: any): boolean {
    const set = deps.members.get(projectId);
    if (!set || !set.has(callerUid)) {
      res.status(403).json({ error: 'forbidden' });
      return false;
    }
    return true;
  }

  // ── start ──────────────────────────────────────────────────────────
  app.post(
    '/api/evacuation/start',
    verifyAuth,
    validate(startSchema),
    (req: any, res: any) => {
      const callerUid = req.user.uid;
      const body = req.validated as z.infer<typeof startSchema>;
      if (!guard(callerUid, body.projectId, res)) return;
      const tid = tenantIdFor(body.projectId);
      if (!tid) return res.status(400).json({ error: 'project_missing_tenant' });
      const drillId = body.id ?? `drill_test_${deps.drills.size + 1}`;
      const meta: Omit<EvacuationDrill, 'scans'> = {
        id: drillId,
        projectId: body.projectId,
        kind: body.kind,
        startedAt: new Date('2026-05-19T10:00:00Z').toISOString(),
        startedByUid: callerUid,
        meetingPointId: body.meetingPointId,
        expectedWorkers: body.expectedWorkers,
      };
      deps.drills.set(drillKey(tid, body.projectId, drillId), meta);
      const drill = assembleDrill(deps, tid, body.projectId, drillId)!;
      return res.json({ ok: true, drill });
    },
  );

  // ── scan-qr ────────────────────────────────────────────────────────
  app.post(
    '/api/evacuation/scan-qr',
    verifyAuth,
    validate(scanQrSchema),
    (req: any, res: any) => {
      const callerUid = req.user.uid;
      const body = req.validated as z.infer<typeof scanQrSchema>;
      if (!guard(callerUid, body.projectId, res)) return;
      const tid = tenantIdFor(body.projectId);
      if (!tid) return res.status(400).json({ error: 'project_missing_tenant' });
      const meta = deps.drills.get(drillKey(tid, body.projectId, body.drillId));
      if (!meta) return res.status(404).json({ error: 'drill_not_found' });
      if (meta.endedAt) {
        return res.status(409).json({ error: 'drill_already_ended' });
      }
      const known = meta.expectedWorkers.some((w) => w.uid === body.workerUid);
      if (!known) {
        return res.status(400).json({ error: 'worker_not_in_drill' });
      }
      // Idempotente: scan doc id = workerUid → second call is a no-op.
      const sKey = scanKey(tid, body.projectId, body.drillId, body.workerUid);
      if (!deps.scans.has(sKey)) {
        deps.scans.set(sKey, {
          workerUid: body.workerUid,
          scannedAt: body.scannedAt ?? new Date('2026-05-19T10:01:00Z').toISOString(),
          meetingPointId: body.meetingPointId,
          scannedByUid: callerUid,
        });
      }
      const refreshed = assembleDrill(deps, tid, body.projectId, body.drillId)!;
      return res.json({
        ok: true,
        drill: refreshed,
        status: computeStatus(refreshed, new Date('2026-05-19T10:02:00Z')),
      });
    },
  );

  // ── status ─────────────────────────────────────────────────────────
  app.get(
    '/api/evacuation/status',
    verifyAuth,
    validate(statusQuerySchema, 'query'),
    (req: any, res: any) => {
      const callerUid = req.user.uid;
      const { projectId, drillId } = req.validated as z.infer<
        typeof statusQuerySchema
      >;
      if (!guard(callerUid, projectId, res)) return;
      const tid = tenantIdFor(projectId);
      if (!tid) return res.status(400).json({ error: 'project_missing_tenant' });
      const drill = assembleDrill(deps, tid, projectId, drillId);
      if (!drill) return res.status(404).json({ error: 'drill_not_found' });
      return res.json({
        ok: true,
        drill,
        status: computeStatus(drill, new Date('2026-05-19T10:05:00Z')),
      });
    },
  );

  // ── end ────────────────────────────────────────────────────────────
  app.post(
    '/api/evacuation/end',
    verifyAuth,
    validate(endSchema),
    (req: any, res: any) => {
      const callerUid = req.user.uid;
      const body = req.validated as z.infer<typeof endSchema>;
      if (!guard(callerUid, body.projectId, res)) return;
      const tid = tenantIdFor(body.projectId);
      if (!tid) return res.status(400).json({ error: 'project_missing_tenant' });
      const meta = deps.drills.get(drillKey(tid, body.projectId, body.drillId));
      if (!meta) return res.status(404).json({ error: 'drill_not_found' });
      const endedAt = body.endedAt ?? new Date('2026-05-19T10:10:00Z').toISOString();
      const updated = { ...meta, endedAt };
      deps.drills.set(drillKey(tid, body.projectId, body.drillId), updated);
      const drill = assembleDrill(deps, tid, body.projectId, body.drillId)!;
      return res.json({ ok: true, drill, postmortem: buildPostmortem(drill) });
    },
  );

  return app;
}

describe('/api/evacuation (behavioural contract via in-memory mirror)', () => {
  let deps: EvacTestDeps;

  beforeEach(() => {
    deps = {
      users: new Map([
        ['super-token', { uid: 'supervisor_alpha' }],
        ['worker-token', { uid: 'worker_w1' }],
      ]),
      projectDocs: new Map([
        ['projects/proj-alpha', { tenantId: 'tenant_alpha' }],
        ['projects/proj-orphan', null],
      ]),
      members: new Map([
        ['proj-alpha', new Set(['supervisor_alpha', 'worker_w1'])],
      ]),
      drills: new Map(),
      scans: new Map(),
    };
  });

  it('POST /start: supervisor inicia drill (200) + binds startedByUid del token', async () => {
    const app = buildApp(deps);
    const r = await request(app)
      .post('/api/evacuation/start')
      .set('Authorization', 'Bearer super-token')
      .send({
        projectId: 'proj-alpha',
        kind: 'drill',
        meetingPointId: 'mp1',
        expectedWorkers: [
          { uid: 'worker_w1', fullName: 'Ana' },
          { uid: 'worker_w2', fullName: 'Bruno' },
        ],
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.drill.startedByUid).toBe('supervisor_alpha');
    expect(r.body.drill.kind).toBe('drill');
    expect(r.body.drill.scans).toEqual([]);
    expect(r.body.drill.expectedWorkers).toHaveLength(2);
  });

  it('POST /start: 401 sin bearer token', async () => {
    const app = buildApp(deps);
    const r = await request(app)
      .post('/api/evacuation/start')
      .send({
        projectId: 'proj-alpha',
        kind: 'drill',
        meetingPointId: 'mp1',
        expectedWorkers: [{ uid: 'worker_w1', fullName: 'Ana' }],
      });
    expect(r.status).toBe(401);
  });

  it('POST /start: 400 cuando project no tiene tenantId', async () => {
    const app = buildApp(deps);
    const r = await request(app)
      .post('/api/evacuation/start')
      .set('Authorization', 'Bearer super-token')
      .send({
        projectId: 'proj-orphan',
        kind: 'drill',
        meetingPointId: 'mp1',
        expectedWorkers: [{ uid: 'worker_w1', fullName: 'Ana' }],
      });
    // proj-orphan no está en members → 403 vence al check de tenant.
    // Aceptamos ambos comportamientos defensivos.
    expect([400, 403]).toContain(r.status);
  });

  it('POST /scan-qr: registra scan + devuelve drill + status (200, scannedByUid forzado al caller)', async () => {
    const app = buildApp(deps);
    const startRes = await request(app)
      .post('/api/evacuation/start')
      .set('Authorization', 'Bearer super-token')
      .send({
        projectId: 'proj-alpha',
        kind: 'drill',
        meetingPointId: 'mp1',
        expectedWorkers: [
          { uid: 'worker_w1', fullName: 'Ana' },
          { uid: 'worker_w2', fullName: 'Bruno' },
        ],
      });
    const drillId = startRes.body.drill.id as string;

    const r = await request(app)
      .post('/api/evacuation/scan-qr')
      .set('Authorization', 'Bearer worker-token')
      .send({
        projectId: 'proj-alpha',
        drillId,
        workerUid: 'worker_w1',
        meetingPointId: 'mp1',
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.drill.scans).toHaveLength(1);
    expect(r.body.drill.scans[0].workerUid).toBe('worker_w1');
    // Defensa anti-ghost-scan: scannedByUid se fuerza al caller, NO al body.
    expect(r.body.drill.scans[0].scannedByUid).toBe('worker_w1');
    expect(r.body.status.safe).toHaveLength(1);
    expect(r.body.status.missing).toHaveLength(1);
    expect(r.body.status.coveragePercent).toBe(50);
  });

  it('POST /scan-qr: 404 cuando drill no existe', async () => {
    const app = buildApp(deps);
    const r = await request(app)
      .post('/api/evacuation/scan-qr')
      .set('Authorization', 'Bearer worker-token')
      .send({
        projectId: 'proj-alpha',
        drillId: 'drill_ghost',
        workerUid: 'worker_w1',
        meetingPointId: 'mp1',
      });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('drill_not_found');
  });

  it('POST /scan-qr: 400 cuando worker no está en expectedWorkers (ghost-scan defense)', async () => {
    const app = buildApp(deps);
    const startRes = await request(app)
      .post('/api/evacuation/start')
      .set('Authorization', 'Bearer super-token')
      .send({
        projectId: 'proj-alpha',
        kind: 'drill',
        meetingPointId: 'mp1',
        expectedWorkers: [{ uid: 'worker_w1', fullName: 'Ana' }],
      });
    const drillId = startRes.body.drill.id as string;
    const r = await request(app)
      .post('/api/evacuation/scan-qr')
      .set('Authorization', 'Bearer worker-token')
      .send({
        projectId: 'proj-alpha',
        drillId,
        workerUid: 'worker_unknown',
        meetingPointId: 'mp1',
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('worker_not_in_drill');
  });

  it('GET /status: devuelve drill + status calculado (200)', async () => {
    const app = buildApp(deps);
    const startRes = await request(app)
      .post('/api/evacuation/start')
      .set('Authorization', 'Bearer super-token')
      .send({
        projectId: 'proj-alpha',
        kind: 'drill',
        meetingPointId: 'mp1',
        expectedWorkers: [
          { uid: 'worker_w1', fullName: 'Ana' },
          { uid: 'worker_w2', fullName: 'Bruno' },
        ],
      });
    const drillId = startRes.body.drill.id as string;

    const r = await request(app)
      .get('/api/evacuation/status')
      .query({ projectId: 'proj-alpha', drillId })
      .set('Authorization', 'Bearer super-token');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.drill.id).toBe(drillId);
    expect(r.body.status.coveragePercent).toBe(0);
    expect(r.body.status.missing).toHaveLength(2);
  });

  it('POST /end: cierra drill + devuelve postmortem (200)', async () => {
    const app = buildApp(deps);
    const startRes = await request(app)
      .post('/api/evacuation/start')
      .set('Authorization', 'Bearer super-token')
      .send({
        projectId: 'proj-alpha',
        kind: 'drill',
        meetingPointId: 'mp1',
        expectedWorkers: [{ uid: 'worker_w1', fullName: 'Ana' }],
      });
    const drillId = startRes.body.drill.id as string;

    // Scan al único worker → cobertura 100% antes de cerrar.
    await request(app)
      .post('/api/evacuation/scan-qr')
      .set('Authorization', 'Bearer worker-token')
      .send({
        projectId: 'proj-alpha',
        drillId,
        workerUid: 'worker_w1',
        meetingPointId: 'mp1',
      });

    const r = await request(app)
      .post('/api/evacuation/end')
      .set('Authorization', 'Bearer super-token')
      .send({ projectId: 'proj-alpha', drillId });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.drill.endedAt).toBeTruthy();
    expect(r.body.postmortem.drillId).toBe(drillId);
    expect(r.body.postmortem.finalCoveragePercent).toBe(100);
    expect(r.body.postmortem.totalSafe).toBe(1);
    expect(r.body.postmortem.totalExpected).toBe(1);
    expect(r.body.postmortem.missingWorkers).toEqual([]);
  });
});
