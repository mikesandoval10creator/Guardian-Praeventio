// Real-router supertest for src/server/routes/residualRisk.ts
// (Plan v3 Fase 1 — 4 endpoints, Firestore reads+writes, role-gated accept).
//
// Mounted at /api/sprint-k in server.ts. Endpoints:
//   GET  /:projectId/residual-risk/suspicious   → list isSuspicious==true
//   GET  /:projectId/residual-risk              → list top-200 ordered by createdAt desc
//   POST /:projectId/residual-risk              → create with engine calc + suspicion heuristic
//   POST /:projectId/residual-risk/:id/accept   → role-gated formal acceptance

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
      role: req.header('x-test-role') ?? undefined,
      roles: req.header('x-test-roles') ? req.header('x-test-roles')!.split(',') : [],
      admin: req.header('x-test-admin') === 'true',
      tenantId: req.header('x-test-tenant') ?? undefined,
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

import residualRiskRouter from '../../server/routes/residualRisk.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', residualRiskRouter);
  return app;
}

const PROJECT_ID = 'p-rr-test';
const TENANT_ID = 'tenant-rr';
const CALLER_UID = 'uid-rr-member';

function seedProject(db: NonNullable<typeof H.db>) {
  db._seed(`projects/${PROJECT_ID}`, {
    name: 'Test RR Project',
    tenantId: TENANT_ID,
    members: [CALLER_UID],
    createdBy: CALLER_UID,
  });
}

/** Minimal valid body for POST /residual-risk */
const minCreateBody = {
  id: 'rr-test-001',
  hazard: 'Caída desde altura en faena',
  category: 'altura',
  riskKind: 'physical' as const,
  likelihood: 'possible' as const,
  inherentSeverity: 'major' as const,
  residualSeverity: 'minor' as const,
  currentControls: [
    { controlId: 'ctrl-001', effectiveness: 'significant' as const },
    { controlId: 'ctrl-002', effectiveness: 'full' as const },
  ],
  justification: 'Barandas + línea de vida instaladas y verificadas mensualmente',
};

/** Collection path under the tenant for a given project */
function riskColPath(projectId = PROJECT_ID) {
  return `tenants/${TENANT_ID}/projects/${projectId}/residual_risks`;
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedProject(H.db);
});

// ────────────────────────────────────────────────────────────────────────────
// GET /:projectId/residual-risk/suspicious
// ────────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/residual-risk/suspicious', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/residual-risk/suspicious`;

  it('401 when no token is provided', async () => {
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
      .get(`/api/sprint-k/nonexistent-proj/residual-risk/suspicious`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('404 when project has no tenantId', async () => {
    H.db!._seed(`projects/no-tenant-proj`, {
      members: [CALLER_UID],
      createdBy: CALLER_UID,
      // no tenantId field
    });
    const res = await request(buildApp())
      .get(`/api/sprint-k/no-tenant-proj/residual-risk/suspicious`)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  it('200 returns empty array when no suspicious risks exist', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.risks)).toBe(true);
    expect(res.body.risks).toHaveLength(0);
  });

  it('200 returns only isSuspicious==true docs', async () => {
    H.db!._seed(`${riskColPath()}/rr-sus-001`, {
      hazard: 'Riesgo sospechoso',
      isSuspicious: true,
      suspiciousReason: 'drop grande sin controles',
      createdAt: '2026-01-10T00:00:00.000Z',
    });
    H.db!._seed(`${riskColPath()}/rr-ok-002`, {
      hazard: 'Riesgo normal',
      isSuspicious: false,
      suspiciousReason: null,
      createdAt: '2026-01-11T00:00:00.000Z',
    });
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { risks } = res.body as { risks: { isSuspicious: boolean; id: string }[] };
    expect(risks).toHaveLength(1);
    expect(risks[0].isSuspicious).toBe(true);
    expect(risks[0].id).toBe('rr-sus-001');
  });

  it('500 when the Firestore read fails — does NOT mask as an empty list (B2)', async () => {
    // Regresión: antes safeRead tragaba el error y devolvía [] → la UI mostraba
    // "sin riesgos sospechosos" cuando la lectura realmente falló.
    H.db!._failReads('residual_risks');
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(500);
    expect(res.body.risks).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /:projectId/residual-risk
// ────────────────────────────────────────────────────────────────────────────

describe('GET /:projectId/residual-risk', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/residual-risk`;

  it('401 when no token is provided', async () => {
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', 'outsider-uid');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 returns empty array when no risks exist', async () => {
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.risks)).toBe(true);
    expect(res.body.risks).toHaveLength(0);
  });

  it('500 when the Firestore read fails — does NOT mask as an empty list (B2)', async () => {
    H.db!._failReads('residual_risks');
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(500);
    expect(res.body.risks).toBeUndefined();
  });

  it('200 returns risks ordered by createdAt desc (newest first)', async () => {
    H.db!._seed(`${riskColPath()}/rr-older`, {
      hazard: 'Riesgo antiguo',
      createdAt: '2026-01-05T00:00:00.000Z',
      isSuspicious: false,
    });
    H.db!._seed(`${riskColPath()}/rr-newer`, {
      hazard: 'Riesgo reciente',
      createdAt: '2026-01-20T00:00:00.000Z',
      isSuspicious: false,
    });
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { risks } = res.body as { risks: { id: string; createdAt: string }[] };
    expect(risks).toHaveLength(2);
    // Newest must come first (desc ordering)
    expect(risks[0].id).toBe('rr-newer');
    expect(risks[1].id).toBe('rr-older');
  });

  it('200 includes all stored fields including id', async () => {
    H.db!._seed(`${riskColPath()}/rr-full`, {
      hazard: 'Riesgo completo',
      category: 'altura',
      riskKind: 'physical',
      isSuspicious: false,
      suspiciousReason: null,
      createdAt: '2026-02-01T00:00:00.000Z',
      createdBy: CALLER_UID,
    });
    const res = await request(buildApp())
      .get(url)
      .set('x-test-uid', CALLER_UID);
    expect(res.status).toBe(200);
    const { risks } = res.body as { risks: { id: string; hazard: string; createdBy: string }[] };
    expect(risks).toHaveLength(1);
    expect(risks[0].id).toBe('rr-full');
    expect(risks[0].hazard).toBe('Riesgo completo');
    expect(risks[0].createdBy).toBe(CALLER_UID);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:projectId/residual-risk  (create)
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/residual-risk', () => {
  const url = `/api/sprint-k/${PROJECT_ID}/residual-risk`;

  it('401 when no token is provided', async () => {
    const res = await request(buildApp()).post(url).send(minCreateBody);
    expect(res.status).toBe(401);
  });

  it('400 when hazard is missing', async () => {
    const { hazard: _omit, ...noHazard } = minCreateBody;
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(noHazard);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when riskKind is invalid', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minCreateBody, riskKind: 'imaginary' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when likelihood is invalid', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({ ...minCreateBody, likelihood: 'always' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when currentControls item is missing effectiveness', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send({
        ...minCreateBody,
        currentControls: [{ controlId: 'ctrl-x' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'outsider-uid')
      .send(minCreateBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('201 happy path — returns ok:true + risk shape with engine fields', async () => {
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(minCreateBody);
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    const { risk } = res.body as { risk: Record<string, unknown> };
    // Identity fields
    expect(risk.id).toBe(minCreateBody.id);
    expect(risk.hazard).toBe(minCreateBody.hazard);
    expect(risk.category).toBe(minCreateBody.category);
    expect(risk.riskKind).toBe(minCreateBody.riskKind);
    expect(risk.createdBy).toBe(CALLER_UID);
    // Engine-derived fields must be numbers
    expect(typeof risk.initialScore).toBe('number');
    expect(typeof risk.controlReduction).toBe('number');
    expect(typeof risk.residualScore).toBe('number');
    expect(risk.residualScore).toBeGreaterThanOrEqual(1);
    // Level fields
    expect(['low', 'medium', 'high', 'extreme']).toContain(risk.initialLevel);
    expect(['low', 'medium', 'high', 'extreme']).toContain(risk.residualLevel);
    // Acceptance initialised as pending
    const acceptance = risk.acceptance as Record<string, unknown>;
    expect(acceptance.status).toBe('pending');
    expect(acceptance.signedByUid).toBeNull();
    expect(acceptance.signedAt).toBeNull();
    expect(acceptance.reason).toBeNull();
    // isSuspicious is boolean
    expect(typeof risk.isSuspicious).toBe('boolean');
  });

  it('201 persists risk to Firestore — readable back via H.db', async () => {
    await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(minCreateBody);
    const stored = H.db!._dump()[`${riskColPath()}/${minCreateBody.id}`];
    expect(stored).toBeDefined();
    expect(stored.hazard).toBe(minCreateBody.hazard);
    expect(stored.createdBy).toBe(CALLER_UID);
    expect(typeof stored.residualScore).toBe('number');
  });

  it('201 suspicious flag is true when catastrophic drops to negligible with weak controls', async () => {
    const suspiciousBody = {
      ...minCreateBody,
      id: 'rr-sus-weak',
      inherentSeverity: 'catastrophic' as const,
      residualSeverity: 'negligible' as const,
      currentControls: [{ controlId: 'weak-ctrl', effectiveness: 'minimal' as const }],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(suspiciousBody);
    expect(res.status).toBe(201);
    const { risk } = res.body as { risk: Record<string, unknown> };
    expect(risk.isSuspicious).toBe(true);
    expect(typeof risk.suspiciousReason).toBe('string');
    expect(risk.suspiciousReason).not.toBeNull();
  });

  it('201 isSuspicious is false when inherent and residual are equal', async () => {
    const normalBody = {
      ...minCreateBody,
      id: 'rr-normal-001',
      inherentSeverity: 'moderate' as const,
      residualSeverity: 'moderate' as const,
      currentControls: [],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(normalBody);
    expect(res.status).toBe(201);
    const { risk } = res.body as { risk: Record<string, unknown> };
    expect(risk.isSuspicious).toBe(false);
    expect(risk.suspiciousReason).toBeNull();
  });

  it('201 requiresFormalAcceptance is true when residual level is high or extreme', async () => {
    // catastrophic + likely with no controls → score=20, level=extreme
    const highRiskBody = {
      ...minCreateBody,
      id: 'rr-high-001',
      likelihood: 'likely' as const,
      residualSeverity: 'catastrophic' as const,
      currentControls: [],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(highRiskBody);
    expect(res.status).toBe(201);
    const { risk } = res.body as { risk: Record<string, unknown> };
    expect(risk.requiresFormalAcceptance).toBe(true);
  });

  it('201 requiresFormalAcceptance is false when residual level is low', async () => {
    // negligible + rare with no controls → score=1, level=low
    const lowRiskBody = {
      ...minCreateBody,
      id: 'rr-low-001',
      likelihood: 'rare' as const,
      inherentSeverity: 'negligible' as const,
      residualSeverity: 'negligible' as const,
      currentControls: [],
    };
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .send(lowRiskBody);
    expect(res.status).toBe(201);
    const { risk } = res.body as { risk: Record<string, unknown> };
    expect(risk.requiresFormalAcceptance).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:projectId/residual-risk/:id/accept
// ────────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/residual-risk/:id/accept', () => {
  const RISK_ID = 'rr-to-accept';
  const url = `/api/sprint-k/${PROJECT_ID}/residual-risk/${RISK_ID}/accept`;
  const validBody = { reason: 'Aceptado por gerencia tras revisión de controles implementados' };

  function seedRisk() {
    H.db!._seed(`${riskColPath()}/${RISK_ID}`, {
      hazard: 'Riesgo pendiente de aceptación',
      acceptance: { status: 'pending', signedByUid: null, signedAt: null, reason: null },
      createdAt: '2026-02-01T00:00:00.000Z',
      createdBy: CALLER_UID,
      isSuspicious: false,
    });
  }

  it('401 when no token is provided', async () => {
    seedRisk();
    const res = await request(buildApp()).post(url).send(validBody);
    expect(res.status).toBe(401);
  });

  it('400 when reason is missing', async () => {
    seedRisk();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when reason is too short', async () => {
    seedRisk();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send({ reason: 'ok' }); // min length is 3, 'ok' is 2 chars
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a project member', async () => {
    seedRisk();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', 'stranger')
      .set('x-test-role', 'admin')
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when caller is a member but lacks acceptor role', async () => {
    seedRisk();
    // A plain member without admin/gerente role
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      // no x-test-role set → role=undefined
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    expect((res.body as { reason: string }).reason).toBe('caller_lacks_residual_risk_acceptor_role');
  });

  it('403 when caller has a non-acceptor role (operario)', async () => {
    seedRisk();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'operario')
      .send(validBody);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
    expect((res.body as { reason: string }).reason).toBe('caller_lacks_residual_risk_acceptor_role');
  });

  it('404 when risk document does not exist', async () => {
    // Do NOT seed the risk
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('residual_risk_not_found');
  });

  it('200 happy path — admin role can accept', async () => {
    seedRisk();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 happy path — gerente role can accept', async () => {
    seedRisk();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'gerente')
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 admin:true flag grants acceptance regardless of role string', async () => {
    seedRisk();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-admin', 'true')
      // no role header
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 persists acceptance.status=accepted with signedByUid + signedAt + reason', async () => {
    seedRisk();
    await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-role', 'admin')
      .send(validBody);

    const stored = H.db!._dump()[`${riskColPath()}/${RISK_ID}`];
    expect(stored).toBeDefined();
    const acceptance = stored.acceptance as Record<string, unknown>;
    expect(acceptance.status).toBe('accepted');
    expect(acceptance.signedByUid).toBe(CALLER_UID);
    expect(typeof acceptance.signedAt).toBe('string');
    expect(acceptance.reason).toBe(validBody.reason);
  });

  it('200 acceptance via roles array (multi-role user)', async () => {
    seedRisk();
    const res = await request(buildApp())
      .post(url)
      .set('x-test-uid', CALLER_UID)
      .set('x-test-roles', 'inspector,gerente')
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
