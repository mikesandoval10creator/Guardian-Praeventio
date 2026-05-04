// SPDX-License-Identifier: MIT
// Sprint 17a — sanity test for the /api/cad/convert-dwg stub.
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Stub auth middleware so the test stays a pure unit test (no Firebase).
vi.mock('../middleware/verifyAuth.js', () => ({
  verifyAuth: (req: any, _res: any, next: any) => {
    req.user = { uid: 'test-uid' };
    next();
  },
}));

import cadRouter from './cad.js';

describe('POST /api/cad/convert-dwg (Sprint 17a stub)', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/cad', cadRouter);

  it('returns 501 with the documented "coming Sprint 18" envelope', async () => {
    const res = await request(app).post('/api/cad/convert-dwg').send({});
    expect(res.status).toBe(501);
    expect(res.body).toMatchObject({
      error: 'not_implemented',
      sprint: 18,
    });
    expect(res.body.message).toMatch(/Sprint 18/);
  });
});
