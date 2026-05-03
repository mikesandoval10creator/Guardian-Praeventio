// Praeventio Guard — security depth: /api/reports/generate-pdf body limits.
//
// The route was bumped past the global 64kb cap because legitimate
// occupational-safety reports carry the full incident narrative + AI
// summary — frequently >100kb. We assert:
//   • A 200kb+ body is ACCEPTED (the bump works).
//   • A >2MB body is REJECTED with 413 (the new ceiling is enforced).

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildTestServer, type TestServerHandle, InMemoryFirestore } from './test-server.js';

let handle: TestServerHandle;
let fs: InMemoryFirestore;

beforeEach(() => {
  fs = new InMemoryFirestore();
  handle = buildTestServer({ firestore: fs });
});

describe('POST /api/reports/generate-pdf — body size limits', () => {
  it('accepts a 200kb+ body (the bumped limit works)', async () => {
    const bigContent = 'A'.repeat(220 * 1024); // 220kb of payload
    const res = await request(handle.app)
      .post('/api/reports/generate-pdf')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ incidentId: 'inc-1', title: 'Big Report', content: bigContent });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/pdf/);
  });

  it('rejects a >2MB body with 413', async () => {
    const tooBig = 'B'.repeat(2.2 * 1024 * 1024); // 2.2MB
    const res = await request(handle.app)
      .post('/api/reports/generate-pdf')
      .set('Authorization', 'Bearer test:uid-A:a@test.com')
      .send({ incidentId: 'inc-2', title: 'Too Big', content: tooBig });
    expect(res.status).toBe(413);
  });
});
