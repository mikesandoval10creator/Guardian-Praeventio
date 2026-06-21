// Praeventio Guard — Expirations router: real-router behavioral supertest
// (Fase 5, B.9 — vida/legal). Boots the REAL expirations router with
// admin.firestore() backed by the in-memory FakeFirestore and drives both
// stateless compute endpoints over HTTP via supertest. The router itself does
// NO Firestore writes (pure compute over scanForExpirations /
// buildExpirationFindingPayload), so it asserts: the 401 gate, the 403
// project-membership gate, the REAL engine output in the 200 response body
// (severity bucketing + finding-payload shape), and the zod 400 envelope.
//
// Mirrors the canonical pattern in ./loto.test.ts: vi.hoisted FakeFirestore
// holder, vi.mock('firebase-admin', adminMock), header-driven verifyAuth mock,
// captureRouteError + logger mocks, then express() + express.json() + app.use.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../../__tests__/helpers/fakeFirestore').createFakeFirestore> | null,
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

import expirationsRouter from './expirations';
import { createFakeFirestore } from '../../__tests__/helpers/fakeFirestore';

const PREFIX = '/api/sprint-k';
const TENANT = 't1';
const PROJECT = 'p1';
const MEMBER = 'member-1';
const OUTSIDER = 'outsider-9';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, expirationsRouter);
  return app;
}

function seedProject(members: string[] = [MEMBER]) {
  H.db!._seed(`projects/${PROJECT}`, { tenantId: TENANT, members, createdBy: MEMBER });
}

const asUser = (uid: string) => ({ 'x-test-uid': uid });
const scanBase = `${PREFIX}/${PROJECT}/expirations/scan`;
const payloadBase = `${PREFIX}/${PROJECT}/expirations/build-finding-payload`;
const listBase = `${PREFIX}/${PROJECT}/expirations/list`;

// Anchor "now" so day-bucketing is deterministic regardless of wall clock.
const NOW = '2026-06-18T00:00:00.000Z';
function daysFromNow(days: number): string {
  return new Date(Date.parse(NOW) + days * 24 * 60 * 60 * 1000).toISOString();
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject();
});

describe('POST /:projectId/expirations/scan', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(scanBase)
      .send({ items: [] });
    expect(res.status).toBe(401);
  });

  it('403 for a non-member (assertProjectMember reads the seeded project doc)', async () => {
    const res = await request(buildApp())
      .post(scanBase)
      .set(asUser(OUTSIDER))
      .send({ items: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 on an invalid body (item with an unknown kind fails the zod enum)', async () => {
    const res = await request(buildApp())
      .post(scanBase)
      .set(asUser(MEMBER))
      .send({ items: [{ id: 'x', kind: 'not_a_real_kind', expiresAt: NOW }] });
    expect(res.status).toBe(400);
    // validate() middleware envelope.
    expect(res.body.error).toBe('invalid_payload');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('200 runs the REAL scanner and buckets items by severity', async () => {
    const items = [
      // expired: 5 days ago → daysUntilExpiry < 0
      { id: 'cert-expired', kind: 'training', expiresAt: daysFromNow(-5), label: 'Capacitación altura' },
      // critical: within criticalWindowDays (default 7)
      { id: 'exam-critical', kind: 'occupational_exam', expiresAt: daysFromNow(3) },
      // warning: > 7 and <= warningWindowDays (default 30)
      { id: 'lic-warning', kind: 'license', expiresAt: daysFromNow(20) },
      // ok: far beyond the warning window
      { id: 'doc-ok', kind: 'document', expiresAt: daysFromNow(200) },
      // skipped: no expiresAt
      { id: 'epp-noexp', kind: 'epp', expiresAt: null },
      // skipped: already-expired status is ignored by the scanner
      { id: 'doc-archived', kind: 'document', expiresAt: daysFromNow(-1), status: 'archived' },
    ];

    const res = await request(buildApp())
      .post(scanBase)
      .set(asUser(MEMBER))
      .send({ items, opts: { now: NOW } });

    expect(res.status).toBe(200);
    const result = res.body.result;
    expect(result).toBeDefined();

    // Each bucket holds exactly the expected item ids — proves the REAL engine
    // ran (not a stubbed echo).
    expect(result.expired.map((o: { item: { id: string } }) => o.item.id)).toEqual(['cert-expired']);
    expect(result.critical.map((o: { item: { id: string } }) => o.item.id)).toEqual(['exam-critical']);
    expect(result.warning.map((o: { item: { id: string } }) => o.item.id)).toEqual(['lic-warning']);
    expect(result.ok.map((o: { item: { id: string } }) => o.item.id)).toEqual(['doc-ok']);

    // Two items skipped (no expiresAt + archived status).
    expect(result.skipped).toBe(2);
    expect(result.totalScanned).toBe(items.length - 2);

    // Severity + daysUntilExpiry are computed by the engine, not echoed.
    expect(result.expired[0].severity).toBe('expired');
    expect(result.expired[0].daysUntilExpiry).toBeLessThan(0);
    expect(result.critical[0].severity).toBe('critical');
  });

  it('400 when scan opts are contradictory (engine RangeError → 400 validation_error)', async () => {
    // criticalWindowDays >= warningWindowDays makes the engine throw RangeError,
    // which the handler maps to 400 { error: 'validation_error' }.
    const res = await request(buildApp())
      .post(scanBase)
      .set(asUser(MEMBER))
      .send({
        items: [{ id: 'a', kind: 'document', expiresAt: daysFromNow(10) }],
        opts: { now: NOW, warningWindowDays: 5, criticalWindowDays: 10 },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });
});

describe('POST /:projectId/expirations/build-finding-payload', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(payloadBase)
      .send({ outcome: {} });
    expect(res.status).toBe(401);
  });

  it('403 for a non-member', async () => {
    const res = await request(buildApp())
      .post(payloadBase)
      .set(asUser(OUTSIDER))
      .send({
        outcome: {
          item: { id: 'a', kind: 'license', expiresAt: NOW },
          daysUntilExpiry: 5,
          severity: 'critical',
        },
      });
    expect(res.status).toBe(403);
  });

  it('400 on an invalid outcome (missing required fields)', async () => {
    const res = await request(buildApp())
      .post(payloadBase)
      .set(asUser(MEMBER))
      .send({ outcome: { item: { id: 'a', kind: 'license' } } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 builds the REAL expiration_warning finding payload', async () => {
    const res = await request(buildApp())
      .post(payloadBase)
      .set(asUser(MEMBER))
      .send({
        outcome: {
          item: {
            id: 'lic-77',
            kind: 'license',
            expiresAt: daysFromNow(3),
            label: 'Licencia conducir interno',
            projectId: PROJECT,
            ownerId: MEMBER,
          },
          daysUntilExpiry: 3,
          severity: 'critical',
        },
      });

    expect(res.status).toBe(200);
    const payload = res.body.payload;
    expect(payload).toMatchObject({
      type: 'expiration_warning',
      itemId: 'lic-77',
      itemKind: 'license',
      label: 'Licencia conducir interno',
      daysUntilExpiry: 3,
      severity: 'critical',
      projectId: PROJECT,
      ownerId: MEMBER,
    });
    expect(payload.expiresAt).toBe(daysFromNow(3));
  });

  it('200 falls back to "kind:id" label when none is provided (engine default)', async () => {
    const res = await request(buildApp())
      .post(payloadBase)
      .set(asUser(MEMBER))
      .send({
        outcome: {
          item: { id: 'c-9', kind: 'contract', expiresAt: NOW },
          daysUntilExpiry: 0,
          severity: 'critical',
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.payload.label).toBe('contract:c-9');
  });
});

describe('GET /:projectId/expirations/list (real EPP-assignment read-path)', () => {
  // This is the read-path that feeds the mounted <ExpirationsListPanel /> on the
  // Dashboard (src/pages/Dashboard.tsx) via useExpirableItems. It assembles REAL
  // ExpirableItem[] from `projects/{id}/epp_assignments` — no fabricated dates.

  function seedEpp(docId: string, data: Record<string, unknown>) {
    H.db!._seed(`projects/${PROJECT}/epp_assignments/${docId}`, data);
  }

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(listBase);
    expect(res.status).toBe(401);
  });

  it('403 for a non-member', async () => {
    const res = await request(buildApp()).get(listBase).set(asUser(OUTSIDER));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 maps real EPP assignments (with expiresAt) to ExpirableItem shape', async () => {
    seedEpp('epp-helmet', {
      eppItemName: 'Casco clase B',
      expiresAt: daysFromNow(10),
      status: 'active',
      workerId: 'worker-77',
    });

    const res = await request(buildApp()).get(listBase).set(asUser(MEMBER));

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        id: 'epp-helmet',
        kind: 'epp',
        expiresAt: daysFromNow(10),
        label: 'Casco clase B',
        status: 'active',
        ownerId: 'worker-77',
        projectId: PROJECT,
      },
    ]);
  });

  it('200 skips EPP assignments without a real expiresAt (no fabricated dates)', async () => {
    seedEpp('epp-no-exp', { eppItemName: 'Guantes', workerId: 'worker-1' });
    seedEpp('epp-empty-exp', { eppItemName: 'Botas', expiresAt: '', workerId: 'worker-2' });
    seedEpp('epp-real', {
      eppItemName: 'Arnés',
      expiresAt: daysFromNow(5),
      workerId: 'worker-3',
    });

    const res = await request(buildApp()).get(listBase).set(asUser(MEMBER));

    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(['epp-real']);
    expect(res.body.items[0].label).toBe('Arnés');
  });

  it('200 returns an empty list when the project has no EPP assignments (honest empty-state)', async () => {
    const res = await request(buildApp()).get(listBase).set(asUser(MEMBER));
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('500 when the EPP read fails (handler maps Firestore errors to internal_error)', async () => {
    seedEpp('epp-helmet', { eppItemName: 'Casco', expiresAt: daysFromNow(10) });
    // Fail only the EPP subcollection read — the prior assertProjectMember
    // project-doc read still succeeds, so the 500 is from the list assembly.
    H.db!._failReads('epp_assignments');
    const res = await request(buildApp()).get(listBase).set(asUser(MEMBER));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });
});
