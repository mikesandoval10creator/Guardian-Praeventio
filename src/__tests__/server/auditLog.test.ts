// Praeventio Guard — Round 15 (I3 / A6): /api/audit-log HTTP tests.
//
// This is the route Round 14 added `assertProjectMember` to (A5 audit).
// We cover:
//   • verifyAuth (401 without Bearer token)
//   • action/module/projectId validation (400)
//   • Tenant isolation: a worker on project A cannot stamp an audit
//     entry tagged to project B (403)
//   • Happy path: row lands in audit_logs with the SERVER-stamped uid
//     (not whatever the client sent in the body)

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildTestServer, type TestServerHandle, InMemoryFirestore } from './test-server.js';

let handle: TestServerHandle;
let fs: InMemoryFirestore;

beforeEach(() => {
  fs = new InMemoryFirestore();
  handle = buildTestServer({ firestore: fs });
});

describe('POST /api/audit-log', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(handle.app).post('/api/audit-log').send({ action: 'x', module: 'y' });
    expect(res.status).toBe(401);
  });

  it('rejects malformed token with 401', async () => {
    const res = await request(handle.app)
      .post('/api/audit-log')
      .set('Authorization', 'Bearer invalid')
      .send({ action: 'x', module: 'y' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when action is missing', async () => {
    const res = await request(handle.app)
      .post('/api/audit-log')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ module: 'reports' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action/i);
  });

  it('returns 400 when module is missing', async () => {
    const res = await request(handle.app)
      .post('/api/audit-log')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ action: 'reports.export' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/module/i);
  });

  it('returns 400 when action exceeds 64 chars', async () => {
    const res = await request(handle.app)
      .post('/api/audit-log')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ action: 'x'.repeat(65), module: 'reports' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when projectId is not a string', async () => {
    const res = await request(handle.app)
      .post('/api/audit-log')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ action: 'a', module: 'b', projectId: 12345 });
    expect(res.status).toBe(400);
  });

  it('returns 403 when caller is not a project member (tenant isolation)', async () => {
    // Project A exists, caller (uid-Z) is NOT a member.
    fs.store.set('projects/proj-A', { name: 'Faena Norte', members: ['uid-A'], createdBy: 'uid-A' });
    const res = await request(handle.app)
      .post('/api/audit-log')
      .set('Authorization', 'Bearer test:uid-Z:z@test.com')
      .send({ action: 'reports.export', module: 'reports', projectId: 'proj-A' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 403 when projectId does not exist (not-a-member by absence)', async () => {
    const res = await request(handle.app)
      .post('/api/audit-log')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ action: 'reports.export', module: 'reports', projectId: 'ghost-project' });
    expect(res.status).toBe(403);
  });

  it('writes audit_log when caller IS a project member', async () => {
    fs.store.set('projects/proj-A', { name: 'Faena Norte', members: ['uid-A'], createdBy: 'uid-A' });
    const res = await request(handle.app)
      .post('/api/audit-log')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ action: 'reports.export', module: 'reports', projectId: 'proj-A' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Audit row landed in store.
    const auditEntries = fs.audit.filter((e) => e.action === 'reports.export');
    expect(auditEntries).toHaveLength(1);
    // Critical: the userId is the SERVER-decoded uid, not whatever the client sent.
    expect(auditEntries[0].userId).toBe('uid-A');
    expect(auditEntries[0].userEmail).toBe('a@test.com');
    expect(auditEntries[0].projectId).toBe('proj-A');
  });

  it('writes audit_log when no projectId is supplied (global event)', async () => {
    const res = await request(handle.app)
      .post('/api/audit-log')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ action: 'login.success', module: 'auth' });
    expect(res.status).toBe(200);
    const entry = fs.audit.find((e) => e.action === 'login.success');
    expect(entry).toBeDefined();
    expect(entry!.projectId).toBeNull();
  });
});
