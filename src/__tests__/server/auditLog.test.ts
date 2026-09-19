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

// ─── GET /api/audit-log ─────────────────────────────────────────────────────
// Codex fake fix §2.2 (Audit-2026-08-31 — Audit trail GET): el endpoint
// expone audit_logs via Admin SDK (bypass de firestore.rules). La membresía
// sola NO es suficiente para leer el trail completo de un proyecto —
// devolver `userEmail, ip, details` de OTROS miembros sería fuga de PII
// cross-user (ISO 45001 §10.2 + GDPR). El guard server-side exige rol
// supervisor/admin global cuando se pide `?projectId=`. Sin projectId, el
// handler scope-a los logs al propio uid (un worker solo ve su propio trail).

const ROLE_TOKEN = (
  uid: string,
  role: string,
  adminFlag = false,
  email = `${uid}@x.cl`,
  tenant = 't1',
) => `Bearer test:${uid}:${email}:${role}:${adminFlag ? '1' : '0'}:${tenant}`;

describe('GET /api/audit-log', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(handle.app).get('/api/audit-log');
    expect(res.status).toBe(401);
  });

  it('returns 403 when worker asks for a projectId trail (PII cross-user gate)', async () => {
    fs.store.set('projects/proj-A', { name: 'Faena Norte', members: ['uid-worker'], createdBy: 'uid-sup' });
    const res = await request(handle.app)
      .get('/api/audit-log')
      .query({ projectId: 'proj-A' })
      .set('Authorization', ROLE_TOKEN('uid-worker', 'operario'));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('project_trail_requires_supervisor');
  });

  it('returns 403 when supervisor (non-admin) asks for a project they are not member of', async () => {
    fs.store.set('projects/proj-Z', { name: 'Other', members: ['someone-else'], createdBy: 'someone-else' });
    const res = await request(handle.app)
      .get('/api/audit-log')
      .query({ projectId: 'proj-Z' })
      .set('Authorization', ROLE_TOKEN('uid-sup', 'supervisor'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('returns 200 when supervisor asks for a project they are member of', async () => {
    fs.store.set('projects/proj-S', { name: 'Faena Sur', members: ['uid-sup'], createdBy: 'uid-sup' });
    // Pre-seed two audit entries for that project (any author — supervisor is allowed to see all).
    fs.store.set('audit_logs/log_1', { action: 'login.success', module: 'auth', userId: 'uid-A', projectId: 'proj-S', timestamp: new Date('2026-01-01T00:00:00Z') });
    fs.store.set('audit_logs/log_2', { action: 'reports.export', module: 'reports', userId: 'uid-B', projectId: 'proj-S', timestamp: new Date('2026-01-02T00:00:00Z') });
    const res = await request(handle.app)
      .get('/api/audit-log')
      .query({ projectId: 'proj-S' })
      .set('Authorization', ROLE_TOKEN('uid-sup', 'supervisor'));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    expect(res.body.entries.map((e: any) => e.action).sort()).toEqual(['login.success', 'reports.export']);
  });

  it('returns 200 when admin (project member) asks for that project trail (role gate satisfied)', async () => {
    // Admin must also be a project member (assertProjectMember runs first).
    fs.store.set('projects/proj-X', { name: 'Other', members: ['uid-admin', 'someone-else'], createdBy: 'someone-else' });
    fs.store.set('audit_logs/log_3', { action: 'login.success', module: 'auth', userId: 'uid-A', projectId: 'proj-X', timestamp: new Date('2026-01-01T00:00:00Z') });
    const res = await request(handle.app)
      .get('/api/audit-log')
      .query({ projectId: 'proj-X' })
      .set('Authorization', ROLE_TOKEN('uid-admin', 'operario', true));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.entries[0].action).toBe('login.success');
  });

  it('returns only the caller\u2019s own audit entries when no projectId is provided (worker)', async () => {
    // Worker MUST be able to see their own trail even without projectId — but
    // not entries from other workers in their projects.
    fs.store.set('audit_logs/log_4', { action: 'login.success', module: 'auth', userId: 'uid-worker', projectId: null, timestamp: new Date('2026-01-01T00:00:00Z') });
    fs.store.set('audit_logs/log_5', { action: 'reports.export', module: 'reports', userId: 'uid-other-worker', projectId: 'proj-anything', timestamp: new Date('2026-01-02T00:00:00Z') });
    const res = await request(handle.app)
      .get('/api/audit-log')
      .set('Authorization', ROLE_TOKEN('uid-worker', 'operario'));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.entries[0].userId).toBe('uid-worker');
  });

  it('returns 200 with empty entries when caller has no audit rows', async () => {
    const res = await request(handle.app)
      .get('/api/audit-log')
      .set('Authorization', ROLE_TOKEN('uid-empty', 'operario'));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.entries).toEqual([]);
  });

  it('does NOT expose audit rows from another projectId when supervisor filters by projectId (tenant isolation)', async () => {
    fs.store.set('projects/proj-S', { name: 'Faena Sur', members: ['uid-sup'], createdBy: 'uid-sup' });
    fs.store.set('projects/proj-Other', { name: 'Other', members: ['someone-else'], createdBy: 'someone-else' });
    fs.store.set('audit_logs/log_6', { action: 'reports.export', module: 'reports', userId: 'uid-sup', projectId: 'proj-S', timestamp: new Date('2026-01-01T00:00:00Z') });
    fs.store.set('audit_logs/log_7', { action: 'login.success', module: 'auth', userId: 'uid-A', projectId: 'proj-Other', timestamp: new Date('2026-01-02T00:00:00Z') });
    const res = await request(handle.app)
      .get('/api/audit-log')
      .query({ projectId: 'proj-S' })
      .set('Authorization', ROLE_TOKEN('uid-sup', 'supervisor'));
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.entries[0].projectId).toBe('proj-S');
    expect(res.body.entries[0].action).toBe('reports.export');
  });
});
