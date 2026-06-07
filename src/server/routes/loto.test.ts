// Praeventio Guard — LOTO Digital router: real-router supertest for the write-path
// (B8, Fase 5). Boots the real router with admin.firestore() backed by the
// in-memory FakeFirestore, runs the REAL LotoAdapter + engine, and asserts the
// full create → apply-lock → verify-zero-energy → release lifecycle persists,
// audits (legal subcollection + global audit_logs), and gates release by actor.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
  audit: vi.fn(),
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../../__tests__/helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

vi.mock('../middleware/verifyAuth.js', () => ({
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
    req.user = { uid, email: req.header('x-test-email') ?? null } as import('express').Request['user'];
    next();
  },
}));

vi.mock('../middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../middleware/auditLog.js', () => ({
  auditServerEvent: (...args: unknown[]) => H.audit(...args),
}));

import lotoRouter from './loto';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const PREFIX = '/api/sprint-k';
const TENANT = 't1';
const PROJECT = 'p1';
const LEADER = 'leader-1';
const WORKER = 'worker-2';
const OUTSIDER = 'outsider-9';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, lotoRouter);
  return app;
}

function seedProject(members: string[] = [LEADER, WORKER]) {
  H.db!._seed(`projects/${PROJECT}`, { tenantId: TENANT, members, createdBy: LEADER });
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });
const base = `${PREFIX}/${PROJECT}/loto`;

async function createApp(energies: string[] = ['electric'], authorized: string[] = [WORKER]) {
  const res = await request(buildApp())
    .post(base)
    .set(asUser(LEADER))
    .send({
      equipmentId: 'eq-1',
      workDescription: 'Mantención tablero',
      energiesIdentified: energies,
      authorizedWorkerUids: authorized,
    });
  return res;
}

function dumpKeys(prefix: string): string[] {
  return Object.keys(H.db!._dump()).filter((k) => k.startsWith(prefix));
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.audit.mockReset().mockResolvedValue(true);
  seedProject();
});

describe('GET /:projectId/loto', () => {
  it('401 without a token', async () => {
    expect((await request(buildApp()).get(base)).status).toBe(401);
  });
  it('403 for a non-member', async () => {
    expect((await request(buildApp()).get(base).set(asUser(OUTSIDER))).status).toBe(403);
  });
  it('200 lists active applications for a member', async () => {
    await createApp();
    const res = await request(buildApp()).get(base).set(asUser(WORKER));
    expect(res.status).toBe(200);
    expect(res.body.applications).toHaveLength(1);
  });
});

describe('POST /:projectId/loto (create)', () => {
  it('400 on invalid body (no energies)', async () => {
    const res = await request(buildApp())
      .post(base)
      .set(asUser(LEADER))
      .send({ equipmentId: 'eq-1', workDescription: 'x', energiesIdentified: [] });
    expect(res.status).toBe(400);
  });

  it('201 creates with the caller as leader, persists, and double-audits', async () => {
    const res = await createApp(['electric', 'mechanical']);
    expect(res.status).toBe(201);
    const app = res.body.application;
    expect(app.leaderUid).toBe(LEADER); // stamped from token, not body
    expect(app.lockPoints).toEqual([]);
    expect(app.energiesIdentified).toEqual(['electric', 'mechanical']);

    // Persisted under the tenant/project path.
    const appKeys = dumpKeys(`tenants/${TENANT}/projects/${PROJECT}/loto_applications/${app.id}`);
    expect(appKeys.length).toBeGreaterThanOrEqual(1);
    // Legal audit subcollection has the 'created' event.
    const auditDocs = dumpKeys(`tenants/${TENANT}/projects/${PROJECT}/loto_applications/${app.id}/audit/`);
    expect(auditDocs.length).toBe(1);
    expect(H.db!._dump()[auditDocs[0]!].kind).toBe('created');
    // Global audit_logs wiring (CLAUDE.md #3).
    expect(H.audit).toHaveBeenCalledWith(
      expect.anything(),
      'loto.created',
      'loto',
      expect.objectContaining({ equipmentId: 'eq-1' }),
      expect.objectContaining({ projectId: PROJECT }),
    );
  });
});

describe('POST apply-lock / verify-zero-energy / release lifecycle', () => {
  it('404 when applying a lock to a missing application', async () => {
    const res = await request(buildApp())
      .post(`${base}/nope/apply-lock`)
      .set(asUser(LEADER))
      .send({ pointId: 'lp1', description: 'd', energyType: 'electric', tagId: 'RED-1' });
    expect(res.status).toBe(404);
  });

  it('applies a lock (stamped actor), rejects duplicates, and verifies zero-energy → authorizes work', async () => {
    const created = await createApp(['electric']);
    const appId = created.body.application.id;

    const lock = await request(buildApp())
      .post(`${base}/${appId}/apply-lock`)
      .set(asUser(WORKER))
      .send({ pointId: 'lp1', description: 'Seccionador', energyType: 'electric', tagId: 'RED-1' });
    expect(lock.status).toBe(200);
    expect(lock.body.application.lockPoints[0]).toMatchObject({
      pointId: 'lp1',
      appliedByUid: WORKER,
      zeroEnergyVerified: false,
    });
    // Not authorized yet — zero-energy unverified.
    expect(lock.body.validation.authorizesWork).toBe(false);

    // Duplicate point id → 409.
    const dup = await request(buildApp())
      .post(`${base}/${appId}/apply-lock`)
      .set(asUser(WORKER))
      .send({ pointId: 'lp1', description: 'x', energyType: 'electric', tagId: 'RED-2' });
    expect(dup.status).toBe(409);

    // verify-zero-energy on an unknown point → 404.
    const badVerify = await request(buildApp())
      .post(`${base}/${appId}/verify-zero-energy`)
      .set(asUser(WORKER))
      .send({ pointId: 'ghost' });
    expect(badVerify.status).toBe(404);

    const verify = await request(buildApp())
      .post(`${base}/${appId}/verify-zero-energy`)
      .set(asUser(WORKER))
      .send({ pointId: 'lp1' });
    expect(verify.status).toBe(200);
    expect(verify.body.application.lockPoints[0].zeroEnergyVerified).toBe(true);
    // All energies locked + verified, not released → work authorized.
    expect(verify.body.validation.authorizesWork).toBe(true);
  });

  it('403 release for an unauthorized actor; 200 + fullyReleasedAt for the leader', async () => {
    const created = await createApp(['electric'], [WORKER]);
    const appId = created.body.application.id;

    // Outsider is a project member? No — make them a member to pass the project
    // guard but NOT a LOTO leader/authorized worker → release must 403.
    seedProject([LEADER, WORKER, OUTSIDER]);
    const denied = await request(buildApp())
      .post(`${base}/${appId}/release`)
      .set(asUser(OUTSIDER))
      .send({});
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe('release_not_allowed');

    const released = await request(buildApp())
      .post(`${base}/${appId}/release`)
      .set(asUser(LEADER))
      .send({});
    expect(released.status).toBe(200);
    expect(released.body.application.fullyReleasedAt).toBeTruthy();

    // full_release recorded in the legal audit log + global audit_logs.
    const auditDocs = dumpKeys(`tenants/${TENANT}/projects/${PROJECT}/loto_applications/${appId}/audit/`);
    const kinds = auditDocs.map((k) => H.db!._dump()[k].kind);
    expect(kinds).toContain('full_release');
    expect(H.audit).toHaveBeenCalledWith(
      expect.anything(),
      'loto.full_release',
      'loto',
      expect.objectContaining({ applicationId: appId }),
      expect.objectContaining({ projectId: PROJECT }),
    );

    // A second release is now a no-op gate → 403 (already fully released).
    const again = await request(buildApp())
      .post(`${base}/${appId}/release`)
      .set(asUser(LEADER))
      .send({});
    expect(again.status).toBe(403);
  });
});
