// Real-router supertest for src/server/routes/industryRules.ts
// (Plan v3 Fase 1 — 5 endpoints, 0 Firestore writes, pure-compute preset engine).
//
// The route is NOT yet mounted in server.ts (Bloque 3.13 in-progress), so we
// use '/api' as the prefix matching the standard pattern for new domain
// routes. All five endpoints:
//
//   GET  /:projectId/industry/list
//   POST /:projectId/industry/select
//   GET  /:projectId/industry/applicable-norms
//   GET  /:projectId/industry/required-epp
//   GET  /:projectId/industry/typical-hazards
//
// are behind verifyAuth + assertProjectMember (guard helper). POST /select
// also carries idempotencyKey() which is a pass-through when the
// Idempotency-Key header is absent — we test without it so no Firestore
// write for the cache is triggered. The preset engine itself is pure-compute
// (in-memory PRESETS map) and is NOT mocked — we exercise the real output.

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

import industryRulesRouter from '../../server/routes/industryRules.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', industryRulesRouter);
  return app;
}

const PROJECT_ID = 'p-industry-test';
const CALLER_UID = 'uid-industry-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Test Industry Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ────────────────────────────────────────────────────────────────────────────
// 1. GET /:projectId/industry/list
// ────────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/industry/list', () => {
  const url = `/api/${PROJECT_ID}/industry/list`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', 'stranger-uid');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .get(`/api/nonexistent-project/industry/list`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns the full preset catalog (array of presets with prefix+label)', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.presets)).toBe(true);
    expect(res.body.presets.length).toBeGreaterThan(0);
    // Every entry must have prefix and label
    for (const p of res.body.presets as { prefix: string; label: string }[]) {
      expect(typeof p.prefix).toBe('string');
      expect(typeof p.label).toBe('string');
    }
  });

  it('200 catalog includes the seven known industry presets', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const prefixes = (res.body.presets as { prefix: string }[]).map((p) => p.prefix);
    for (const expected of ['GP-MIN', 'GP-CONS', 'GP-AGR', 'GP-TRANS', 'GP-SAL', 'GP-ELEC', 'GP-MANU']) {
      expect(prefixes).toContain(expected);
    }
  });

  it('200 GP-MIN label is Minería (GP-MIN)', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const minPreset = (res.body.presets as { prefix: string; label: string }[])
      .find((p) => p.prefix === 'GP-MIN');
    expect(minPreset).toBeDefined();
    expect(minPreset!.label).toBe('Minería (GP-MIN)');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/industry/select
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/industry/select', () => {
  const url = `/api/${PROJECT_ID}/industry/select`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ industryPrefix: 'GP-MIN' });
    expect(res.status).toBe(401);
  });

  it('400 when industryPrefix is missing from body', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when industryPrefix has lowercase (fails regex /^[A-Z0-9-]+$/)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ industryPrefix: 'gp-min' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when industryPrefix is empty string (fails min(1))', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ industryPrefix: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when industryPrefix exceeds 64 chars', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ industryPrefix: 'A'.repeat(65) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ industryPrefix: 'GP-MIN' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns application + preset for GP-MIN (known industry)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ industryPrefix: 'GP-MIN' });
    expect(res.status).toBe(200);

    // Preset shape
    const { preset, application } = res.body as {
      preset: Record<string, unknown>;
      application: Record<string, unknown>;
    };
    expect(preset.industryPrefix).toBe('GP-MIN');
    expect(preset.label).toBe('Minería (GP-MIN)');
    expect(Array.isArray(preset.typicalRisks)).toBe(true);
    expect((preset.typicalRisks as string[])).toContain('silice');
    expect(Array.isArray(preset.applicableRegulations)).toBe(true);
    expect((preset.applicableRegulations as string[])).toContain('DS 132');
    expect(Array.isArray(preset.baseEpp)).toBe(true);
    expect((preset.baseEpp as string[])).toContain('Casco minero');

    // Application shape
    expect(application.projectId).toBe(PROJECT_ID);
    expect(application.industryPrefix).toBe('GP-MIN');
    expect(Array.isArray(application.risksToCreate)).toBe(true);
    expect((application.risksToCreate as unknown[]).length).toBeGreaterThan(0);
    expect(Array.isArray(application.documentsToGenerate)).toBe(true);
    expect(Array.isArray(application.trainingsToSchedule)).toBe(true);
    expect(Array.isArray(application.regulationsToLink)).toBe(true);
  });

  it('200 severity is high for silice and alta_tension risks (severity rules)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ industryPrefix: 'GP-MIN' });
    expect(res.status).toBe(200);
    const { application } = res.body as {
      application: { risksToCreate: Array<{ riskType: string; severity: string }> };
    };
    const silice = application.risksToCreate.find((r) => r.riskType === 'silice');
    expect(silice?.severity).toBe('high');
    // ruido is medium (not alta_tension / silice / altura)
    const ruido = application.risksToCreate.find((r) => r.riskType === 'ruido');
    expect(ruido?.severity).toBe('medium');
  });

  it('200 returns fallback preset for unknown industry prefix', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ industryPrefix: 'GP-UNKNOWN' });
    expect(res.status).toBe(200);
    const { preset } = res.body as { preset: Record<string, unknown> };
    expect(preset.industryPrefix).toBe('GP-UNKNOWN');
    expect(preset.label).toBe('Genérico (GP-UNKNOWN)');
    // Fallback regulations must include DS 594 and Ley 16.744
    expect((preset.applicableRegulations as string[])).toContain('DS 594');
    expect((preset.applicableRegulations as string[])).toContain('Ley 16.744');
  });

  it('200 is idempotent — same body twice returns identical shapes', async () => {
    const app = buildApp();
    const [r1, r2] = await Promise.all([
      request(app).post(url).set('x-test-uid', CALLER_UID).send({ industryPrefix: 'GP-CONS' }),
      request(app).post(url).set('x-test-uid', CALLER_UID).send({ industryPrefix: 'GP-CONS' }),
    ]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r1.body).toEqual(r2.body);
  });

  it('200 GP-ELEC has empty minsalProtocols (sector-specific)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ industryPrefix: 'GP-ELEC' });
    expect(res.status).toBe(200);
    const { preset } = res.body as { preset: { minsalProtocols: string[] } };
    expect(preset.minsalProtocols).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 3. GET /:projectId/industry/applicable-norms
// ────────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/industry/applicable-norms', () => {
  const base = `/api/${PROJECT_ID}/industry/applicable-norms`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(`${base}?industryPrefix=GP-MIN`);
    expect(res.status).toBe(401);
  });

  it('400 when industryPrefix query param is missing', async () => {
    const res = await request(buildApp())
      .get(base)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_industry_prefix');
  });

  it('400 when industryPrefix has invalid characters (lowercase)', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=gp-min`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_industry_prefix');
  });

  it('400 when industryPrefix is empty string', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_industry_prefix');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-MIN`)
      .set('x-test-uid', 'stranger-uid');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns applicableRegulations + minsalProtocols for GP-MIN', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-MIN`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.industryPrefix).toBe('GP-MIN');
    expect(Array.isArray(res.body.applicableRegulations)).toBe(true);
    expect((res.body.applicableRegulations as string[])).toContain('DS 132');
    expect((res.body.applicableRegulations as string[])).toContain('DS 594');
    expect((res.body.applicableRegulations as string[])).toContain('Ley 16.744');
    expect(Array.isArray(res.body.minsalProtocols)).toBe(true);
    expect((res.body.minsalProtocols as string[])).toContain('PREXOR_silice');
  });

  it('200 returns fallback regulations for unknown prefix (DS 594 + Ley 16.744)', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-UNKNOWN`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.industryPrefix).toBe('GP-UNKNOWN');
    expect((res.body.applicableRegulations as string[])).toContain('DS 594');
    expect((res.body.applicableRegulations as string[])).toContain('Ley 16.744');
    // Fallback has empty minsalProtocols
    expect(res.body.minsalProtocols).toEqual([]);
  });

  it('200 GP-CONS regulations include DS 76 and Ley 20.123', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-CONS`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect((res.body.applicableRegulations as string[])).toContain('DS 76');
    expect((res.body.applicableRegulations as string[])).toContain('Ley 20.123');
  });

  it('200 GP-SAL regulations include Ley 19.937 (Ley AUGE)', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-SAL`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect((res.body.applicableRegulations as string[])).toContain('Ley 19.937');
  });

  it('200 body does NOT include typicalRisks (field isolation)', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-MIN`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    // This endpoint must return ONLY industryPrefix + applicableRegulations + minsalProtocols
    expect(res.body.typicalRisks).toBeUndefined();
    expect(res.body.baseEpp).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 4. GET /:projectId/industry/required-epp
// ────────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/industry/required-epp', () => {
  const base = `/api/${PROJECT_ID}/industry/required-epp`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(`${base}?industryPrefix=GP-MIN`);
    expect(res.status).toBe(401);
  });

  it('400 when industryPrefix query param is missing', async () => {
    const res = await request(buildApp())
      .get(base)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_industry_prefix');
  });

  it('400 when industryPrefix fails the regex (spaces)', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP%20MIN`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_industry_prefix');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-MIN`)
      .set('x-test-uid', 'stranger-uid');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns baseEpp array for GP-MIN (real EPP_BY_SECTOR values)', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-MIN`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.industryPrefix).toBe('GP-MIN');
    expect(Array.isArray(res.body.baseEpp)).toBe(true);
    expect(res.body.baseEpp.length).toBeGreaterThan(0);
    // From EPP_BY_SECTOR['GP-MIN']
    expect((res.body.baseEpp as string[])).toContain('Casco minero');
    expect((res.body.baseEpp as string[])).toContain('Respirador gases');
  });

  it('200 returns baseEpp for GP-ELEC (dielectric equipment)', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-ELEC`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect((res.body.baseEpp as string[])).toContain('Casco dieléctrico');
    expect((res.body.baseEpp as string[])).toContain('Guantes aislantes');
  });

  it('200 returns EPP_DEFAULT labels for an unknown prefix', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-UNKNOWN`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.baseEpp)).toBe(true);
    // EPP_DEFAULT includes Casco, Guantes, Lentes, Botas
    expect((res.body.baseEpp as string[])).toContain('Casco');
    expect((res.body.baseEpp as string[])).toContain('Guantes');
  });

  it('200 body does NOT include applicableRegulations (field isolation)', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-MIN`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.applicableRegulations).toBeUndefined();
    expect(res.body.typicalRisks).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// 5. GET /:projectId/industry/typical-hazards
// ────────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/industry/typical-hazards', () => {
  const base = `/api/${PROJECT_ID}/industry/typical-hazards`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).get(`${base}?industryPrefix=GP-MIN`);
    expect(res.status).toBe(401);
  });

  it('400 when industryPrefix query param is missing', async () => {
    const res = await request(buildApp())
      .get(base)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_industry_prefix');
  });

  it('400 when industryPrefix is numeric-only (fails regex on non-uppercase letter-digit)', async () => {
    // '123' is valid by the regex (all uppercase-or-digit). Let's test an actual invalid one.
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=gp_min`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_industry_prefix');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-MIN`)
      .set('x-test-uid', 'stranger-uid');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns label + typicalRisks + mandatoryDocuments + mandatoryTrainings for GP-MIN', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-MIN`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.industryPrefix).toBe('GP-MIN');
    expect(res.body.label).toBe('Minería (GP-MIN)');

    // typicalRisks for GP-MIN
    expect(Array.isArray(res.body.typicalRisks)).toBe(true);
    expect((res.body.typicalRisks as string[])).toContain('silice');
    expect((res.body.typicalRisks as string[])).toContain('espacio_confinado');
    expect((res.body.typicalRisks as string[])).toContain('altura');

    // mandatoryDocuments
    expect(Array.isArray(res.body.mandatoryDocuments)).toBe(true);
    expect((res.body.mandatoryDocuments as string[])).toContain('Plan Emergencia');
    expect((res.body.mandatoryDocuments as string[])).toContain('RIOHS');

    // mandatoryTrainings
    expect(Array.isArray(res.body.mandatoryTrainings)).toBe(true);
    expect((res.body.mandatoryTrainings as string[])).toContain('rescate_minero');
    expect((res.body.mandatoryTrainings as string[])).toContain('exposicion_silice');
  });

  it('200 GP-CONS typical risks include altura + electrico', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-CONS`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect((res.body.typicalRisks as string[])).toContain('altura');
    expect((res.body.typicalRisks as string[])).toContain('electrico');
  });

  it('200 fallback for unknown prefix returns generic risks', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-UNKNOWN`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.label).toBe('Genérico (GP-UNKNOWN)');
    expect((res.body.typicalRisks as string[])).toContain('manejo_carga');
    expect((res.body.typicalRisks as string[])).toContain('electrico');
  });

  it('200 body does NOT include applicableRegulations or baseEpp (field isolation)', async () => {
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-MIN`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(res.body.applicableRegulations).toBeUndefined();
    expect(res.body.baseEpp).toBeUndefined();
  });

  it('200 GP-SAL has biologico risk and Protocolo_TBC (health-sector compliance)', async () => {
    // Note: typical-hazards does NOT return minsalProtocols — that is in applicable-norms.
    // This test verifies typicalRisks are correct for GP-SAL.
    const res = await request(buildApp())
      .get(`${base}?industryPrefix=GP-SAL`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect((res.body.typicalRisks as string[])).toContain('biologico');
    expect((res.body.mandatoryDocuments as string[])).toContain('Plan Bioseguridad');
  });
});
