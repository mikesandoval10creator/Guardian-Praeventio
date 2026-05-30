// Real-router supertest for src/server/routes/engineeringControls.ts
// (Plan v3 Fase 1 — raise line coverage toward 90%).
//
// Route mounted at /api/sprint-k in server.ts (line 965).
// 3 endpoints:
//   GET  /:projectId/engineering-controls[?level=...&riskCategory=...]
//   POST /:projectId/engineering-controls
//   POST /:projectId/engineering-controls/:id/verify
//
// guard() calls assertProjectMember (reads projects/<id> via fakeFirestore)
// then resolveTenantId (reads projects/<id>.tenantId). Seed both fields.

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
    if (!uid) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    (req as Request & { user: Record<string, unknown> }).user = {
      uid,
      role: req.header('x-test-role') || undefined,
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import engineeringControlsRouter from '../../server/routes/engineeringControls.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', engineeringControlsRouter);
  return app;
}

const PROJECT_ID = 'p-ec-test';
const TENANT_ID = 'tenant-ec-test';
const CALLER_UID = 'uid-ec-member';
const OTHER_UID = 'uid-ec-other';

/** Seed project doc with tenantId + member so guard() passes. */
function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'EC Test Project',
    tenantId: TENANT_ID,
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

/** Seed a control document inside the tenant path. */
function seedControl(
  db: NonNullable<typeof H.db>,
  controlId: string,
  overrides: Record<string, unknown> = {},
) {
  db._seed(
    `tenants/${TENANT_ID}/projects/${PROJECT_ID}/engineering_controls/${controlId}`,
    {
      id: controlId,
      level: 'engineering',
      riskCategory: 'caida',
      name: 'Barandas perimetrales',
      description: 'Instalación de barandas en perímetro de obra',
      responsibleUid: CALLER_UID,
      verificationFrequencyDays: 30,
      createdAt: '2026-01-01T00:00:00.000Z',
      createdBy: CALLER_UID,
      lastVerifiedAt: null,
      verifications: [],
      ...overrides,
    },
  );
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:projectId/engineering-controls
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/engineering-controls', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/engineering-controls`;

  it('401 without token', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', OTHER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when project has no tenantId', async () => {
    H.db!._seed(`projects/no-tenant-proj`, {
      name: 'No Tenant',
      members: [CALLER_UID],
      createdBy: CALLER_UID,
      // no tenantId field
    });
    const res = await request(buildApp())
      .get(`/api/sprint-k/no-tenant-proj/engineering-controls`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 returns empty controls array when collection is empty', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.controls)).toBe(true);
    expect(res.body.controls).toHaveLength(0);
    expect(res.body.warning).toBeUndefined();
  });

  it('200 returns all controls without filter', async () => {
    seedControl(H.db!, 'ctrl-1', { level: 'elimination', riskCategory: 'caida' });
    seedControl(H.db!, 'ctrl-2', { level: 'epp', riskCategory: 'quimico' });
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.controls).toHaveLength(2);
  });

  it('200 filters by level=engineering', async () => {
    seedControl(H.db!, 'ctrl-eng', { level: 'engineering', riskCategory: 'caida' });
    seedControl(H.db!, 'ctrl-epp', { level: 'epp', riskCategory: 'caida' });
    const res = await request(buildApp())
      .get(`${url}?level=engineering`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.controls).toHaveLength(1);
    expect(res.body.controls[0].id).toBe('ctrl-eng');
  });

  it('200 level=admin maps to administrative', async () => {
    seedControl(H.db!, 'ctrl-adm', { level: 'administrative', riskCategory: 'caida' });
    seedControl(H.db!, 'ctrl-eng2', { level: 'engineering', riskCategory: 'caida' });
    const res = await request(buildApp())
      .get(`${url}?level=admin`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.controls).toHaveLength(1);
    expect(res.body.controls[0].id).toBe('ctrl-adm');
  });

  it('200 unknown level falls back to all', async () => {
    seedControl(H.db!, 'ctrl-e', { level: 'elimination', riskCategory: 'caida' });
    seedControl(H.db!, 'ctrl-s', { level: 'substitution', riskCategory: 'quimico' });
    const res = await request(buildApp())
      .get(`${url}?level=bogus-level`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.controls).toHaveLength(2);
  });

  it('200 filters by riskCategory — excludes non-matching, includes general', async () => {
    seedControl(H.db!, 'ctrl-caida', { level: 'engineering', riskCategory: 'caida' });
    seedControl(H.db!, 'ctrl-quim', { level: 'engineering', riskCategory: 'quimico' });
    seedControl(H.db!, 'ctrl-gen', { level: 'administrative', riskCategory: 'general' });
    const res = await request(buildApp())
      .get(`${url}?riskCategory=caida`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    // Should include ctrl-caida (exact match) + ctrl-gen (cross-cutting), NOT ctrl-quim
    const ids = (res.body.controls as { id: string }[]).map((c) => c.id);
    expect(ids).toContain('ctrl-caida');
    expect(ids).toContain('ctrl-gen');
    expect(ids).not.toContain('ctrl-quim');
  });

  it('200 combined level + riskCategory filter', async () => {
    seedControl(H.db!, 'c1', { level: 'engineering', riskCategory: 'caida' });
    seedControl(H.db!, 'c2', { level: 'epp', riskCategory: 'caida' });
    seedControl(H.db!, 'c3', { level: 'engineering', riskCategory: 'quimico' });
    const res = await request(buildApp())
      .get(`${url}?level=engineering&riskCategory=caida`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.controls).toHaveLength(1);
    expect(res.body.controls[0].id).toBe('c1');
  });

  it('200 controls include all stored fields', async () => {
    seedControl(H.db!, 'ctrl-full', {
      level: 'substitution',
      riskCategory: 'electrico',
      name: 'Sustitución equipo antiguo',
      description: 'Reemplazar maquinaria de alta tensión por menor voltaje',
      verificationFrequencyDays: 90,
    });
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const ctrl = res.body.controls[0] as Record<string, unknown>;
    expect(ctrl.id).toBe('ctrl-full');
    expect(ctrl.level).toBe('substitution');
    expect(ctrl.riskCategory).toBe('electrico');
    expect(ctrl.verificationFrequencyDays).toBe(90);
    expect(ctrl.lastVerifiedAt).toBeNull();
    expect(Array.isArray(ctrl.verifications)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/engineering-controls (create)
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/engineering-controls (create)', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/engineering-controls`;

  const validBody = {
    id: 'ctrl-new-001',
    level: 'engineering' as const,
    riskCategory: 'altura',
    name: 'Línea de vida',
    description: 'Línea de vida horizontal para trabajos en altura',
    responsibleUid: CALLER_UID,
    verificationFrequencyDays: 7,
  };

  it('401 without token', async () => {
    const res = await request(buildApp()).post(url).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 when id is missing', async () => {
    const { id: _id, ...noId } = validBody;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(noId);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when level is not a valid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, level: 'unknown-level' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when name is too short (< 3 chars)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, name: 'AB' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when verificationFrequencyDays is zero (not positive)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, verificationFrequencyDays: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when verificationFrequencyDays exceeds 3650', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...validBody, verificationFrequencyDays: 3651 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', OTHER_UID)
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('201 creates the control and returns the document', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const ctrl = res.body.control as Record<string, unknown>;
    expect(ctrl.id).toBe(validBody.id);
    expect(ctrl.level).toBe(validBody.level);
    expect(ctrl.riskCategory).toBe(validBody.riskCategory);
    expect(ctrl.name).toBe(validBody.name);
    expect(ctrl.description).toBe(validBody.description);
    // createdBy must be the caller uid, not any client-supplied value
    expect(ctrl.createdBy).toBe(CALLER_UID);
    expect(ctrl.lastVerifiedAt).toBeNull();
    expect(Array.isArray(ctrl.verifications)).toBe(true);
    expect((ctrl.verifications as unknown[]).length).toBe(0);
    // createdAt must be a valid ISO string
    expect(typeof ctrl.createdAt).toBe('string');
    expect(() => new Date(ctrl.createdAt as string)).not.toThrow();
  });

  it('201 document is persisted in fakeFirestore', async () => {
    await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(validBody);
    const stored = H.db!._dump();
    const key = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/engineering_controls/${validBody.id}`;
    expect(stored[key]).toBeDefined();
    expect((stored[key] as Record<string, unknown>).name).toBe(validBody.name);
  });

  it('201 all valid hierarchy levels are accepted', async () => {
    const levels = ['elimination', 'substitution', 'engineering', 'administrative', 'epp'] as const;
    for (const level of levels) {
      const body = { ...validBody, id: `ctrl-level-${level}`, level };
      const res = await request(buildApp())
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send(body);
      expect(res.status).toBe(201);
      expect(res.body.control.level).toBe(level);
    }
  });

  it('409 when control id already exists (duplicate detection)', async () => {
    // First create succeeds
    const firstRes = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(validBody);
    expect(firstRes.status).toBe(201);

    // Second create with same id returns 409
    const secondRes = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(validBody);
    expect(secondRes.status).toBe(409);
    expect(secondRes.body.error).toBe('engineering_control_duplicate_id');
    expect(secondRes.body.controlId).toBe(validBody.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:projectId/engineering-controls/:id/verify
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/engineering-controls/:id/verify', () => {
  const CONTROL_ID = 'ctrl-verify-001';
  const baseUrl = `/api/sprint-k/${PROJECT_ID}/engineering-controls`;
  const url = `${baseUrl}/${CONTROL_ID}/verify`;

  beforeEach(() => {
    seedControl(H.db!, CONTROL_ID);
  });

  it('401 without token', async () => {
    const res = await request(buildApp()).post(url).send({ result: 'pass' });
    expect(res.status).toBe(401);
  });

  it('400 when result is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when result is not a valid enum value', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ result: 'unknown-result' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when evidence exceeds 4000 chars', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ result: 'pass', evidence: 'x'.repeat(4001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', OTHER_UID)
      .send({ result: 'pass' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when control document does not exist', async () => {
    const res = await request(buildApp())
      .post(`${baseUrl}/nonexistent-ctrl/verify`)
      .set('x-test-uid', CALLER_UID)
      .send({ result: 'pass' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('control_not_found');
  });

  it('200 pass — returns entry and updates lastVerifiedAt', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ result: 'pass' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const entry = res.body.entry as Record<string, unknown>;
    // verifierUid must be the authenticated caller, never client-supplied
    expect(entry.verifierUid).toBe(CALLER_UID);
    expect(entry.result).toBe('pass');
    expect(typeof entry.verifiedAt).toBe('string');
    expect(entry.evidence).toBeUndefined();

    // Verify Firestore was updated: lastVerifiedAt should now be set
    const stored = H.db!._dump();
    const key = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/engineering_controls/${CONTROL_ID}`;
    const doc = stored[key] as Record<string, unknown>;
    expect(doc.lastVerifiedAt).toBe(entry.verifiedAt);
  });

  it('200 pass — verification entry is appended in Firestore (arrayUnion)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ result: 'pass', evidence: 'Foto adjunta' });
    expect(res.status).toBe(200);

    const stored = H.db!._dump();
    const key = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/engineering_controls/${CONTROL_ID}`;
    const doc = stored[key] as Record<string, unknown>;
    const verifications = doc.verifications as Record<string, unknown>[];
    expect(Array.isArray(verifications)).toBe(true);
    expect(verifications.length).toBeGreaterThan(0);
    const last = verifications[verifications.length - 1];
    expect(last.verifierUid).toBe(CALLER_UID);
    expect(last.result).toBe('pass');
    expect(last.evidence).toBe('Foto adjunta');
  });

  it('200 observation — does NOT update lastVerifiedAt', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ result: 'observation', evidence: 'Observación menor' });
    expect(res.status).toBe(200);
    expect(res.body.entry.result).toBe('observation');

    // lastVerifiedAt must remain null (observation doesn't advance it)
    const stored = H.db!._dump();
    const key = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/engineering_controls/${CONTROL_ID}`;
    const doc = stored[key] as Record<string, unknown>;
    expect(doc.lastVerifiedAt).toBeNull();
  });

  it('200 fail — does NOT update lastVerifiedAt', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ result: 'fail', evidence: 'Baranda sin soporte' });
    expect(res.status).toBe(200);
    expect(res.body.entry.result).toBe('fail');

    const stored = H.db!._dump();
    const key = `tenants/${TENANT_ID}/projects/${PROJECT_ID}/engineering_controls/${CONTROL_ID}`;
    const doc = stored[key] as Record<string, unknown>;
    expect(doc.lastVerifiedAt).toBeNull();
  });

  it('200 pass with evidence omitted — evidence absent from entry', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ result: 'pass' });
    expect(res.status).toBe(200);
    // entry should not contain an evidence key at all
    expect(Object.prototype.hasOwnProperty.call(res.body.entry, 'evidence')).toBe(false);
  });

  it('200 all three result values are accepted', async () => {
    for (const result of ['pass', 'observation', 'fail'] as const) {
      // Re-seed control each time (beforeEach only runs once per describe block)
      H.db = createFakeFirestore();
      seedProject(H.db);
      seedControl(H.db, CONTROL_ID);
      const res = await request(buildApp())
        .post(url)
        .set('x-test-uid', CALLER_UID)
        .send({ result });
      expect(res.status).toBe(200);
      expect(res.body.entry.result).toBe(result);
    }
  });
});
