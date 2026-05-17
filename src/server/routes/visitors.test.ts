// Praeventio Guard — Sprint K §23-24 smoke tests for /api/visitors.
//
// Follows the parallel-app pattern used by `iot.test.ts`: we cannot
// initialize firebase-admin in tests, so we rebuild a minimal Express
// app that mirrors the real route's status codes and JSON envelopes,
// proxying writes/reads through an in-memory store. This exercises the
// contract that matters: payload validation, host-uid binding, tenant
// resolution, and 200/400/401/404 status surfaces.

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import {
  registerVisitor,
  acknowledgeInduction,
  checkOutVisitor,
  isActive,
  type Visitor,
} from '../../services/visitorControl/visitorRegistry.js';

interface FakeUser {
  uid: string;
}

interface VisitorsTestDeps {
  users: Map<string, FakeUser>;
  /** Map from `projects/{id}` to `{ tenantId }`. */
  projectDocs: Map<string, { tenantId: string } | null>;
  /** Map from `tenants/{tid}/projects/{pid}/visitors/{vid}` to Visitor. */
  visitors: Map<string, Visitor>;
}

const checkInSchema = z.object({
  projectId: z.string().min(1).max(128),
  fullName: z.string().min(3).max(256),
  rut: z.string().min(3).max(32),
  company: z.string().min(1).max(256),
  reason: z.string().min(1).max(1024),
  id: z.string().min(1).max(128).optional(),
});

const acknowledgeSchema = z.object({
  inductionVersionId: z.string().min(1).max(128),
});

const listQuerySchema = z.object({
  projectId: z.string().min(1).max(128),
});

function visitorKey(tenantId: string, projectId: string, visitorId: string): string {
  return `tenants/${tenantId}/projects/${projectId}/visitors/${visitorId}`;
}

function buildVisitorsApp(deps: VisitorsTestDeps): Express {
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

  app.post(
    '/api/visitors/check-in',
    verifyAuth,
    validate(checkInSchema),
    async (req: any, res: any) => {
      const hostUid = req.user.uid;
      const body = req.validated as z.infer<typeof checkInSchema>;
      const tenantId = tenantIdFor(body.projectId);
      if (!tenantId) {
        return res.status(400).json({ error: 'project_missing_tenant' });
      }
      const visitorId = body.id ?? `vis_test_${deps.visitors.size + 1}`;
      try {
        const event = registerVisitor({
          id: visitorId,
          fullName: body.fullName,
          rut: body.rut,
          company: body.company,
          hostUid,
          reason: body.reason,
          projectId: body.projectId,
          tenantId,
        });
        deps.visitors.set(
          visitorKey(tenantId, body.projectId, visitorId),
          event.visitor,
        );
        return res.json({ ok: true, visitor: event.visitor });
      } catch (err: any) {
        return res.status(400).json({ error: err.code ?? 'invalid_payload' });
      }
    },
  );

  app.post('/api/visitors/:id/check-out', verifyAuth, async (req: any, res: any) => {
    const visitorId = req.params.id;
    const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : '';
    if (!visitorId || !projectId) {
      return res.status(400).json({ error: 'invalid_payload' });
    }
    const tenantId = tenantIdFor(projectId);
    if (!tenantId) {
      return res.status(400).json({ error: 'project_missing_tenant' });
    }
    const key = visitorKey(tenantId, projectId, visitorId);
    const existing = deps.visitors.get(key);
    if (!existing) {
      return res.status(404).json({ error: 'visitor_not_found' });
    }
    const event = checkOutVisitor(visitorId);
    deps.visitors.set(key, { ...existing, checkOutAt: event.checkOutAt });
    return res.json({ ok: true, visitorId, checkOutAt: event.checkOutAt });
  });

  app.post(
    '/api/visitors/:id/acknowledge-induction',
    verifyAuth,
    validate(acknowledgeSchema),
    async (req: any, res: any) => {
      const visitorId = req.params.id;
      const { inductionVersionId } = req.validated as z.infer<typeof acknowledgeSchema>;
      const projectId =
        typeof req.body?.projectId === 'string' ? req.body.projectId : '';
      if (!visitorId || !projectId) {
        return res.status(400).json({ error: 'invalid_payload' });
      }
      const tenantId = tenantIdFor(projectId);
      if (!tenantId) {
        return res.status(400).json({ error: 'project_missing_tenant' });
      }
      const key = visitorKey(tenantId, projectId, visitorId);
      const existing = deps.visitors.get(key);
      if (!existing) {
        return res.status(404).json({ error: 'visitor_not_found' });
      }
      const event = acknowledgeInduction(visitorId, inductionVersionId);
      deps.visitors.set(key, {
        ...existing,
        inductionVersionId: event.inductionVersionId,
        inductedAt: event.inductedAt,
      });
      return res.json({
        ok: true,
        visitorId,
        inductionVersionId: event.inductionVersionId,
        inductedAt: event.inductedAt,
      });
    },
  );

  app.get(
    '/api/visitors',
    verifyAuth,
    validate(listQuerySchema, 'query'),
    async (req: any, res: any) => {
      const { projectId } = req.validated as z.infer<typeof listQuerySchema>;
      const tenantId = tenantIdFor(projectId);
      if (!tenantId) {
        return res.status(400).json({ error: 'project_missing_tenant' });
      }
      const prefix = `tenants/${tenantId}/projects/${projectId}/visitors/`;
      const visitors: Visitor[] = [];
      for (const [k, v] of deps.visitors) {
        if (k.startsWith(prefix) && isActive(v)) visitors.push(v);
      }
      return res.json({ ok: true, visitors });
    },
  );

  return app;
}

describe('/api/visitors', () => {
  let deps: VisitorsTestDeps;

  beforeEach(() => {
    deps = {
      users: new Map([
        ['host-token', { uid: 'host_uid_alpha' }],
        ['other-host-token', { uid: 'host_uid_beta' }],
      ]),
      projectDocs: new Map([
        ['projects/proj-alpha', { tenantId: 'tenant_alpha' }],
        ['projects/proj-orphan', null],
      ]),
      visitors: new Map(),
    };
  });

  // ────────────────────────────────────────────────────────────────
  // check-in
  // ────────────────────────────────────────────────────────────────

  it('check-in: registers a visit and binds hostUid from token (200)', async () => {
    const app = buildVisitorsApp(deps);
    const r = await request(app)
      .post('/api/visitors/check-in')
      .set('Authorization', 'Bearer host-token')
      .send({
        projectId: 'proj-alpha',
        fullName: 'Ana Visitante',
        rut: '12.345.678-9',
        company: 'Auditora SpA',
        reason: 'Auditoría externa ISO 45001',
      });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.visitor.hostUid).toBe('host_uid_alpha');
    expect(r.body.visitor.tenantId).toBe('tenant_alpha');
    expect(r.body.visitor.projectId).toBe('proj-alpha');
    expect(r.body.visitor.rut).toBe('12.345.678-9');
    expect(r.body.visitor.checkOutAt).toBeUndefined();
  });

  it('check-in: 401 without bearer token', async () => {
    const app = buildVisitorsApp(deps);
    const r = await request(app)
      .post('/api/visitors/check-in')
      .send({
        projectId: 'proj-alpha',
        fullName: 'Ana',
        rut: '12.345.678-9',
        company: 'X',
        reason: 'Visita',
      });
    expect(r.status).toBe(401);
  });

  it('check-in: 400 when fullName fails Zod (too short)', async () => {
    const app = buildVisitorsApp(deps);
    const r = await request(app)
      .post('/api/visitors/check-in')
      .set('Authorization', 'Bearer host-token')
      .send({
        projectId: 'proj-alpha',
        fullName: 'A',
        rut: '12.345.678-9',
        company: 'X',
        reason: 'Visita',
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_payload');
  });

  it('check-in: 400 when project has no tenantId', async () => {
    const app = buildVisitorsApp(deps);
    const r = await request(app)
      .post('/api/visitors/check-in')
      .set('Authorization', 'Bearer host-token')
      .send({
        projectId: 'proj-orphan',
        fullName: 'Ana Visitante',
        rut: '12.345.678-9',
        company: 'X SA',
        reason: 'Visita',
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('project_missing_tenant');
  });

  it('check-in: 400 when RUT is malformed', async () => {
    const app = buildVisitorsApp(deps);
    const r = await request(app)
      .post('/api/visitors/check-in')
      .set('Authorization', 'Bearer host-token')
      .send({
        projectId: 'proj-alpha',
        fullName: 'Ana Visitante',
        rut: 'NOT-A-RUT',
        company: 'X SA',
        reason: 'Visita',
      });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('INVALID_RUT');
  });

  // ────────────────────────────────────────────────────────────────
  // check-out
  // ────────────────────────────────────────────────────────────────

  it('check-out: closes an active visit (200)', async () => {
    const app = buildVisitorsApp(deps);
    const checkIn = await request(app)
      .post('/api/visitors/check-in')
      .set('Authorization', 'Bearer host-token')
      .send({
        projectId: 'proj-alpha',
        fullName: 'Ana Visitante',
        rut: '12.345.678-9',
        company: 'X SA',
        reason: 'Visita',
      });
    const visitorId = checkIn.body.visitor.id as string;
    const r = await request(app)
      .post(`/api/visitors/${visitorId}/check-out`)
      .set('Authorization', 'Bearer host-token')
      .send({ projectId: 'proj-alpha' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.checkOutAt).toBeTruthy();
  });

  it('check-out: 404 if visitor does not exist', async () => {
    const app = buildVisitorsApp(deps);
    const r = await request(app)
      .post('/api/visitors/vis_ghost/check-out')
      .set('Authorization', 'Bearer host-token')
      .send({ projectId: 'proj-alpha' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('visitor_not_found');
  });

  // ────────────────────────────────────────────────────────────────
  // acknowledge-induction
  // ────────────────────────────────────────────────────────────────

  it('acknowledge-induction: pins inductionVersionId + inductedAt (200)', async () => {
    const app = buildVisitorsApp(deps);
    const checkIn = await request(app)
      .post('/api/visitors/check-in')
      .set('Authorization', 'Bearer host-token')
      .send({
        projectId: 'proj-alpha',
        fullName: 'Ana Visitante',
        rut: '12.345.678-9',
        company: 'X SA',
        reason: 'Visita',
      });
    const visitorId = checkIn.body.visitor.id as string;
    const r = await request(app)
      .post(`/api/visitors/${visitorId}/acknowledge-induction`)
      .set('Authorization', 'Bearer host-token')
      .send({ projectId: 'proj-alpha', inductionVersionId: 'ind-v2026-05' });
    expect(r.status).toBe(200);
    expect(r.body.inductionVersionId).toBe('ind-v2026-05');
    expect(r.body.inductedAt).toBeTruthy();
  });

  it('acknowledge-induction: 400 when inductionVersionId is missing', async () => {
    const app = buildVisitorsApp(deps);
    const r = await request(app)
      .post('/api/visitors/vis_nonexistent/acknowledge-induction')
      .set('Authorization', 'Bearer host-token')
      .send({ projectId: 'proj-alpha' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_payload');
  });

  // ────────────────────────────────────────────────────────────────
  // GET list
  // ────────────────────────────────────────────────────────────────

  it('GET: lists only active visitors for a project (200)', async () => {
    const app = buildVisitorsApp(deps);
    // visitor 1 — active
    const c1 = await request(app)
      .post('/api/visitors/check-in')
      .set('Authorization', 'Bearer host-token')
      .send({
        projectId: 'proj-alpha',
        fullName: 'Visita 1',
        rut: '12.345.678-9',
        company: 'X SA',
        reason: 'Visita',
      });
    // visitor 2 — will be checked out
    const c2 = await request(app)
      .post('/api/visitors/check-in')
      .set('Authorization', 'Bearer host-token')
      .send({
        projectId: 'proj-alpha',
        fullName: 'Visita 2',
        rut: '11.111.111-1',
        company: 'Y SA',
        reason: 'Visita',
      });
    await request(app)
      .post(`/api/visitors/${c2.body.visitor.id}/check-out`)
      .set('Authorization', 'Bearer host-token')
      .send({ projectId: 'proj-alpha' });
    // List should return only visitor 1
    const r = await request(app)
      .get('/api/visitors?projectId=proj-alpha')
      .set('Authorization', 'Bearer host-token');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.visitors).toHaveLength(1);
    expect(r.body.visitors[0].id).toBe(c1.body.visitor.id);
  });

  it('GET: 400 when projectId query param is missing', async () => {
    const app = buildVisitorsApp(deps);
    const r = await request(app)
      .get('/api/visitors')
      .set('Authorization', 'Bearer host-token');
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_payload');
  });
});
