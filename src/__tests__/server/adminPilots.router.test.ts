// Real-router supertest for the new admin pilot entitlement endpoints. The
// security contract: admin role gate (server-authoritative via Auth custom
// claims), input validation (organizationId / grantedTierId / window / origin),
// and audit-log emission (every grant and revoke must land in audit_logs).
//
// 401 (no auth) / 403 (non-admin) / 400 (bad input) / 200 (happy path).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// codeql[js/missing-rate-limiting]  // test harness: global limiter intentionally not mounted (see test-server.ts).

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  auditEvents: [] as Array<{ action: string; resource: string; details: unknown }>,
  // Custom claim record per uid (re-read by isAdminRole guard).
  roles: {} as Record<string, string | undefined>,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  const auth = {
    getUser: async (uid: string) => ({
      uid,
      customClaims: { role: H.roles[uid] ?? 'worker' },
    }),
    setCustomUserClaims: async () => {},
    revokeRefreshTokens: async () => {},
  };
  return adminMock(() => H.db!, auth);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      email: req.header('x-test-email') ?? null,
      role: req.header('x-test-claim-role') ?? 'worker',
    };
    next();
  },
}));
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: async (
    _req: Request,
    action: string,
    resource: string,
    details: unknown,
  ) => {
    H.auditEvents.push({ action, resource, details });
  },
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn((res: Response, err: Error) => {
    res.status(500).json({ error: 'internal_error', message: err?.message });
  }),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { adminPilotsRouter } from '../../server/routes/adminPilots.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminPilotsRouter);
  return app;
}

const VALID_BODY = {
  organizationId: 'org_001',
  grantedTierId: 'oro',
  startsAt: '2026-09-20T00:00:00Z',
  endsAt: '2026-10-20T00:00:00Z',
  campaign: 'launch_q4',
  cohort: 'beta',
  origin: 'manual_admin',
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.auditEvents = [];
  H.roles = {};
});

describe('adminPilotsRouter (real router, supertest)', () => {
  describe('POST /api/admin/pilots', () => {
    it('returns 401 when no auth header is provided', async () => {
      const res = await request(buildApp())
        .post('/api/admin/pilots')
        .send(VALID_BODY);
      expect(res.status).toBe(401);
    });

    it('returns 403 when caller is a non-admin role', async () => {
      const res = await request(buildApp())
        .post('/api/admin/pilots')
        .set('x-test-uid', 'u_worker')
        .set('x-test-claim-role', 'worker')
        .send(VALID_BODY);
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'admin_role_required' });
    });

    it('returns 400 when organizationId is missing', async () => {
      const { organizationId: _omit, ...body } = VALID_BODY;
      const res = await request(buildApp())
        .post('/api/admin/pilots')
        .set('x-test-uid', 'u_admin')
        .set('x-test-claim-role', 'admin')
        .send(body);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_organizationId' });
    });

    it('returns 400 when grantedTierId is invalid', async () => {
      const res = await request(buildApp())
        .post('/api/admin/pilots')
        .set('x-test-uid', 'u_admin')
        .set('x-test-claim-role', 'admin')
        .send({ ...VALID_BODY, grantedTierId: 'diamond' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'invalid_grantedTierId' });
    });

    it('returns 400 when endsAt is before startsAt', async () => {
      const res = await request(buildApp())
        .post('/api/admin/pilots')
        .set('x-test-uid', 'u_admin')
        .set('x-test-claim-role', 'admin')
        .send({ ...VALID_BODY, startsAt: '2026-10-20T00:00:00Z', endsAt: '2026-09-20T00:00:00Z' });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'endsAt_before_startsAt' });
    });

    it('returns 201 and writes audit event when admin grants a pilot', async () => {
      const res = await request(buildApp())
        .post('/api/admin/pilots')
        .set('x-test-uid', 'u_admin')
        .set('x-test-email', 'admin@test.com')
        .set('x-test-claim-role', 'admin')
        .send(VALID_BODY);
      expect(res.status).toBe(201);
      expect(res.body.pilotId).toMatch(/^pilot_\d+_[a-z0-9]+$/);
      expect(res.body.status).toBe('active');
      expect(res.body.payload.grantedBy).toEqual({
        uid: 'u_admin',
        email: 'admin@test.com',
      });
      // audit_log entry recorded
      expect(H.auditEvents).toHaveLength(1);
      expect(H.auditEvents[0]).toMatchObject({
        action: 'pilot.granted',
        resource: 'admin',
      });
    });
  });
});
