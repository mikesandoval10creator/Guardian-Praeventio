// Praeventio Guard — microtraining router: real-router supertest (B6 life/integrity).
//
// Closes the competency-cert spoof: POST /microtraining/session granted the
// certificate to the CLIENT-supplied `workerUid`, so any project member could
// mint an altura/eléctrico/confinado/hazmat cert for a worker who never trained
// → that worker assigned to a hazardous task they can't safely perform. The
// certificate SUBJECT must be the VERIFIED caller who actually took the quiz.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  saveSession: vi.fn(),
  grantCert: vi.fn(),
  buildCert: vi.fn(),
  shouldCertify: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => {
    const uid = req.header('x-test-uid');
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    req.user = { uid } as import('express').Request['user'];
    next();
  },
}));
vi.mock('../../server/middleware/validate.js', () => ({
  validate: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: (...a: unknown[]) => H.audit(...a),
}));
vi.mock('../../services/microtraining/lightningTrainingService.js', () => ({
  MICROTRAINING_CATALOG: [{ id: 'mod-altura', title: 'Trabajo en altura' }],
  PASS_THRESHOLD: 0.8,
  scoreSession: () => 1, // perfect score (server-computed)
  shouldCertify: () => H.shouldCertify(),
  selectMicroModule: () => ({ id: 'mod-altura' }),
}));
vi.mock('../../services/microtraining/microtrainingFirestoreAdapter.js', () => ({
  // Real class so the route's `new MicrotrainingAdapter(...)` works.
  MicrotrainingAdapter: class {
    saveSession(...a: unknown[]) {
      return H.saveSession(...a);
    }
    grantCert(...a: unknown[]) {
      return H.grantCert(...a);
    }
    listCertifiedModuleIds() {
      return Promise.resolve([]);
    }
  },
  buildCertFromSession: (...a: unknown[]) => H.buildCert(...a),
}));

import microtrainingRouter from '../../server/routes/microtraining.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

const PREFIX = '/api/sprint-k';
const PROJECT = 'p1';
const TENANT = 't1';
const ATTACKER = 'attacker-1';
const VICTIM = 'victim-9';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, microtrainingRouter);
  return app;
}

const sessionUrl = `${PREFIX}/${PROJECT}/microtraining/session`;
const body = (over: Record<string, unknown> = {}) => ({
  workerUid: VICTIM, // attacker tries to certify someone else
  moduleId: 'mod-altura',
  startedAt: 0,
  answers: [{ blockIndex: 0, selectedIndex: 0 }],
  ...over,
});

beforeEach(() => {
  H.db = createFakeFirestore();
  H.saveSession.mockReset().mockResolvedValue('sess-1');
  H.grantCert.mockReset().mockResolvedValue(undefined);
  H.buildCert.mockReset().mockReturnValue({ moduleId: 'mod-altura', issuedAt: 1 });
  H.shouldCertify.mockReset().mockReturnValue(true);
  H.audit.mockReset().mockResolvedValue(true);
  H.db._seed(`projects/${PROJECT}`, { tenantId: TENANT, members: [ATTACKER] });
});

describe('POST /microtraining/session — cert subject is the verified caller', () => {
  it('401 without a token', async () => {
    expect((await request(buildApp()).post(sessionUrl).send(body())).status).toBe(401);
  });

  it('certifies the CALLER who took the quiz, NOT the client-supplied workerUid', async () => {
    const res = await request(buildApp()).post(sessionUrl).set('x-test-uid', ATTACKER).send(body());
    expect(res.status).toBe(201);
    expect(res.body.certified).toBe(true);

    // The cert is granted to the attacker (who took the quiz) — NOT the victim.
    expect(H.grantCert).toHaveBeenCalledTimes(1);
    expect(H.grantCert).toHaveBeenCalledWith(ATTACKER, 'mod-altura', expect.anything());
    expect(H.grantCert).not.toHaveBeenCalledWith(VICTIM, expect.anything(), expect.anything());

    // The session persisted + audited under the caller, never the spoofed uid.
    const sessionArg = H.saveSession.mock.calls[0]![0] as { workerUid: string };
    expect(sessionArg.workerUid).toBe(ATTACKER);
    expect(H.audit).toHaveBeenCalledWith(
      expect.anything(),
      'microtraining.session',
      'microtraining',
      expect.objectContaining({ workerUid: ATTACKER }),
      expect.objectContaining({ projectId: PROJECT }),
    );
  });

  it('does not grant a cert on a non-passing session, but still audits under the caller', async () => {
    H.shouldCertify.mockReturnValue(false);
    const res = await request(buildApp()).post(sessionUrl).set('x-test-uid', ATTACKER).send(body());
    expect(res.status).toBe(201);
    expect(res.body.certified).toBe(false);
    expect(H.grantCert).not.toHaveBeenCalled();
    expect(H.audit).toHaveBeenCalledWith(
      expect.anything(),
      'microtraining.session',
      'microtraining',
      expect.objectContaining({ workerUid: ATTACKER, certified: false }),
      expect.anything(),
    );
  });

  it('403 for a non-member', async () => {
    const res = await request(buildApp()).post(sessionUrl).set('x-test-uid', 'outsider').send(body());
    expect(res.status).toBe(403);
    expect(H.grantCert).not.toHaveBeenCalled();
  });
});
