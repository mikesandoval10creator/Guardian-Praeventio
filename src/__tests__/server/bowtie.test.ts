// Real-router supertest for src/server/routes/bowtie.ts
// (Plan v3 Fase 1 — 3 pure-compute POST endpoints, 0 Firestore writes).
//
// Route is mounted at /api/sprint-k in server.ts. All three endpoints are
// POST /:projectId/bowtie/<sub-path> behind verifyAuth + validate(zodSchema)
// + guard(assertProjectMember + resolveTenantId). We seed `projects/<id>` in
// fakeFirestore so assertProjectMember passes, then drive every status code:
// 401 (no token), 400 (schema fail), 403 (not a member / project missing),
// 404 (tenant_not_found), 200 (happy path) + pure-compute business branches.

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

import bowtieRouter from '../../server/routes/bowtie.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', bowtieRouter);
  return app;
}

const PROJECT_ID = 'p-bowtie-test';
const CALLER_UID = 'uid-bowtie-member';
const TENANT_ID = 'tenant-abc';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Bowtie Test Project',
    members: [CALLER_UID],
    createdBy: CALLER_UID,
    tenantId: TENANT_ID,
  });
}

// ────────────────────────────────────────────────────────────────────────
// Minimal valid data fixtures
// ────────────────────────────────────────────────────────────────────────

const minBarrierInPlace = {
  id: 'b-prev-1',
  description: 'Barrera preventiva principal',
  type: 'engineering',
  status: 'in_place',
  effectiveness: 0.8,
};

const minBarrierPlanned = {
  id: 'b-prev-2',
  description: 'Barrera preventiva planificada',
  type: 'administrative',
  status: 'planned',
  effectiveness: 0.5,
};

const minBarrierMissing = {
  id: 'b-prev-missing',
  description: 'Barrera faltante',
  type: 'ppe',
  status: 'missing',
  effectiveness: 0.3,
};

const minThreat = {
  id: 'threat-1',
  description: 'Falla de contención de material peligroso',
  preventiveBarriers: [minBarrierInPlace],
};

const minConsequence = {
  id: 'cons-1',
  description: 'Exposición química del trabajador',
  severity: 'high',
  mitigatingBarriers: [
    {
      id: 'b-mit-1',
      description: 'EPP completo',
      type: 'ppe',
      status: 'in_place',
      effectiveness: 0.6,
    },
  ],
};

const minHazardousEvent = {
  id: 'evt-1',
  description: 'Derrame de ácido sulfúrico',
  category: 'quimico',
};

const minBuildBody = {
  diagramId: 'diag-001',
  hazardousEvent: minHazardousEvent,
  threats: [minThreat],
  consequences: [minConsequence],
};

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db!);
});

// ────────────────────────────────────────────────────────────────────────
// 1. POST /:projectId/bowtie/build
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/bowtie/build', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/bowtie/build`;

  it('401 without a token', async () => {
    const res = await request(buildApp()).post(url).send(minBuildBody);
    expect(res.status).toBe(401);
  });

  it('400 when diagramId is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ hazardousEvent: minHazardousEvent, threats: [minThreat], consequences: [minConsequence] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when threats array is empty (zod min 1)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minBuildBody, threats: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when consequences array is empty (zod min 1)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minBuildBody, consequences: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when barrier type is invalid', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minBuildBody,
        threats: [
          {
            ...minThreat,
            preventiveBarriers: [{ ...minBarrierInPlace, type: 'not-a-type' }],
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when barrier status is invalid', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minBuildBody,
        threats: [
          {
            ...minThreat,
            preventiveBarriers: [{ ...minBarrierInPlace, status: 'active' }],
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when effectiveness is out of range (>1)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minBuildBody,
        threats: [
          {
            ...minThreat,
            preventiveBarriers: [{ ...minBarrierInPlace, effectiveness: 1.5 }],
          },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send(minBuildBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when project does not exist', async () => {
    const res = await request(buildApp())
      .post(`/api/sprint-k/nonexistent-proj/bowtie/build`)
      .set('x-test-uid', CALLER_UID)
      .send(minBuildBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when project exists but has no tenantId', async () => {
    H.db!._seed('projects/no-tenant-proj', {
      name: 'No Tenant',
      members: [CALLER_UID],
      createdBy: CALLER_UID,
      // tenantId intentionally absent
    });
    const res = await request(buildApp())
      .post(`/api/sprint-k/no-tenant-proj/bowtie/build`)
      .set('x-test-uid', CALLER_UID)
      .send(minBuildBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 happy path — diagram structure correct', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(minBuildBody);
    expect(res.status).toBe(200);
    const { diagram } = res.body as { diagram: Record<string, unknown> };
    expect(diagram.diagramId).toBe('diag-001');
    expect(diagram.tenantId).toBe(TENANT_ID); // server fills it from Firestore
    expect(diagram.hazardousEvent).toMatchObject({ id: 'evt-1', category: 'quimico' });
    expect(Array.isArray(diagram.threats)).toBe(true);
    expect(Array.isArray(diagram.consequences)).toBe(true);
    expect(typeof diagram.createdAt).toBe('string');
    expect(diagram.metrics).toBeTruthy();
  });

  it('200 server fills tenantId (client cannot override)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minBuildBody, tenantId: 'client-supplied-tenant' }); // should be ignored
    expect(res.status).toBe(200);
    // tenantId in the diagram must come from Firestore, not client input
    expect((res.body.diagram as { tenantId: string }).tenantId).toBe(TENANT_ID);
  });

  it('200 optional now param overrides createdAt timestamp', async () => {
    const nowIso = '2026-01-01T00:00:00.000Z';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minBuildBody, now: nowIso });
    expect(res.status).toBe(200);
    expect((res.body.diagram as { createdAt: string }).createdAt).toBe(nowIso);
  });

  it('200 computes metrics — single in_place barrier counted', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(minBuildBody);
    expect(res.status).toBe(200);
    const metrics = (res.body.diagram as { metrics: Record<string, unknown> }).metrics;
    // 1 preventive (in_place) + 1 mitigating (in_place) = 2 total in_place
    expect(metrics.totalBarriers).toBe(2);
    expect(metrics.barriersInPlace).toBe(2);
    expect(Array.isArray(metrics.unprotectedThreatIds)).toBe(true);
    expect(metrics.unprotectedThreatIds).toHaveLength(0); // threat has in_place barrier
    expect(Array.isArray(metrics.unmitigatedConsequenceIds)).toBe(true);
    expect(metrics.unmitigatedConsequenceIds).toHaveLength(0);
  });

  it('200 unprotected threat detected when no in_place preventive barrier', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minBuildBody,
        threats: [
          {
            id: 'threat-unprotected',
            description: 'Sin barreras activas',
            preventiveBarriers: [minBarrierPlanned], // planned, NOT in_place
          },
        ],
      });
    expect(res.status).toBe(200);
    const metrics = (res.body.diagram as { metrics: Record<string, unknown> }).metrics;
    expect(metrics.unprotectedThreatIds).toContain('threat-unprotected');
  });

  it('200 residualRiskScore=critical when catastrophic unmitigated consequence', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minBuildBody,
        consequences: [
          {
            id: 'cons-catastrophic',
            description: 'Muerte por explosión',
            severity: 'catastrophic',
            mitigatingBarriers: [{ ...minBarrierMissing, id: 'b-mit-missing' }],
          },
        ],
      });
    expect(res.status).toBe(200);
    const metrics = (res.body.diagram as { metrics: Record<string, unknown> }).metrics;
    expect(metrics.residualRiskScore).toBe('critical');
    expect(metrics.unmitigatedConsequenceIds).toContain('cons-catastrophic');
  });

  it('200 residualRiskScore=high with 2+ unprotected threats', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minBuildBody,
        threats: [
          { id: 'thr-a', description: 'Amenaza A', preventiveBarriers: [] },
          { id: 'thr-b', description: 'Amenaza B', preventiveBarriers: [] },
        ],
      });
    expect(res.status).toBe(200);
    const metrics = (res.body.diagram as { metrics: Record<string, unknown> }).metrics;
    expect(metrics.residualRiskScore).toBe('high');
    expect(metrics.unprotectedThreatIds).toContain('thr-a');
    expect(metrics.unprotectedThreatIds).toContain('thr-b');
  });

  it('200 residualRiskScore=low when all barriers in_place with high effectiveness', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minBuildBody,
        threats: [
          {
            id: 'thr-protected',
            description: 'Amenaza protegida',
            preventiveBarriers: [{ ...minBarrierInPlace, effectiveness: 0.9 }],
          },
        ],
        consequences: [
          {
            id: 'cons-mitigated',
            description: 'Consecuencia mitigada',
            severity: 'medium',
            mitigatingBarriers: [{ id: 'b-mit-2', description: 'Mitigación', type: 'engineering', status: 'in_place', effectiveness: 0.9 }],
          },
        ],
      });
    expect(res.status).toBe(200);
    const metrics = (res.body.diagram as { metrics: Record<string, unknown> }).metrics;
    expect(metrics.residualRiskScore).toBe('low');
  });

  it('200 averageEffectiveness computed correctly across in_place barriers', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minBuildBody,
        threats: [
          {
            id: 'thr-1',
            description: 'Amenaza 1',
            preventiveBarriers: [
              { ...minBarrierInPlace, id: 'b-eff-1', effectiveness: 0.6 },
              { id: 'b-eff-2', description: 'Barrera 2', type: 'administrative', status: 'in_place', effectiveness: 0.4 },
            ],
          },
        ],
        consequences: [
          {
            id: 'cons-ok',
            description: 'Consecuencia sin barreras mitigatorias in_place',
            severity: 'low',
            mitigatingBarriers: [{ id: 'b-eff-3', description: 'Planeada', type: 'ppe', status: 'planned', effectiveness: 0.0 }],
          },
        ],
      });
    expect(res.status).toBe(200);
    const metrics = (res.body.diagram as { metrics: Record<string, unknown> }).metrics;
    // Only in_place: 0.6 and 0.4 → average = 0.5
    expect(metrics.barriersInPlace).toBe(2);
    expect(metrics.averageEffectiveness).toBeCloseTo(0.5, 5);
  });

  it('400 engine BowtieValidationError on duplicate barrier ids → route returns 400 with code', async () => {
    // Two barriers with identical id triggers BowtieValidationError('DUPLICATE_ID', ...)
    const dupBarrier = { ...minBarrierInPlace, id: 'same-id' };
    const dupBarrier2 = { ...minBarrierPlanned, id: 'same-id' };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minBuildBody,
        threats: [
          { id: 'thr-dup', description: 'Con dup', preventiveBarriers: [dupBarrier, dupBarrier2] },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DUPLICATE_ID');
  });

  it('400 engine BowtieValidationError on out-of-range effectiveness (post-zod) → 400 with code', async () => {
    // zod allows 0..1, but engine also validates — exercise engine path if zod passes
    // effectiveness=0 is edge-case valid but in_place with 0 effectiveness is allowed by schema
    // Test actual engine error via empty diagramId (bypassing zod min(1) is impossible — so test via
    // the engine's own duplicate-id check on threats vs consequences sharing an id)
    const sharedId = 'shared-cross-id';
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minBuildBody,
        threats: [
          { id: sharedId, description: 'Threat con id compartido', preventiveBarriers: [] },
        ],
        consequences: [
          { id: sharedId, description: 'Consecuencia con mismo id', severity: 'high', mitigatingBarriers: [] },
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DUPLICATE_ID');
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. POST /:projectId/bowtie/list-unprotected-threats
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/bowtie/list-unprotected-threats', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/bowtie/list-unprotected-threats`;

  // Build a valid diagram once to use across tests
  async function buildDiagram(overrides: Record<string, unknown> = {}) {
    const res = await request(buildApp())
      .post(`/api/sprint-k/${PROJECT_ID}/bowtie/build`)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minBuildBody, ...overrides });
    return res.body.diagram as Record<string, unknown>;
  }

  it('401 without a token', async () => {
    const diagram = await buildDiagram();
    const res = await request(buildApp()).post(url).send({ diagram });
    expect(res.status).toBe(401);
  });

  // diagramSchema is z.record(z.string(), z.unknown()) (src/server/routes/bowtie.ts:181),
  // so it requires the diagram to BE an object. Sending {} (no diagram key) is now
  // rejected at validation with 400 instead of slipping through to
  // listUnprotectedThreats() and throwing a TypeError → 500.
  it('400 when diagram key is absent (rejected by validation, not a 500)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const diagram = await buildDiagram();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ diagram });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns empty array when all threats are protected', async () => {
    const diagram = await buildDiagram(); // minBuildBody has in_place barrier
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ diagram });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.threats)).toBe(true);
    expect(res.body.threats).toHaveLength(0);
  });

  it('200 returns unprotected threats when no in_place preventive barrier', async () => {
    const diagram = await buildDiagram({
      threats: [
        { id: 'thr-unprotected', description: 'Sin barreras activas', preventiveBarriers: [] },
      ],
    });
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ diagram });
    expect(res.status).toBe(200);
    expect(res.body.threats).toHaveLength(1);
    expect((res.body.threats as { id: string }[])[0].id).toBe('thr-unprotected');
  });

  it('200 filters correctly — only unprotected in the list', async () => {
    const diagram = await buildDiagram({
      diagramId: 'diag-mixed',
      threats: [
        { id: 'thr-ok', description: 'Protegida', preventiveBarriers: [minBarrierInPlace] },
        { id: 'thr-bare', description: 'Sin barreras', preventiveBarriers: [] },
        { id: 'thr-planned', description: 'Solo planificada', preventiveBarriers: [minBarrierPlanned] },
      ],
    });
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ diagram });
    expect(res.status).toBe(200);
    const ids = (res.body.threats as { id: string }[]).map((t) => t.id);
    expect(ids).not.toContain('thr-ok');
    expect(ids).toContain('thr-bare');
    expect(ids).toContain('thr-planned');
  });

  it('200 correct count matches metrics.unprotectedThreatIds from build', async () => {
    const diagram = await buildDiagram({
      diagramId: 'diag-counts',
      threats: [
        { id: 'thr-a', description: 'A', preventiveBarriers: [] },
        { id: 'thr-b', description: 'B', preventiveBarriers: [] },
        { id: 'thr-c', description: 'C', preventiveBarriers: [minBarrierInPlace] },
      ],
    });
    const metrics = (diagram as { metrics: { unprotectedThreatIds: string[] } }).metrics;
    expect(metrics.unprotectedThreatIds).toHaveLength(2);

    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ diagram });
    expect(res.status).toBe(200);
    expect(res.body.threats).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. POST /:projectId/bowtie/recommend-next-barrier
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/bowtie/recommend-next-barrier', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/bowtie/recommend-next-barrier`;

  it('401 without a token', async () => {
    const res = await request(buildApp())
      .post(url)
      .send({ threat: minThreat });
    expect(res.status).toBe(401);
  });

  it('400 when threat is missing from body', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when threat.id is missing', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ threat: { description: 'Sin id', preventiveBarriers: [] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when preventiveBarriers item has invalid type', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        threat: {
          id: 'thr-bad',
          description: 'Barrera inválida',
          preventiveBarriers: [{ ...minBarrierInPlace, type: 'bad-type' }],
        },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger-uid')
      .send({ threat: minThreat });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 threat with no barriers → recommends elimination (highest hierarchy)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        threat: {
          id: 'thr-empty',
          description: 'Sin ninguna barrera',
          preventiveBarriers: [],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.barrierType).toBe('elimination');
  });

  it('200 threat already has elimination → recommends substitution', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        threat: {
          id: 'thr-elim',
          description: 'Con eliminación',
          preventiveBarriers: [{ ...minBarrierInPlace, id: 'b-elim', type: 'elimination' }],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.barrierType).toBe('substitution');
  });

  it('200 threat has elimination+substitution → recommends engineering', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        threat: {
          id: 'thr-elim-sub',
          description: 'Con dos barreras superiores',
          preventiveBarriers: [
            { ...minBarrierInPlace, id: 'b-elim2', type: 'elimination' },
            { ...minBarrierPlanned, id: 'b-sub', type: 'substitution' },
          ],
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.barrierType).toBe('engineering');
  });

  it('200 threat has all 5 types → falls back to administrative (engine default)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        threat: {
          id: 'thr-full',
          description: 'Con todos los tipos cubiertos',
          preventiveBarriers: [
            { ...minBarrierInPlace, id: 'b-elim3', type: 'elimination' },
            { ...minBarrierInPlace, id: 'b-sub2', type: 'substitution' },
            { ...minBarrierInPlace, id: 'b-eng', type: 'engineering' },
            { ...minBarrierInPlace, id: 'b-adm', type: 'administrative' },
            { ...minBarrierInPlace, id: 'b-ppe', type: 'ppe' },
          ],
        },
      });
    expect(res.status).toBe(200);
    // engine returns 'administrative' as default when all types are present
    expect(res.body.barrierType).toBe('administrative');
  });

  it('200 threat with only ppe → recommends elimination (next missing from top)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        threat: {
          id: 'thr-ppe-only',
          description: 'Solo EPP instalado',
          preventiveBarriers: [{ ...minBarrierInPlace, id: 'b-ppe2', type: 'ppe' }],
        },
      });
    expect(res.status).toBe(200);
    // 'ppe' is present but 'elimination' is not → recommends 'elimination' (first missing)
    expect(res.body.barrierType).toBe('elimination');
  });

  it('200 barrierType is one of the 5 valid types', async () => {
    const validTypes = ['elimination', 'substitution', 'engineering', 'administrative', 'ppe'];
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ threat: minThreat });
    expect(res.status).toBe(200);
    expect(validTypes).toContain(res.body.barrierType);
  });
});
