// Praeventio Guard — Round 15 (I3 / A6): admin endpoints HTTP tests.
//
// Both /api/admin/set-role and /api/admin/revoke-access are gated by
// `isAdminRole(callerRecord.customClaims?.role)`. Cover:
//   • 401 unauthed
//   • 400 invalid uid (regex)
//   • 403 non-admin caller
//   • 200 happy path + audit row + claim mutation propagated to fake auth

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import {
  buildTestServer,
  type TestServerHandle,
  type FakeAuth,
  InMemoryFirestore,
} from './test-server.js';

function makeAuth(roleByUid: Record<string, string>): FakeAuth {
  return {
    async verifyIdToken(token: string) {
      if (token === 'invalid') throw new Error('invalid token');
      const [, uid, email] = token.split(':');
      return { uid: uid ?? 'uid-default', email: email || `${uid}@test.com` };
    },
    async getUser(uid: string) {
      return { uid, email: `${uid}@test.com`, customClaims: { role: roleByUid[uid] } };
    },
    async getUserByEmail() {
      throw new Error('not used');
    },
    async setCustomUserClaims() {},
    async revokeRefreshTokens() {},
  };
}

let handle: TestServerHandle;
let fs: InMemoryFirestore;

describe('POST /api/admin/set-role', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
    const auth = makeAuth({ 'uid-admin': 'admin', 'uid-worker': 'operario' });
    handle = buildTestServer({ firestore: fs, auth });
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(handle.app)
      .post('/api/admin/set-role')
      .send({ uid: 'uid-target', role: 'supervisor' });
    expect(res.status).toBe(401);
  });

  it('rejects invalid uid format with 400', async () => {
    const res = await request(handle.app)
      .post('/api/admin/set-role')
      .set('Authorization', 'Bearer test:uid-admin:a@test.com')
      .send({ uid: 'has spaces', role: 'supervisor' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uid/i);
  });

  it('rejects non-admin caller with 403', async () => {
    const res = await request(handle.app)
      .post('/api/admin/set-role')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ uid: 'uid-target', role: 'supervisor' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  it('rejects invalid role values with 400', async () => {
    const res = await request(handle.app)
      .post('/api/admin/set-role')
      .set('Authorization', 'Bearer test:uid-admin:a@test.com')
      .send({ uid: 'uid-target', role: 'pirate' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/i);
  });

  it('happy path: admin sets a valid role and writes audit_log', async () => {
    const auth = makeAuth({ 'uid-admin': 'admin', 'uid-target': 'operario' });
    const setSpy = vi.fn();
    const revokeSpy = vi.fn();
    auth.setCustomUserClaims = async (...args) => setSpy(...args);
    auth.revokeRefreshTokens = async (...args) => revokeSpy(...args);
    handle = buildTestServer({ firestore: fs, auth });

    const res = await request(handle.app)
      .post('/api/admin/set-role')
      .set('Authorization', 'Bearer test:uid-admin:a@test.com')
      .send({ uid: 'uid-target', role: 'supervisor' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(setSpy).toHaveBeenCalledWith('uid-target', { role: 'supervisor' });
    expect(revokeSpy).toHaveBeenCalledWith('uid-target');
    const audit = fs.audit.find((e) => e.action === 'set_role');
    expect(audit).toMatchObject({
      actor: 'uid-admin',
      target: 'uid-target',
      oldRole: 'operario',
      newRole: 'supervisor',
    });
  });

  it('captures oldRole as null when target user has no role yet', async () => {
    const auth = makeAuth({ 'uid-admin': 'admin' });
    handle = buildTestServer({ firestore: fs, auth });
    const res = await request(handle.app)
      .post('/api/admin/set-role')
      .set('Authorization', 'Bearer test:uid-admin:a@test.com')
      .send({ uid: 'fresh-user', role: 'operario' });
    expect(res.status).toBe(200);
    const audit = fs.audit.find((e) => e.action === 'set_role');
    expect(audit?.oldRole).toBeNull();
  });
});

describe('POST /api/admin/revoke-access', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
    handle = buildTestServer({
      firestore: fs,
      auth: makeAuth({ 'uid-admin': 'admin', 'uid-worker': 'operario' }),
    });
  });

  it('rejects unauthed', async () => {
    const res = await request(handle.app)
      .post('/api/admin/revoke-access')
      .send({ targetUid: 'uid-target' });
    expect(res.status).toBe(401);
  });

  it('rejects 400 on invalid uid', async () => {
    const res = await request(handle.app)
      .post('/api/admin/revoke-access')
      .set('Authorization', 'Bearer test:uid-admin:a@test.com')
      .send({ targetUid: 12345 });
    expect(res.status).toBe(400);
  });

  it('rejects non-admin with 403', async () => {
    const res = await request(handle.app)
      .post('/api/admin/revoke-access')
      .set('Authorization', 'Bearer test:uid-worker:w@test.com')
      .send({ targetUid: 'uid-target' });
    expect(res.status).toBe(403);
  });

  it('happy path: admin revokes refresh tokens and writes session doc + audit', async () => {
    const auth = makeAuth({ 'uid-admin': 'admin' });
    const revokeSpy = vi.fn();
    auth.revokeRefreshTokens = async (...args) => revokeSpy(...args);
    handle = buildTestServer({ firestore: fs, auth });
    const res = await request(handle.app)
      .post('/api/admin/revoke-access')
      .set('Authorization', 'Bearer test:uid-admin:a@test.com')
      .send({ targetUid: 'uid-target' });
    expect(res.status).toBe(200);
    expect(revokeSpy).toHaveBeenCalledWith('uid-target');
    // Session doc landed
    expect(fs.store.has('user_sessions/uid-target')).toBe(true);
    // Audit row landed
    expect(fs.audit.some((e) => e.action === 'revoke_access' && e.target === 'uid-target')).toBe(true);
  });
});
