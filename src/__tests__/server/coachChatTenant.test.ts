// Praeventio Guard — Round 17 R1: cross-tenant guard for /api/coach/chat.
//
// Regression: pre-R17 the coach endpoint accepted a projectId from the body
// (formerly `projectContext.id`) and used it to retrieve RAG context
// (recent incidents) without verifying the caller was a member of that
// project. A token from tenant A could pull tenant B's incident history.
// R17 R1 wires `assertProjectMemberFromBody` into the route and adds a
// strict 400 when projectId is absent (the coach endpoint cannot operate
// without a tenant scope — see comment in server.ts).
//
// Tests:
//   • 400 when projectId missing
//   • 403 when caller is not a member of the supplied projectId
//   • 200 when caller IS a member; audit row tagged with projectId

import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { InMemoryFirestore, type FakeAuth, fakeFieldValue } from './test-server.js';

function makeAuth(): FakeAuth {
  return {
    async verifyIdToken(token: string) {
      if (token === 'invalid') throw new Error('invalid');
      const [, uid, email] = token.split(':');
      return { uid: uid ?? 'uid-default', email: email || `${uid}@test.com` };
    },
    async getUser(uid: string) {
      return { uid, email: `${uid}@test.com`, customClaims: {} };
    },
    async getUserByEmail() {
      throw new Error('not used');
    },
    async setCustomUserClaims() {},
    async revokeRefreshTokens() {},
  };
}

function buildApp(fs: InMemoryFirestore, auth: FakeAuth): Express {
  const app = express();
  app.use(express.json({ limit: '64kb' }));

  const verifyAuth = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
      const decoded = await auth.verifyIdToken(token);
      (req as any).user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
  };

  // Mirror of `assertProjectMemberFromBody()` middleware. Identical contract
  // — the fact we're using the SAME `assertProjectMember` pure helper means
  // the production middleware and this test middleware reach 1:1 verdicts.
  const assertMember = async (req: Request, res: Response, next: NextFunction) => {
    const callerUid = (req as any).user?.uid;
    const projectId = (req.body ?? {}).projectId;
    if (typeof projectId !== 'string' || projectId.length === 0) {
      return next();
    }
    if (!callerUid) return res.status(401).json({ error: 'Unauthorized' });
    try {
      await assertProjectMember(callerUid, projectId, fs as any);
      return next();
    } catch (err) {
      if (err instanceof ProjectMembershipError) {
        return res.status(err.httpStatus).json({ error: 'forbidden' });
      }
      return next(err);
    }
  };

  app.post('/api/coach/chat', verifyAuth, assertMember, async (req, res) => {
    const { message, projectId } = req.body ?? {};
    if (typeof projectId !== 'string' || projectId.length === 0) {
      return res.status(400).json({ error: 'projectId is required' });
    }
    // Audit row.
    await fs.collection('audit_logs').add({
      action: 'coach.chat',
      module: 'coach',
      details: { projectId, messageLength: typeof message === 'string' ? message.length : 0 },
      userId: (req as any).user.uid,
      projectId,
      timestamp: fakeFieldValue.serverTimestamp(),
    });
    res.json({ success: true, response: 'echo' });
  });

  return app;
}

let fs: InMemoryFirestore;
let app: Express;

beforeEach(() => {
  fs = new InMemoryFirestore();
  app = buildApp(fs, makeAuth());
});

describe('POST /api/coach/chat — cross-tenant guard (R17 R1)', () => {
  it('returns 400 when projectId is missing from body', async () => {
    const res = await request(app)
      .post('/api/coach/chat')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ message: 'hola' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/projectId/i);
  });

  it('returns 403 when caller is not a member of the supplied projectId (cross-tenant)', async () => {
    // proj-A belongs to tenant A (uid-A is the only member). uid-Z belongs
    // to tenant Z and tries to pull proj-A context.
    fs.store.set('projects/proj-A', {
      name: 'Faena Norte',
      members: ['uid-A'],
      createdBy: 'uid-A',
    });
    const res = await request(app)
      .post('/api/coach/chat')
      .set('Authorization', 'Bearer test:uid-Z:z@test.com')
      .send({ message: 'leak my data', projectId: 'proj-A' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    // Critical: NO audit row should have been written — the endpoint denied
    // before reaching the body of the handler.
    expect(fs.audit.find((e) => e.action === 'coach.chat')).toBeUndefined();
  });

  it('returns 403 when projectId references a non-existent project', async () => {
    const res = await request(app)
      .post('/api/coach/chat')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ message: 'hi', projectId: 'ghost-project' });
    expect(res.status).toBe(403);
  });

  it('returns 200 + writes audit row when caller IS a member of projectId', async () => {
    fs.store.set('projects/proj-A', {
      name: 'Faena Norte',
      members: ['uid-A'],
      createdBy: 'uid-A',
    });
    const res = await request(app)
      .post('/api/coach/chat')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ message: 'hola', projectId: 'proj-A' });
    expect(res.status).toBe(200);
    const row = fs.audit.find((e) => e.action === 'coach.chat');
    expect(row).toBeDefined();
    expect(row?.projectId).toBe('proj-A');
    expect(row?.userId).toBe('uid-A');
  });
});
