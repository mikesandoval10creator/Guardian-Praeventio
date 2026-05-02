// Praeventio Guard — security item 0.2: /api/emergency/notify-brigada tests.
//
// Verifies the three security controls added when extracting the endpoint from
// the inline server.ts prototype:
//
//   1. assertProjectMemberFromBody() → 403 for cross-tenant callers
//   2. BRIGADE_ROLES gate → 403 for callers with an insufficient role
//   3. brigadeLimiter → 429 after 5 requests per uid per minute
//
// We do NOT import firebase-admin or the production emergencyRouter directly
// (both would require a live Firebase project). Instead we build a minimal
// Express app that wires the SAME middleware chain using:
//   • A test verifyAuth shim (reads `Authorization: Bearer test:uid:email:role`)
//   • assertProjectMemberFromBody() from its source module (pure TS — no admin)
//   • brigadeLimiter re-created locally with `max: 2` to keep tests fast
//   • A stub route handler that never calls admin.messaging()
//
// This mirrors the pattern used in src/__tests__/server/limiters.test.ts and
// src/__tests__/server/coachChatTenant.test.ts.

import { describe, it, expect } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

// ── in-memory project store ──────────────────────────────────────────────────

interface FakeProject {
  members: string[];
  createdBy: string;
}

function makeFakeDb(projects: Record<string, FakeProject>) {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = name === 'projects' ? projects[id] : undefined;
          return {
            exists: data !== undefined,
            data: () => data,
          };
        },
      }),
    }),
  };
}

// ── test app builder ─────────────────────────────────────────────────────────

const BRIGADE_ROLES = ['supervisor', 'gerente', 'prevencionista', 'admin'] as const;

/**
 * Builds a minimal Express app that mirrors the production
 * POST /api/emergency/notify-brigada middleware chain, but:
 *   - uses an in-memory fake Firestore for project membership checks
 *   - uses `max` overrides on brigadeLimiter so the 429 test is fast
 *   - never calls admin.messaging()
 */
function buildApp(
  projects: Record<string, FakeProject>,
  limiterMax = 100,
) {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // Test verifyAuth shim.
  // Token format: "test:uid:email:role"  (role is optional — defaults to '')
  const verifyAuth = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = authHeader.slice(7); // strip "Bearer "
    if (token === 'invalid') {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
    const [, uid = 'uid-default', email = '', role = ''] = token.split(':');
    (req as any).user = { uid, email, role };
    return next();
  };

  // assertProjectMemberFromBody — uses fake DB, no admin dependency.
  const assertMembership = () =>
    async (req: Request, res: Response, next: NextFunction) => {
      const callerUid = (req as any).user?.uid;
      const projectId = (req.body ?? {}).projectId;
      if (typeof projectId !== 'string' || projectId.length === 0) {
        return next();
      }
      if (!callerUid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      try {
        await assertProjectMember(callerUid, projectId, makeFakeDb(projects) as any);
        return next();
      } catch (err) {
        if (err instanceof ProjectMembershipError) {
          return res.status(err.httpStatus).json({ error: 'forbidden' });
        }
        return next(err);
      }
    };

  // brigadeLimiter — keyed by uid just like production; max is configurable.
  const brigadeLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: limiterMax,
    keyGenerator: (req: any) => req.user?.uid || ipKeyGenerator(req.ip ?? '') || 'anonymous',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many brigade notifications — try again in 1 minute' },
  });

  // Route handler stub — does NOT call admin.messaging().
  app.post(
    '/api/emergency/notify-brigada',
    verifyAuth,
    assertMembership(),
    brigadeLimiter,
    async (req: any, res: any) => {
      const { projectId, emergencyType } = req.body ?? {};
      if (!projectId || !emergencyType) {
        return res.status(400).json({ error: 'projectId and emergencyType are required' });
      }
      const callerRole: string | undefined = req.user?.role;
      if (!callerRole || !(BRIGADE_ROLES as readonly string[]).includes(callerRole)) {
        return res.status(403).json({ error: 'Insufficient role to trigger brigade notification' });
      }
      // Stub: pretend 0 tokens found (no admin.messaging() call).
      return res.json({ ok: true, notified: 0, message: 'No supervisor tokens found' });
    },
  );

  return app;
}

// ── tests ─────────────────────────────────────────────────────────────────────

const PROJECT_A = 'proj-alpha';
const PROJECT_B = 'proj-beta';

const PROJECTS: Record<string, FakeProject> = {
  [PROJECT_A]: { members: ['uid-member-a'], createdBy: 'uid-creator-a' },
  [PROJECT_B]: { members: ['uid-member-b'], createdBy: 'uid-creator-b' },
};

describe('POST /api/emergency/notify-brigada — security controls', () => {
  // ── 1. Authentication ────────────────────────────────────────────────────

  it('returns 401 when no Authorization header is provided', async () => {
    const app = buildApp(PROJECTS);
    const res = await request(app)
      .post('/api/emergency/notify-brigada')
      .send({ projectId: PROJECT_A, emergencyType: 'fire' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header is invalid', async () => {
    const app = buildApp(PROJECTS);
    const res = await request(app)
      .post('/api/emergency/notify-brigada')
      .set('Authorization', 'Bearer invalid')
      .send({ projectId: PROJECT_A, emergencyType: 'fire' });
    expect(res.status).toBe(401);
  });

  // ── 2. Cross-tenant membership gate (assertProjectMemberFromBody) ────────

  it('returns 403 when authenticated uid is NOT a member of the target project (cross-tenant rejection)', async () => {
    // uid-member-a is a member of PROJECT_A but NOT PROJECT_B.
    const app = buildApp(PROJECTS);
    const res = await request(app)
      .post('/api/emergency/notify-brigada')
      .set('Authorization', 'Bearer test:uid-member-a:a@test.com:supervisor')
      .send({ projectId: PROJECT_B, emergencyType: 'fire' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 403 when authenticated uid is NOT a member of any project (unknown project)', async () => {
    const app = buildApp(PROJECTS);
    const res = await request(app)
      .post('/api/emergency/notify-brigada')
      .set('Authorization', 'Bearer test:uid-outsider:x@test.com:supervisor')
      .send({ projectId: PROJECT_A, emergencyType: 'evacuation' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  // ── 3. BRIGADE_ROLES gate ────────────────────────────────────────────────

  it('returns 403 when caller is a project member but has an insufficient role (operario)', async () => {
    const projectsWithOperario: Record<string, FakeProject> = {
      [PROJECT_A]: { members: ['uid-operario'], createdBy: 'uid-creator-a' },
    };
    const app = buildApp(projectsWithOperario);
    const res = await request(app)
      .post('/api/emergency/notify-brigada')
      .set('Authorization', 'Bearer test:uid-operario:op@test.com:operario')
      .send({ projectId: PROJECT_A, emergencyType: 'fire' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Insufficient role/);
  });

  it('returns 403 when caller is a project member but has an insufficient role (visualizador)', async () => {
    const projectsWithViz: Record<string, FakeProject> = {
      [PROJECT_A]: { members: ['uid-viz'], createdBy: 'uid-creator-a' },
    };
    const app = buildApp(projectsWithViz);
    const res = await request(app)
      .post('/api/emergency/notify-brigada')
      .set('Authorization', 'Bearer test:uid-viz:viz@test.com:visualizador')
      .send({ projectId: PROJECT_A, emergencyType: 'fire' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Insufficient role/);
  });

  it('returns 403 when caller has no role claim at all', async () => {
    const projectsForNoRole: Record<string, FakeProject> = {
      [PROJECT_A]: { members: ['uid-norole'], createdBy: 'uid-creator-a' },
    };
    const app = buildApp(projectsForNoRole);
    const res = await request(app)
      .post('/api/emergency/notify-brigada')
      // Token without role segment → role defaults to ''
      .set('Authorization', 'Bearer test:uid-norole:norole@test.com')
      .send({ projectId: PROJECT_A, emergencyType: 'fire' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Insufficient role/);
  });

  // ── 4. Accepted brigade roles pass the gate ──────────────────────────────

  it.each(['supervisor', 'gerente', 'prevencionista', 'admin'] as const)(
    'returns 200 for a member with role "%s"',
    async (role) => {
      const uid = `uid-${role}`;
      const projectsForRole: Record<string, FakeProject> = {
        [PROJECT_A]: { members: [uid], createdBy: 'uid-creator-a' },
      };
      const app = buildApp(projectsForRole);
      const res = await request(app)
        .post('/api/emergency/notify-brigada')
        .set('Authorization', `Bearer test:${uid}:${role}@test.com:${role}`)
        .send({ projectId: PROJECT_A, emergencyType: 'evacuation' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    },
  );

  // ── 5. Input validation ──────────────────────────────────────────────────

  it('returns 400 when projectId is missing', async () => {
    const projectsForValidation: Record<string, FakeProject> = {
      [PROJECT_A]: { members: ['uid-sup'], createdBy: 'uid-creator-a' },
    };
    const app = buildApp(projectsForValidation);
    const res = await request(app)
      .post('/api/emergency/notify-brigada')
      .set('Authorization', 'Bearer test:uid-sup:sup@test.com:supervisor')
      .send({ emergencyType: 'fire' }); // no projectId
    // When projectId is absent, assertMembership is a no-op, then the
    // handler validates and returns 400.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/);
  });

  it('returns 400 when emergencyType is missing', async () => {
    const projectsForValidation2: Record<string, FakeProject> = {
      [PROJECT_A]: { members: ['uid-sup2'], createdBy: 'uid-creator-a' },
    };
    const app = buildApp(projectsForValidation2);
    const res = await request(app)
      .post('/api/emergency/notify-brigada')
      .set('Authorization', 'Bearer test:uid-sup2:sup@test.com:supervisor')
      .send({ projectId: PROJECT_A }); // no emergencyType
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/emergencyType/);
  });

  // ── 6. Rate limiter (brigadeLimiter) ─────────────────────────────────────

  it('returns 429 after exceeding the per-uid rate limit', async () => {
    const uid = 'uid-ratelimit';
    const projectsForRateLimit: Record<string, FakeProject> = {
      [PROJECT_A]: { members: [uid], createdBy: 'uid-creator-a' },
    };
    // Use max=2 so we hit the limit quickly without spinning up 5 requests.
    const app = buildApp(projectsForRateLimit, 2);
    const body = { projectId: PROJECT_A, emergencyType: 'fire' };
    const headers = { Authorization: `Bearer test:${uid}:rl@test.com:supervisor` };

    // First two should succeed (max=2).
    const r1 = await request(app).post('/api/emergency/notify-brigada').set(headers).send(body);
    const r2 = await request(app).post('/api/emergency/notify-brigada').set(headers).send(body);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // Third request should be rate-limited.
    const r3 = await request(app).post('/api/emergency/notify-brigada').set(headers).send(body);
    expect(r3.status).toBe(429);
    expect(r3.body.error).toMatch(/Too many brigade/);
  });
});
