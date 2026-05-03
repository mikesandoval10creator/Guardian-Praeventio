// Praeventio Guard — security depth: /api/gamification/points tenant isolation.
//
// Gamification ties to safety behaviors (Ley 16.744 audit trail). A
// caller from tenant A must NOT be able to award points into tenant B's
// user_stats — that would let one tenant inflate another's leaderboard
// or pollute an unrelated tenant's compliance trail.

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildTestServer, type TestServerHandle, InMemoryFirestore } from './test-server.js';

let handle: TestServerHandle;
let fs: InMemoryFirestore;

beforeEach(() => {
  fs = new InMemoryFirestore();
  handle = buildTestServer({ firestore: fs });
});

describe('POST /api/gamification/points — tenant isolation', () => {
  it('rejects points awarded across tenants (A → B user) with 403', async () => {
    // Project A owned by uid-A; project B owned by uid-B. uid-A is
    // NOT a member of project B. uid-A tries to award points to
    // uid-B-target scoped to project B.
    fs.store.set('projects/proj-A', { name: 'A', members: ['uid-A'], createdBy: 'uid-A' });
    fs.store.set('projects/proj-B', { name: 'B', members: ['uid-B'], createdBy: 'uid-B' });
    const res = await request(handle.app)
      .post('/api/gamification/points')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ amount: 100, reason: 'malicious', projectId: 'proj-B', targetUid: 'uid-B' });
    expect(res.status).toBe(403);
    // No points written to uid-B's stats.
    expect(fs.store.has('user_stats/uid-B')).toBe(false);
  });

  it('rejects awarding to another uid even without project scope (403)', async () => {
    const res = await request(handle.app)
      .post('/api/gamification/points')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ amount: 50, reason: 'cross-uid', targetUid: 'uid-victim' });
    expect(res.status).toBe(403);
    expect(fs.store.has('user_stats/uid-victim')).toBe(false);
  });

  it('allows a member to award points within their own tenant', async () => {
    fs.store.set('projects/proj-A', {
      name: 'A',
      members: ['uid-A', 'uid-A2'],
      createdBy: 'uid-A',
    });
    const res = await request(handle.app)
      .post('/api/gamification/points')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ amount: 25, reason: 'safety-walk', projectId: 'proj-A', targetUid: 'uid-A2' });
    expect(res.status).toBe(200);
    expect((fs.store.get('user_stats/uid-A2') as any).points).toBe(25);
  });

  it('allows self-award (caller awards points to their own uid)', async () => {
    const res = await request(handle.app)
      .post('/api/gamification/points')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ amount: 10, reason: 'login-streak' });
    expect(res.status).toBe(200);
    expect((fs.store.get('user_stats/uid-A') as any).points).toBe(10);
  });
});
