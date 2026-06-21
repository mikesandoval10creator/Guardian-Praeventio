// Real-router supertest for the QR-Ack signing surface (src/server/routes/qrAck.ts)
// — Sprint 43 Fase F.5. Two stateful endpoints over the PURE
// qrAckSessionEngine with a REAL HMAC signer/verifier (env secret) and
// Firestore-backed per-worker replay protection inside runTransaction.
//
// This mounts the REAL router and exercises it end-to-end:
//   • REAL createAckSession() crafts the valid qrPayload+signature so the
//     verifier path is genuinely exercised (not a stub).
//   • REAL assertProjectMember() runs against the fakeFirestore (we seed a
//     real projects/{id} membership doc — the gate, not the field under test).
//   • The audit_logs write + the qr_ack_used_scans replay record are asserted
//     in the fake store.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createHmac } from 'node:crypto';

const HMAC_SECRET = 'test-qr-ack-hmac-secret-0123456789abcdef'; // ≥32 chars

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

import qrAckRouter from '../../server/routes/qrAck.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { createAckSession, type AckSessionInput } from '../../services/qrAck/qrAckSessionEngine.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', qrAckRouter);
  return app;
}

const SUP = { 'x-test-uid': 'sup1' }; // supervisor / session creator
const WORKER = { 'x-test-uid': 'w1' }; // worker firmando

// Build a valid QR payload + signature with the SAME secret the router uses,
// via the REAL engine. createdByUid defaults to the supervisor.
function realSigner(payload: string): string {
  return createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
}
function makeSession(overrides: Partial<AckSessionInput> = {}) {
  const input: AckSessionInput = {
    projectId: 'p1',
    createdByUid: 'sup1',
    itemKind: 'epp',
    itemId: 'item-casco-001',
    itemLabel: 'Casco de seguridad — Día 1',
    ...overrides,
  };
  return createAckSession(input, realSigner);
}

beforeEach(() => {
  H.db = createFakeFirestore();
  // Real membership gate: both supervisor + worker belong to p1.
  H.db._seed('projects/p1', { members: ['sup1', 'w1'], createdBy: 'sup1' });
  process.env.QR_ACK_HMAC_SECRET = HMAC_SECRET;
});

afterEach(() => {
  delete process.env.QR_ACK_HMAC_SECRET;
});

describe('POST /:projectId/qr-ack/create-session', () => {
  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/p1/qr-ack/create-session')
      .send({ itemKind: 'epp', itemId: 'i1', itemLabel: 'Casco' });
    expect(res.status).toBe(401);
  });

  it('400 on invalid body (bad itemKind)', async () => {
    const res = await request(buildApp())
      .post('/api/p1/qr-ack/create-session')
      .set(SUP)
      .send({ itemKind: 'NOPE', itemId: 'i1', itemLabel: 'Casco' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on missing required field (itemLabel)', async () => {
    const res = await request(buildApp())
      .post('/api/p1/qr-ack/create-session')
      .set(SUP)
      .send({ itemKind: 'epp', itemId: 'i1' });
    expect(res.status).toBe(400);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post('/api/other/qr-ack/create-session') // project "other" not seeded
      .set(SUP)
      .send({ itemKind: 'epp', itemId: 'i1', itemLabel: 'Casco' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('503 when QR_ACK_HMAC_SECRET is not configured', async () => {
    delete process.env.QR_ACK_HMAC_SECRET;
    const res = await request(buildApp())
      .post('/api/p1/qr-ack/create-session')
      .set(SUP)
      .send({ itemKind: 'epp', itemId: 'i1', itemLabel: 'Casco' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('qr_ack_not_configured');
  });

  it('200 returns a real signed session (createdByUid forced from token)', async () => {
    const res = await request(buildApp())
      .post('/api/p1/qr-ack/create-session')
      .set(SUP)
      .send({ itemKind: 'epp', itemId: 'item-casco-001', itemLabel: 'Casco de seguridad' });
    expect(res.status).toBe(200);
    const { session } = res.body as { session: {
      sessionId: string; projectId: string; createdByUid: string;
      itemKind: string; itemId: string; qrPayload: string; signature: string;
      expiresAt: string;
    } };
    expect(session.projectId).toBe('p1');
    expect(session.createdByUid).toBe('sup1'); // from token, not body
    expect(session.itemKind).toBe('epp');
    expect(session.itemId).toBe('item-casco-001');
    expect(session.sessionId).toMatch(/.+/);
    expect(session.qrPayload).toMatch(/.+/);
    // The signature is the REAL HMAC of the payload under the env secret.
    expect(session.signature).toBe(realSigner(session.qrPayload));
  });
});

describe('POST /:projectId/qr-ack/validate-scan', () => {
  const validBody = (extra: Record<string, unknown> = {}) => {
    const session = makeSession();
    return {
      qrPayload: session.qrPayload,
      signature: session.signature,
      consent: true,
      biometricUsed: true,
      ...extra,
    };
  };

  it('401 without auth', async () => {
    const res = await request(buildApp())
      .post('/api/p1/qr-ack/validate-scan')
      .send(validBody());
    expect(res.status).toBe(401);
  });

  it('400 on invalid body (missing consent boolean)', async () => {
    const session = makeSession();
    const res = await request(buildApp())
      .post('/api/p1/qr-ack/validate-scan')
      .set(WORKER)
      .send({ qrPayload: session.qrPayload, signature: session.signature, biometricUsed: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post('/api/other/qr-ack/validate-scan') // project "other" not seeded
      .set(WORKER)
      .send(validBody());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('503 when QR_ACK_HMAC_SECRET is not configured', async () => {
    delete process.env.QR_ACK_HMAC_SECRET;
    const res = await request(buildApp())
      .post('/api/p1/qr-ack/validate-scan')
      .set(WORKER)
      .send(validBody());
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('qr_ack_not_configured');
  });

  it('400 with result code bad_signature when the signature is tampered', async () => {
    const session = makeSession();
    const res = await request(buildApp())
      .post('/api/p1/qr-ack/validate-scan')
      .set(WORKER)
      .send({
        qrPayload: session.qrPayload,
        signature: session.signature.replace(/.$/, (c) => (c === '0' ? '1' : '0')),
        consent: true,
        biometricUsed: true,
      });
    expect(res.status).toBe(400);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.code).toBe('bad_signature');
  });

  it('400 with result code no_consent when worker did not consent', async () => {
    const res = await request(buildApp())
      .post('/api/p1/qr-ack/validate-scan')
      .set(WORKER)
      .send(validBody({ consent: false }));
    expect(res.status).toBe(400);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.code).toBe('no_consent');
  });

  it('400 creator_cannot_self_sign when the supervisor scans their own session', async () => {
    const res = await request(buildApp())
      .post('/api/p1/qr-ack/validate-scan')
      .set(SUP) // sup1 created the session AND is scanning it
      .send(validBody());
    expect(res.status).toBe(400);
    expect(res.body.result.ok).toBe(false);
    expect(res.body.result.code).toBe('creator_cannot_self_sign');
  });

  it('200 records a valid acknowledgement, audit log, and replay guard doc', async () => {
    const session = makeSession();
    const res = await request(buildApp())
      .post('/api/p1/qr-ack/validate-scan')
      .set(WORKER)
      .send({
        qrPayload: session.qrPayload,
        signature: session.signature,
        consent: true,
        biometricUsed: true,
        scannedAtLocation: { lat: -33.45, lng: -70.66 },
      });
    expect(res.status).toBe(200);
    expect(res.body.result.ok).toBe(true);
    const ack = res.body.result.ack as {
      workerUid: string; sessionId: string; projectId: string;
      itemKind: string; biometricUsed: boolean;
    };
    expect(ack.workerUid).toBe('w1'); // scannedByUid forced from token, not body
    expect(ack.sessionId).toBe(session.sessionId);
    expect(ack.projectId).toBe('p1');
    expect(ack.itemKind).toBe('epp');
    expect(ack.biometricUsed).toBe(true);

    // Replay-guard record persisted under qr_ack_used_scans/{sessionId|workerUid}.
    const replayDoc = H.db!._dump()[`qr_ack_used_scans/${session.sessionId}|w1`] as {
      sessionId: string; workerUid: string; projectId: string;
    };
    expect(replayDoc).toBeDefined();
    expect(replayDoc.workerUid).toBe('w1');
    expect(replayDoc.projectId).toBe('p1');

    // Audit log written (CLAUDE.md #3) with the actor stamped from the token.
    const auditKeys = [...H.db!._store.keys()].filter((k) => k.startsWith('audit_logs/'));
    expect(auditKeys.length).toBe(1);
    const log = H.db!._store.get(auditKeys[0]) as {
      action: string; module: string; userId: string; projectId: string | null;
      details: { sessionId: string; workerUid: string; projectId: string };
    };
    expect(log.action).toBe('qrAck.sign');
    expect(log.module).toBe('qrAck');
    expect(log.userId).toBe('w1'); // stamped from token
    expect(log.details.sessionId).toBe(session.sessionId);
    expect(log.details.workerUid).toBe('w1');
  });

  it('400 replay when the same worker signs the same session twice', async () => {
    const session = makeSession();
    const body = {
      qrPayload: session.qrPayload,
      signature: session.signature,
      consent: true,
      biometricUsed: true,
    };
    const first = await request(buildApp()).post('/api/p1/qr-ack/validate-scan').set(WORKER).send(body);
    expect(first.status).toBe(200);
    const second = await request(buildApp()).post('/api/p1/qr-ack/validate-scan').set(WORKER).send(body);
    expect(second.status).toBe(400);
    expect(second.body.result.ok).toBe(false);
    expect(second.body.result.code).toBe('replay');
  });
});
