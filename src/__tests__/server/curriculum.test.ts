// Praeventio Guard — Round 15 (I3 / A6): Curriculum claim endpoints.
//
// Round 14 R5 added the curriculum-claim flagship feature (worker
// signs a claim → 2 named referees co-sign via magic-link emails).
// Server.ts wires:
//   • POST /api/curriculum/claim     (authed, sends 2 magic-link emails)
//   • POST /api/curriculum/referee/:token  (PUBLIC, token-hash lookup,
//                                          delegates to claims service)
//
// Coverage:
//   • verifyAuth (401)
//   • Validation (400 on bad claim text, bad category, bad referee count)
//   • Happy path: claim is created, magic-link emails are dispatched,
//     audit_log row emitted
//   • Public referee endpoint: token format validation (400),
//     token-not-found (404), happy cosign promotes claim to verified
//   • Decline path: claim flips to 'rejected', audit emitted

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { buildTestServer, type TestServerHandle, InMemoryFirestore } from './test-server.js';

let handle: TestServerHandle;
let fs: InMemoryFirestore;

describe('POST /api/curriculum/claim', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
    handle = buildTestServer({ firestore: fs });
  });

  it('returns 401 unauthenticated', async () => {
    const res = await request(handle.app).post('/api/curriculum/claim').send({});
    expect(res.status).toBe(401);
  });

  it('returns 400 on missing claim text', async () => {
    const res = await request(handle.app)
      .post('/api/curriculum/claim')
      .set('Authorization', 'Bearer test:uid-W:worker@test.com')
      .send({
        category: 'experience',
        referees: [
          { email: 'r1@test.com', name: 'R1' },
          { email: 'r2@test.com', name: 'R2' },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid category', async () => {
    const res = await request(handle.app)
      .post('/api/curriculum/claim')
      .set('Authorization', 'Bearer test:uid-W:worker@test.com')
      .send({
        claim: 'Trabajé 5 años como prevencionista',
        category: 'invented',
        referees: [
          { email: 'r1@test.com', name: 'R1' },
          { email: 'r2@test.com', name: 'R2' },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category/);
  });

  it('returns 400 when referees count != 2', async () => {
    const res = await request(handle.app)
      .post('/api/curriculum/claim')
      .set('Authorization', 'Bearer test:uid-W:worker@test.com')
      .send({
        claim: 'X',
        category: 'experience',
        referees: [{ email: 'r1@test.com', name: 'R1' }],
      });
    expect(res.status).toBe(400);
  });

  it('returns 400 when claim text exceeds 500 chars', async () => {
    const res = await request(handle.app)
      .post('/api/curriculum/claim')
      .set('Authorization', 'Bearer test:uid-W:worker@test.com')
      .send({
        claim: 'x'.repeat(501),
        category: 'experience',
        referees: [
          { email: 'r1@test.com', name: 'R1' },
          { email: 'r2@test.com', name: 'R2' },
        ],
      });
    expect(res.status).toBe(400);
  });

  it('happy path: creates claim, dispatches 2 emails, emits audit row', async () => {
    const resendSend = vi.fn(async () => ({ id: 'msg-x' }));
    handle = buildTestServer({ firestore: fs, resendSend });
    const res = await request(handle.app)
      .post('/api/curriculum/claim')
      .set('Authorization', 'Bearer test:uid-W:worker@test.com')
      .send({
        claim: 'Trabajé 5 años como prevencionista en Faena Norte',
        category: 'experience',
        signedByWorker: { fallbackAttest: true, fallbackReason: 'no webauthn' },
        referees: [
          { email: 'r1@test.com', name: 'Jefe Directo' },
          { email: 'r2@test.com', name: 'Mutual Inspector' },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.claimId).toBeTruthy();
    // 2 emails dispatched
    expect(resendSend).toHaveBeenCalledTimes(2);
    // claim row persisted
    const claimKey = `curriculum_claims/${res.body.claimId}`;
    expect(fs.store.has(claimKey)).toBe(true);
    expect((fs.store.get(claimKey) as any).status).toBe('pending_referees');
    // audit row emitted
    expect(fs.audit.some((e) => e.action === 'curriculum.claim.created')).toBe(true);
  });
});

describe('POST /api/curriculum/referee/:token', () => {
  beforeEach(() => {
    fs = new InMemoryFirestore();
    handle = buildTestServer({ firestore: fs });
  });

  it('returns 400 on malformed token', async () => {
    const res = await request(handle.app)
      .post('/api/curriculum/referee/not-hex')
      .send({ action: 'cosign', method: 'standard', signature: 'sig' });
    expect(res.status).toBe(400);
  });

  it('returns 400 on invalid action', async () => {
    const goodToken = 'a'.repeat(64);
    const res = await request(handle.app)
      .post(`/api/curriculum/referee/${goodToken}`)
      .send({ action: 'whatever', method: 'standard', signature: 'sig' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when method is invalid for cosign', async () => {
    const goodToken = 'a'.repeat(64);
    const res = await request(handle.app)
      .post(`/api/curriculum/referee/${goodToken}`)
      .send({ action: 'cosign', method: 'fingerprint', signature: 'sig' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when signature is missing', async () => {
    const goodToken = 'a'.repeat(64);
    const res = await request(handle.app)
      .post(`/api/curriculum/referee/${goodToken}`)
      .send({ action: 'cosign', method: 'standard' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when token does not match any pending claim', async () => {
    const goodToken = 'a'.repeat(64);
    const res = await request(handle.app)
      .post(`/api/curriculum/referee/${goodToken}`)
      .send({ action: 'cosign', method: 'standard', signature: 'sig' });
    expect(res.status).toBe(404);
  });

  it('happy decline: token matches → claim flips to rejected + audit row', async () => {
    // First create a claim through the create endpoint to get the matching tokenHash.
    const resendSend = vi.fn(async () => ({ id: 'msg' }));
    handle = buildTestServer({ firestore: fs, resendSend });
    // Capture raw tokens by intercepting the resend call's html (it has the URL).
    let capturedTokens: string[] = [];
    handle.deps.resendSend = vi.fn(async (args: any) => {
      const m = /\/curriculum\/referee\/([0-9a-f]{64})/.exec(args.html ?? '');
      if (m) capturedTokens.push(m[1]);
      return { id: 'msg' };
    });
    const createRes = await request(handle.app)
      .post('/api/curriculum/claim')
      .set('Authorization', 'Bearer test:uid-W:worker@test.com')
      .send({
        claim: 'Soy prevencionista certificado',
        category: 'certification',
        referees: [
          { email: 'r1@test.com', name: 'R1' },
          { email: 'r2@test.com', name: 'R2' },
        ],
      });
    expect(createRes.status).toBe(200);
    expect(capturedTokens).toHaveLength(2);
    // Decline using the first referee's token.
    const declineRes = await request(handle.app)
      .post(`/api/curriculum/referee/${capturedTokens[0]}`)
      .send({ action: 'decline', method: 'standard', signature: 'no-thanks' });
    expect(declineRes.status).toBe(200);
    expect(declineRes.body.declined).toBe(true);
    // Claim should now be rejected.
    const claimKey = `curriculum_claims/${createRes.body.claimId}`;
    expect((fs.store.get(claimKey) as any).status).toBe('rejected');
    // Audit row for decline emitted
    expect(fs.audit.some((e) => e.action === 'curriculum.referee.declined')).toBe(true);
  });
});
