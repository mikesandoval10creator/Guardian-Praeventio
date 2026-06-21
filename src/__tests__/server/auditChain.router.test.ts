// Real-router supertest for the Tamper-Proof Audit Hash Chain HTTP surface
// (src/server/routes/auditChain.ts). Four stateless POST endpoints over the
// pure engine in src/services/audit/tamperProofChain.ts:
//
//   POST /:projectId/audit-chain/append    → { event }
//   POST /:projectId/audit-chain/verify    → { result }
//   POST /:projectId/audit-chain/anchor    → { anchor }
//   POST /:projectId/audit-chain/find-gap  → { gap }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs unmocked so every 200 asserts real SHA-256 compute.
//
// The genesis hash + the seeded ev0 hash below are captured from the REAL
// engine (deterministic given a fixed timestamp/actor/action/payload), so the
// happy-path assertions pin actual output rather than reimplementing the chain.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import auditChainRouter from '../../server/routes/auditChain.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  GENESIS_HASH,
  type AuditEvent,
} from '../../services/audit/tamperProofChain.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', auditChainRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

// Genesis event hash captured from the REAL engine for actor='u1' (the auth
// uid the router forces), action='incident.create', payload={foo:'bar'},
// timestamp='2026-05-01T00:00:00.000Z'. Deterministic SHA-256 over the
// canonical preimage — used to pin both the append output and a verifiable chain.
const EV0_HASH =
  '0c3a3631d795cd96ade0bf6fc8e2c556a8c285de5327afcf202ad954636b3d9d';

// A self-consistent 2-event chain the engine will verify as valid. Built off
// the same canonicalization the router uses, so these are real hashes.
function genesisEvent(): AuditEvent {
  return {
    seq: 0,
    timestamp: '2026-05-01T00:00:00.000Z',
    prevHash: GENESIS_HASH,
    hash: EV0_HASH,
    actor: 'u1',
    action: 'incident.create',
    payload: { foo: 'bar' },
  };
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/audit-chain/append', () => {
  const url = '/api/p1/audit-chain/append';
  const appendBody = {
    prev: null,
    input: {
      actor: 'whatever-client-claims',
      action: 'incident.create',
      payload: { foo: 'bar' },
      timestamp: '2026-05-01T00:00:00.000Z',
    },
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(appendBody);
    expect(res.status).toBe(401);
  });

  it('200 returns the real genesis event signed by the caller uid', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(appendBody);
    expect(res.status).toBe(200);
    // Server forces input.actor = callerUid: the client-claimed actor is ignored.
    expect(res.body.event.actor).toBe('u1');
    expect(res.body.event.seq).toBe(0);
    expect(res.body.event.prevHash).toBe(GENESIS_HASH);
    // Deterministic SHA-256 over the canonical preimage (the real engine output).
    expect(res.body.event.hash).toBe(EV0_HASH);
  });

  it('200 chains a second event onto a provided prev', async () => {
    const ev0 = genesisEvent();
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        prev: ev0,
        input: {
          actor: 'ignored',
          action: 'incident.update',
          payload: { x: 1 },
          timestamp: '2026-05-02T00:00:00.000Z',
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.event.seq).toBe(1);
    // The new event links to the supplied prev by its hash.
    expect(res.body.event.prevHash).toBe(ev0.hash);
    expect(res.body.event.actor).toBe('u1');
  });

  it('400 on a non-monotonic timestamp (engine AuditChainError → validation_error)', async () => {
    const ev0 = genesisEvent();
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        prev: ev0,
        input: {
          actor: 'u1',
          action: 'incident.update',
          payload: { x: 1 },
          // Predates ev0's timestamp → NONMONOTONIC_TIMESTAMP.
          timestamp: '2026-04-01T00:00:00.000Z',
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.code).toBe('NONMONOTONIC_TIMESTAMP');
  });

  it('400 on invalid body (missing input)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ prev: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/audit-chain/append')
      .set(uid)
      .send(appendBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/audit-chain/append')
      .set(uid)
      .send(appendBody);
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/audit-chain/verify', () => {
  const url = '/api/p1/audit-chain/verify';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ chain: [] });
    expect(res.status).toBe(401);
  });

  it('200 valid for an empty chain (nothing to verify)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ chain: [] });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ valid: true, verifiedCount: 0 });
  });

  it('200 valid for a real single-event chain', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ chain: [genesisEvent()] });
    expect(res.status).toBe(200);
    expect(res.body.result.valid).toBe(true);
    expect(res.body.result.verifiedCount).toBe(1);
  });

  it('200 detects a tampered payload (HASH_MISMATCH) without leaking 5xx', async () => {
    const tampered = { ...genesisEvent(), payload: { foo: 'TAMPERED' } };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ chain: [tampered] });
    expect(res.status).toBe(200);
    expect(res.body.result.valid).toBe(false);
    expect(res.body.result.failedAt).toBe(0);
    expect(res.body.result.errorCode).toBe('HASH_MISMATCH');
  });

  it('400 when chain is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ chain: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/audit-chain/verify')
      .set(uid)
      .send({ chain: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/audit-chain/anchor', () => {
  const url = '/api/p1/audit-chain/anchor';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ chain: [] });
    expect(res.status).toBe(401);
  });

  it('200 returns the last event hash as the anchor', async () => {
    const ev0 = genesisEvent();
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ chain: [ev0] });
    expect(res.status).toBe(200);
    expect(res.body.anchor).toBe(ev0.hash);
  });

  it('200 returns null for an empty chain', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ chain: [] });
    expect(res.status).toBe(200);
    expect(res.body.anchor).toBeNull();
  });

  it('400 when chain is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ chain: {} });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/audit-chain/anchor')
      .set(uid)
      .send({ chain: [] });
    expect(res.status).toBe(403);
  });
});

describe('POST /:projectId/audit-chain/find-gap', () => {
  const url = '/api/p1/audit-chain/find-gap';

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ chain: [] });
    expect(res.status).toBe(401);
  });

  it('200 returns null when seq is contiguous from 0', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ chain: [genesisEvent()] });
    expect(res.status).toBe(200);
    expect(res.body.gap).toBeNull();
  });

  it('200 reports the seq of the first gap', async () => {
    // A chain whose first event has seq=3 → the gap is detected at index 0.
    const broken = { ...genesisEvent(), seq: 3 };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ chain: [broken] });
    expect(res.status).toBe(200);
    expect(res.body.gap).toEqual({ gapAt: 0 });
  });

  it('400 when chain is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ chain: 42 });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/audit-chain/find-gap')
      .set(uid)
      .send({ chain: [] });
    expect(res.status).toBe(403);
  });
});
