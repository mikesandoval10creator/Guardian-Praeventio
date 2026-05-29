// Real-router supertest for the invitations router (the most security-sensitive
// boundary in projects.ts): public info preview + authenticated accept. Bug-
// hunting: token preview must not leak the raw token; accept must enforce
// email-match, expiry, and the cross-project projectId IDOR defense, and only
// then add the caller as a member with the invited (project-scoped) role.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!, {});
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string; email: string } }).user = {
      uid,
      email: req.header('x-test-email') ?? `${uid}@x.cl`,
    };
    next();
  },
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: vi.fn(async () => ({ id: 'e' })) }; } }));
vi.mock('../../services/email/resendService.js', () => ({ EmailService: { fromEnv: () => null } }));
vi.mock('../../services/email/templates.js', () => ({ projectInvitationTemplate: () => '<html>' }));
vi.mock('../../services/analytics/serverAdapter.js', () => ({ serverAnalytics: { track: vi.fn(async () => {}) } }));
vi.mock('../../services/observability/index.js', () => ({ getErrorTracker: () => ({ captureException: vi.fn() }) }));
vi.mock('../../utils/logger.js', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

import { invitationsRouter } from '../../server/routes/projects.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/invitations', invitationsRouter);
  return app;
}
const future = () => new Date(Date.now() + 86_400_000).toISOString();
const past = () => new Date(Date.now() - 86_400_000).toISOString();

function seedInvite(over: Record<string, unknown> = {}) {
  H.db!._seed('invitations/i1', {
    token: 'tok1', status: 'pending', invitedEmail: 'invited@x.cl', invitedRole: 'operario',
    projectId: 'p1', projectName: 'Obra Norte', expiresAt: future(), createdAt: new Date().toISOString(),
    ...over,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { name: 'Obra Norte', createdBy: 'creator1', members: ['creator1'], memberRoles: { creator1: 'gerente' } });
});

describe('GET /api/invitations/info/:token (public preview)', () => {
  it('404 for an unknown token', async () => {
    expect((await request(buildApp()).get('/api/invitations/info/nope')).status).toBe(404);
  });

  it('410 for an expired invitation', async () => {
    seedInvite({ expiresAt: past() });
    expect((await request(buildApp()).get('/api/invitations/info/tok1')).status).toBe(410);
  });

  it('200 returns only safe fields — never the raw token', async () => {
    seedInvite();
    const res = await request(buildApp()).get('/api/invitations/info/tok1');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ projectName: 'Obra Norte', invitedRole: 'operario', invitedEmail: 'invited@x.cl' });
    expect(res.body.token).toBeUndefined(); // token not leaked in preview
  });
});

describe('POST /api/invitations/:token/accept', () => {
  it('401 without auth', async () => {
    seedInvite();
    expect((await request(buildApp()).post('/api/invitations/tok1/accept').send({})).status).toBe(401);
  });

  it('404 for an unknown / already-used token', async () => {
    const res = await request(buildApp()).post('/api/invitations/nope/accept').set({ 'x-test-uid': 'u9' }).send({});
    expect(res.status).toBe(404);
  });

  it('403 when the caller email does not match the invited email', async () => {
    seedInvite({ invitedEmail: 'someone-else@x.cl' });
    const res = await request(buildApp())
      .post('/api/invitations/tok1/accept')
      .set({ 'x-test-uid': 'u9', 'x-test-email': 'attacker@x.cl' })
      .send({});
    expect(res.status).toBe(403);
  });

  it('410 when the invitation has expired', async () => {
    seedInvite({ expiresAt: past() });
    const res = await request(buildApp())
      .post('/api/invitations/tok1/accept')
      .set({ 'x-test-uid': 'u9', 'x-test-email': 'invited@x.cl' })
      .send({});
    expect(res.status).toBe(410);
  });

  it('403 IDOR — a mismatched claimed projectId is rejected', async () => {
    seedInvite();
    const res = await request(buildApp())
      .post('/api/invitations/tok1/accept')
      .set({ 'x-test-uid': 'u9', 'x-test-email': 'invited@x.cl' })
      .send({ projectId: 'EVIL_PROJECT' });
    expect(res.status).toBe(403);
    // membership unchanged
    expect((H.db!._dump()['projects/p1'] as { members: string[] }).members).not.toContain('u9');
  });

  it('200 adds the caller as a member with the invited role + marks accepted', async () => {
    seedInvite();
    const res = await request(buildApp())
      .post('/api/invitations/tok1/accept')
      .set({ 'x-test-uid': 'u9', 'x-test-email': 'invited@x.cl' })
      .send({ projectId: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ projectId: 'p1', role: 'operario' });
    const proj = H.db!._dump()['projects/p1'] as { members: string[]; memberRoles: Record<string, string> };
    expect(proj.members).toContain('u9');
    expect(proj.memberRoles.u9).toBe('operario');
    expect((H.db!._dump()['invitations/i1'] as { status: string }).status).toBe('accepted');
  });

  it('404 when the invitation points to a missing project', async () => {
    seedInvite({ projectId: 'ghost' });
    const res = await request(buildApp())
      .post('/api/invitations/tok1/accept')
      .set({ 'x-test-uid': 'u9', 'x-test-email': 'invited@x.cl' })
      .send({});
    expect(res.status).toBe(404);
  });
});
