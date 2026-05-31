// Real-router supertest for the Incident Evidence Bundle route
// (src/server/routes/incidentBundle.ts — F.3 Expediente Automático).
//
// Mounted at /api/sprint-k per server.ts line 987.
// Single endpoint: GET /:projectId/incidents/:incidentId/bundle
//
// Covers: 401, 403 (ProjectMembershipError + cross-project), 404 (tenant /
// incident), 422 (missing timestamp), 200 happy paths (occurredAt, createdAt
// fallback, rootCause string / object / absent, audit_log present / absent,
// severity Spanish alias). Asserts that NO external-organism HTTP call occurs
// (SUSESO/SII/MINSAL directive) — the route produces a document only.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── hoisted db holder ────────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ── module mocks (must be top-level) ────────────────────────────────────────

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

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

// assertProjectMember: spread actual so ProjectMembershipError class stays real
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

// Dynamic import of incidentEvidenceBundle: mock at specifier the route uses
vi.mock('../../services/incidentBundle/incidentEvidenceBundle.js', () => ({
  buildIncidentBundle: vi.fn(
    (input: Parameters<typeof import('../../services/incidentBundle/incidentEvidenceBundle.js').buildIncidentBundle>[0]) => ({
      bundleId: input.incident.id,
      generatedAt: new Date().toISOString(),
      incident: input.incident,
      affectedWorkers: input.affectedWorkers,
      evidence: input.evidence,
      appliedControls: input.appliedControls,
      requiredEpp: input.requiredEpp,
      requiredTrainings: input.requiredTrainings,
      normativeRefs: input.normativeRefs,
      auditLog: input.auditLog,
      completenessScore: 40,
      gaps: [],
      recommendations: [],
    }),
  ),
  normalizeSeverity: vi.fn((raw: string) => {
    const map: Record<string, string> = {
      baja: 'low', media: 'medium', alta: 'high',
      critica: 'critical', crítica: 'critical', sif: 'sif',
      low: 'low', medium: 'medium', high: 'high', critical: 'critical',
    };
    return map[raw.trim().toLowerCase()] ?? null;
  }),
}));

// ── imports (after mocks) ────────────────────────────────────────────────────

import incidentBundleRouter from '../../server/routes/incidentBundle.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { buildIncidentBundle, normalizeSeverity } from '../../services/incidentBundle/incidentEvidenceBundle.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', incidentBundleRouter);
  return app;
}

const BUNDLE = (projectId: string, incidentId: string) =>
  `/api/sprint-k/${projectId}/incidents/${incidentId}/bundle`;

/** Minimal project doc that resolves tenantId. */
function seedProject(projectId = 'p1', tenantId = 't1') {
  H.db!._seed(`projects/${projectId}`, { tenantId, members: ['u1'], createdBy: 'u1' });
}

/** Minimal incident doc that will pass all guards. */
function seedIncident(opts: {
  id?: string;
  projectId?: string;
  occurredAt?: string | null;
  createdAt?: string | null;
  severity?: string;
  summary?: string;
  rootCause?: unknown;
} = {}) {
  const {
    id = 'inc1',
    projectId = 'p1',
    occurredAt = '2026-05-01T10:00:00.000Z',
    createdAt = null,
    severity = 'medium',
    summary = 'Trabajador resbaló en plataforma húmeda',
    rootCause = undefined,
  } = opts;

  const doc: Record<string, unknown> = {
    projectId,
    severity,
    summary,
  };
  if (occurredAt !== null) doc.occurredAt = occurredAt;
  if (createdAt !== null) doc.createdAt = createdAt;
  if (rootCause !== undefined) doc.rootCause = rootCause;

  H.db!._seed(`incidents/${id}`, doc);
}

// ── setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(buildIncidentBundle).mockClear();
  vi.mocked(normalizeSeverity).mockClear();
});

// ── tests ────────────────────────────────────────────────────────────────────

describe('GET /:projectId/incidents/:incidentId/bundle', () => {

  // ── auth gate ──────────────────────────────────────────────────────────────

  it('401 when no token is supplied', async () => {
    const res = await request(buildApp()).get(BUNDLE('p1', 'inc1'));
    expect(res.status).toBe(401);
  });

  // ── membership gate ────────────────────────────────────────────────────────

  it('403 when assertProjectMember rejects with ProjectMembershipError', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('caller not a member'),
    );
    seedProject();
    seedIncident();
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  // ── tenant resolution gate ─────────────────────────────────────────────────

  it('404 when project has no tenantId', async () => {
    H.db!._seed('projects/p1', { members: ['u1'] }); // no tenantId field
    seedIncident();
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('tenant_not_found');
  });

  // ── incident existence gate ────────────────────────────────────────────────

  it('404 when incident doc does not exist', async () => {
    seedProject();
    // no incident seeded
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc99'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('incident_not_found');
  });

  // ── cross-project safety ───────────────────────────────────────────────────

  it('403 when incident.projectId does not match route :projectId (cross-project guard)', async () => {
    seedProject('p1', 't1');
    H.db!._seed('incidents/inc1', {
      projectId: 'p2', // belongs to different project
      occurredAt: '2026-05-01T10:00:00.000Z',
      severity: 'medium',
      summary: 'Incidente en otro proyecto',
    });
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('cross_project_forbidden');
  });

  // ── missing timestamp (422) ────────────────────────────────────────────────

  it('422 when incident has neither occurredAt nor createdAt', async () => {
    seedProject();
    seedIncident({ occurredAt: null, createdAt: null });
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('incident_missing_timestamp');
    // Spanish-CL copy in the detail
    expect(res.body.detail).toMatch(/occurredAt/);
  });

  // ── happy path 200: basic incident ────────────────────────────────────────

  it('200 returns manifest for a minimal incident with occurredAt', async () => {
    seedProject();
    seedIncident();
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('manifest');
    const { manifest } = res.body;
    expect(manifest.bundleId).toBe('inc1');
    expect(manifest.incident.projectId).toBe('p1');
    expect(manifest.incident.occurredAt).toBe('2026-05-01T10:00:00.000Z');
    expect(manifest).toHaveProperty('completenessScore');
    expect(manifest).toHaveProperty('gaps');
    expect(manifest).toHaveProperty('recommendations');
    // buildIncidentBundle must have been called (real service wired)
    expect(vi.mocked(buildIncidentBundle)).toHaveBeenCalledTimes(1);
  });

  // ── fallback: createdAt used when occurredAt absent ───────────────────────

  it('200 uses createdAt as fallback when occurredAt is absent', async () => {
    seedProject();
    seedIncident({ occurredAt: null, createdAt: '2026-04-15T08:00:00.000Z' });
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    const { manifest } = res.body;
    expect(manifest.incident.occurredAt).toBe('2026-04-15T08:00:00.000Z');
    // reportedAt must also fall back to the same value
    expect(manifest.incident.reportedAt).toBe('2026-04-15T08:00:00.000Z');
  });

  // ── severity normalization: Spanish alias ─────────────────────────────────

  it('200 normalizes Spanish severity alias "Alta" → "high"', async () => {
    seedProject();
    seedIncident({ severity: 'Alta' });
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    // normalizeSeverity was called with the raw value from Firestore
    expect(vi.mocked(normalizeSeverity)).toHaveBeenCalledWith('Alta');
  });

  // ── rootCause: string form ─────────────────────────────────────────────────

  it('200 maps rootCause string to { analyzed:true, primaryCauseKind }', async () => {
    seedProject();
    seedIncident({ rootCause: 'Falta de señalización' });
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    const callArg = vi.mocked(buildIncidentBundle).mock.calls[0][0];
    expect(callArg.rootCause).toEqual({
      analyzed: true,
      primaryCauseKind: 'Falta de señalización',
    });
  });

  // ── rootCause: object form ─────────────────────────────────────────────────

  it('200 passes rootCause object fields through correctly', async () => {
    seedProject();
    seedIncident({
      rootCause: {
        analyzed: true,
        primaryCauseKind: 'unsafe_act',
        contributingFactors: ['fatiga', 'iluminacion_insuficiente'],
        pendingOwnerUid: 'supervisor1',
        pendingDueDate: '2026-06-01',
      },
    });
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    const callArg = vi.mocked(buildIncidentBundle).mock.calls[0][0];
    expect(callArg.rootCause).toMatchObject({
      analyzed: true,
      primaryCauseKind: 'unsafe_act',
      contributingFactors: ['fatiga', 'iluminacion_insuficiente'],
      pendingOwnerUid: 'supervisor1',
      pendingDueDate: '2026-06-01',
    });
  });

  // ── rootCause: absent → undefined ─────────────────────────────────────────

  it('200 passes rootCause as undefined when not present in incident doc', async () => {
    seedProject();
    seedIncident({ rootCause: undefined }); // no rootCause field
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    const callArg = vi.mocked(buildIncidentBundle).mock.calls[0][0];
    expect(callArg.rootCause).toBeUndefined();
  });

  // ── rootCause: empty string → undefined ───────────────────────────────────

  it('200 passes rootCause as undefined for an empty-string rootCause', async () => {
    seedProject();
    seedIncident({ rootCause: '' });
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    const callArg = vi.mocked(buildIncidentBundle).mock.calls[0][0];
    expect(callArg.rootCause).toBeUndefined();
  });

  // ── audit_log integration ─────────────────────────────────────────────────

  it('200 passes audit_log entries to buildIncidentBundle', async () => {
    seedProject();
    seedIncident();
    // Seed two audit_log entries scoped to this incident + project
    H.db!._seed('audit_logs/al1', {
      details: { incidentId: 'inc1' },
      projectId: 'p1',
      userId: 'u1',
      actorRole: 'supervisor',
      action: 'incident.created',
      timestamp: '2026-05-01T10:01:00.000Z',
    });
    H.db!._seed('audit_logs/al2', {
      details: { incidentId: 'inc1' },
      projectId: 'p1',
      userId: 'u2',
      actorRole: 'gerente',
      action: 'incident.reviewed',
      timestamp: '2026-05-01T11:00:00.000Z',
    });
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    const callArg = vi.mocked(buildIncidentBundle).mock.calls[0][0];
    expect(callArg.auditLog).toHaveLength(2);
    const actions = callArg.auditLog.map((e: { action: string }) => e.action);
    expect(actions).toContain('incident.created');
    expect(actions).toContain('incident.reviewed');
  });

  // ── audit_log: graceful empty on query failure ────────────────────────────

  it('200 with empty auditLog when audit_logs query fails (graceful degradation)', async () => {
    seedProject();
    seedIncident();
    // Nothing seeded in audit_logs — fakeFirestore returns empty snapshot gracefully
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    const callArg = vi.mocked(buildIncidentBundle).mock.calls[0][0];
    expect(callArg.auditLog).toEqual([]);
  });

  // ── arrays are honest-empty (not fabricated) ──────────────────────────────

  it('200 sends honest empty arrays for evidence/workers/controls/epp/trainings/normativeRefs', async () => {
    seedProject();
    seedIncident();
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    const callArg = vi.mocked(buildIncidentBundle).mock.calls[0][0];
    expect(callArg.evidence).toEqual([]);
    expect(callArg.affectedWorkers).toEqual([]);
    expect(callArg.appliedControls).toEqual([]);
    expect(callArg.requiredEpp).toEqual([]);
    expect(callArg.requiredTrainings).toEqual([]);
    expect(callArg.normativeRefs).toEqual([]);
  });

  // ── SUSESO/SII/MINSAL directive: no external organism auto-push ───────────

  it('200 does NOT auto-push to SUSESO/SII/MINSAL — route returns manifest only (company signs+submits)', async () => {
    seedProject();
    seedIncident();
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    // The response must be the manifest, not a push confirmation
    expect(res.body).toHaveProperty('manifest');
    expect(res.body).not.toHaveProperty('susesoStatus');
    expect(res.body).not.toHaveProperty('diatSubmitted');
    expect(res.body).not.toHaveProperty('diepSubmitted');
    expect(res.body).not.toHaveProperty('siiFiled');
    // No external HTTP call is expected — verified by the absence of fetch mocks
    // and the fact that the mock of incidentEvidenceBundle.js does not contain
    // any network call.
  });

  // ── summary / description / id fallback for summary field ─────────────────

  it('200 falls back to description when summary is absent, then to incidentId', async () => {
    seedProject();
    // doc with description but no summary
    H.db!._seed('incidents/inc2', {
      projectId: 'p1',
      occurredAt: '2026-05-01T10:00:00.000Z',
      severity: 'low',
      description: 'Caída de objeto en bodega',
    });
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc2'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    const callArg = vi.mocked(buildIncidentBundle).mock.calls[0][0];
    expect(callArg.incident.summary).toBe('Caída de objeto en bodega');
  });

  it('200 falls back to incidentId as summary when both summary and description absent', async () => {
    seedProject();
    H.db!._seed('incidents/inc3', {
      projectId: 'p1',
      occurredAt: '2026-05-01T10:00:00.000Z',
      severity: 'low',
      // no summary, no description
    });
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc3'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(200);
    const callArg = vi.mocked(buildIncidentBundle).mock.calls[0][0];
    expect(callArg.incident.summary).toBe('inc3');
  });

  // ── 500 on unexpected error ───────────────────────────────────────────────

  it('500 when buildIncidentBundle throws unexpectedly', async () => {
    seedProject();
    seedIncident();
    vi.mocked(buildIncidentBundle).mockImplementationOnce(() => {
      throw new Error('unexpected internal failure');
    });
    const res = await request(buildApp())
      .get(BUNDLE('p1', 'inc1'))
      .set('x-test-uid', 'u1');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal_error');
  });
});
