// Praeventio Guard — Round 15 (I3 / A6): Project membership endpoints.
//
// Covers the invite + accept flow that R5/R1 hardened:
//   • POST /api/projects/:id/invite — verifyAuth + project ownership
//   • GET  /api/invitations/info/:token — public + token validation
//   • POST /api/invitations/:token/accept — public+ token + new member added

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import {
  buildTestServer,
  type TestServerHandle,
  type FakeAuth,
  InMemoryFirestore,
} from './test-server.js';

let handle: TestServerHandle;
let fs: InMemoryFirestore;

function makeAuth(uidEmail: Record<string, string>): FakeAuth {
  const byEmail = new Map<string, string>();
  for (const [uid, email] of Object.entries(uidEmail)) byEmail.set(email, uid);
  return {
    async verifyIdToken(token: string) {
      if (token === 'invalid') throw new Error('invalid token');
      const [, uid, email] = token.split(':');
      return { uid: uid ?? 'uid-default', email: email || `${uid}@test.com` };
    },
    async getUser(uid: string) {
      const email = uidEmail[uid];
      return { uid, email, customClaims: {} };
    },
    async getUserByEmail(email: string) {
      const uid = byEmail.get(email);
      if (!uid) throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
      return { uid, email, customClaims: {} };
    },
    async setCustomUserClaims() {},
    async revokeRefreshTokens() {},
  };
}

describe('POST /api/projects/:id/invite', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
    handle = buildTestServer({
      firestore: fs,
      auth: makeAuth({ 'uid-creator': 'creator@test.com' }),
    });
  });

  it('returns 401 unauthed', async () => {
    const res = await request(handle.app)
      .post('/api/projects/proj-1/invite')
      .send({ invitedEmail: 'x@y.cl', invitedRole: 'operario' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when invitedEmail is missing', async () => {
    const res = await request(handle.app)
      .post('/api/projects/proj-1/invite')
      .set('Authorization', 'Bearer test:uid-creator:creator@test.com')
      .send({ invitedRole: 'operario' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when project does not exist', async () => {
    const res = await request(handle.app)
      .post('/api/projects/ghost/invite')
      .set('Authorization', 'Bearer test:uid-creator:creator@test.com')
      .send({ invitedEmail: 'x@y.cl', invitedRole: 'operario' });
    expect(res.status).toBe(404);
  });

  it('returns 403 when caller is not the project creator and not admin/gerente', async () => {
    fs.store.set('projects/proj-1', { name: 'Faena Norte', createdBy: 'uid-other' });
    const res = await request(handle.app)
      .post('/api/projects/proj-1/invite')
      .set('Authorization', 'Bearer test:uid-creator:creator@test.com')
      .send({ invitedEmail: 'x@y.cl', invitedRole: 'operario' });
    expect(res.status).toBe(403);
  });

  it('happy path: creator invites a new email + email is dispatched', async () => {
    fs.store.set('projects/proj-1', {
      name: 'Faena Norte',
      createdBy: 'uid-creator',
      members: ['uid-creator'],
    });
    const resendSend = vi.fn(async () => ({ id: 'msg_x' }));
    handle = buildTestServer({
      firestore: fs,
      auth: makeAuth({ 'uid-creator': 'creator@test.com' }),
      resendSend,
    });
    const res = await request(handle.app)
      .post('/api/projects/proj-1/invite')
      .set('Authorization', 'Bearer test:uid-creator:creator@test.com')
      .send({ invitedEmail: 'newhire@test.com', invitedRole: 'operario' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.token).toBeTruthy();
    // Invitation persisted
    const invKey = [...fs.store.keys()].find((k) => k.startsWith('invitations/'));
    expect(invKey).toBeDefined();
    expect(fs.store.get(invKey!)).toMatchObject({
      projectId: 'proj-1',
      invitedEmail: 'newhire@test.com',
      status: 'pending',
    });
    // Email sent
    expect(resendSend).toHaveBeenCalledTimes(1);
  });

  it('returns 409 when an existing pending invitation already exists for the email', async () => {
    fs.store.set('projects/proj-1', { createdBy: 'uid-creator', members: [] });
    fs.store.set('invitations/existing', {
      projectId: 'proj-1',
      invitedEmail: 'dup@test.com',
      status: 'pending',
    });
    const res = await request(handle.app)
      .post('/api/projects/proj-1/invite')
      .set('Authorization', 'Bearer test:uid-creator:creator@test.com')
      .send({ invitedEmail: 'dup@test.com', invitedRole: 'operario' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/invitations/info/:token', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
    handle = buildTestServer({ firestore: fs });
  });

  it('does NOT require auth (public preview)', async () => {
    fs.store.set('invitations/inv-x', {
      token: 'tk-public',
      status: 'pending',
      projectName: 'Acme',
      invitedRole: 'operario',
      invitedEmail: 'x@y.cl',
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    });
    const res = await request(handle.app).get('/api/invitations/info/tk-public');
    expect(res.status).toBe(200);
    expect(res.body.projectName).toBe('Acme');
    expect(res.body.invitedRole).toBe('operario');
  });

  it('returns 404 when token is unknown', async () => {
    const res = await request(handle.app).get('/api/invitations/info/no-such-token');
    expect(res.status).toBe(404);
  });

  it('returns 410 when invitation has expired', async () => {
    fs.store.set('invitations/inv-old', {
      token: 'tk-old',
      status: 'pending',
      projectName: 'Acme',
      invitedRole: 'operario',
      invitedEmail: 'x@y.cl',
      expiresAt: new Date(Date.now() - 86400_000).toISOString(), // yesterday
    });
    const res = await request(handle.app).get('/api/invitations/info/tk-old');
    expect(res.status).toBe(410);
  });
});

describe('POST /api/invitations/:token/accept', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
    handle = buildTestServer({ firestore: fs });
  });

  it('returns 401 unauthed', async () => {
    const res = await request(handle.app).post('/api/invitations/tok-1/accept').send({});
    expect(res.status).toBe(401);
  });

  it('returns 404 when token is unknown', async () => {
    const res = await request(handle.app)
      .post('/api/invitations/no-such/accept')
      .set('Authorization', 'Bearer test:uid-newhire:newhire@test.com');
    expect(res.status).toBe(404);
  });

  it('returns 403 when caller email mismatches the invitation', async () => {
    fs.store.set('invitations/inv-x', {
      token: 'tk',
      status: 'pending',
      invitedEmail: 'expected@test.com',
      invitedRole: 'operario',
      projectId: 'proj-1',
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    });
    const res = await request(handle.app)
      .post('/api/invitations/tk/accept')
      .set('Authorization', 'Bearer test:uid-other:other@test.com');
    expect(res.status).toBe(403);
  });

  it('returns 410 when invitation has expired (and flips status to expired)', async () => {
    fs.store.set('invitations/inv-old', {
      token: 'tk-old',
      status: 'pending',
      invitedEmail: 'late@test.com',
      invitedRole: 'operario',
      projectId: 'proj-1',
      expiresAt: new Date(Date.now() - 86400_000).toISOString(),
    });
    const res = await request(handle.app)
      .post('/api/invitations/tk-old/accept')
      .set('Authorization', 'Bearer test:uid-late:late@test.com');
    expect(res.status).toBe(410);
    expect((fs.store.get('invitations/inv-old') as any).status).toBe('expired');
  });

  it('happy path: caller accepts → added to project members + invitation marked accepted', async () => {
    fs.store.set('projects/proj-1', { name: 'Faena Norte', members: [], memberRoles: {} });
    fs.store.set('invitations/inv-ok', {
      token: 'tk-ok',
      status: 'pending',
      invitedEmail: 'newhire@test.com',
      invitedRole: 'supervisor',
      projectId: 'proj-1',
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    });
    const res = await request(handle.app)
      .post('/api/invitations/tk-ok/accept')
      .set('Authorization', 'Bearer test:uid-newhire:newhire@test.com');
    expect(res.status).toBe(200);
    expect(res.body.projectId).toBe('proj-1');
    expect(res.body.role).toBe('supervisor');
    // Project members updated
    const proj = fs.store.get('projects/proj-1') as any;
    expect(proj.members).toContain('uid-newhire');
    expect(proj.memberRoles['uid-newhire']).toBe('supervisor');
    // Invitation marked accepted
    expect((fs.store.get('invitations/inv-ok') as any).status).toBe('accepted');
  });
});
