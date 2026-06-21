// Real-router supertest for the multi-role-summary endpoints (3 routes, pure
// compute over a caller-supplied snapshot). Mounts the REAL router via
// fakeFirestore and exercises every route:
//   POST /:projectId/role-summary/compose
//   POST /:projectId/role-summary/compose-all
//   POST /:projectId/role-summary/filter-lessons
//
// Only infra is mocked (firebase-admin, verifyAuth, logger, captureRouteError).
// The Zod schemas (validate), the requireTier gate, the membership guard
// (assertProjectMember), and the composer engine (composeRoleSummary /
// composeAllAudiences / filterTransferableLessons) all run UNMOCKED, so the
// 200 paths assert the REAL engine output (re-derived by calling the same
// engine on the same input — NOT by reimplementing the handler) and the 403
// paths exercise the REAL guard reading project membership from Firestore.
//
// Why this matters: these are paid analytics surfaces (tier-gated `platino`)
// that take a projectId, so they MUST gate on assertProjectMember (CLAUDE.md
// #6) — the Admin SDK bypasses firestore.rules, so an un-gated compute over
// another tenant's snapshot would be an IDOR. This test pins that the guard
// runs before compute and that a non-member never reaches the engine. The
// tier gate runs in REPORT-ONLY mode here (TIER_GATE_ENFORCE is unset, so
// `tierGateEnforced()` is false) — that is the real prod-rollout posture and
// is asserted (a sub-platino caller is NOT blocked).

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
vi.mock('../../server/middleware/captureRouteError.js', () => ({ captureRouteError: vi.fn() }));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import roleSummaryRouter from '../../server/routes/multiRoleSummary.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { captureRouteError } from '../../server/middleware/captureRouteError.js';
import {
  composeRoleSummary,
  composeAllAudiences,
  filterTransferableLessons,
  type ProjectSnapshot,
  type SummaryAudience,
  type LessonApplicabilityContext,
} from '../../services/multiRoleSummary/roleSummaryComposer.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', roleSummaryRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };
const composeEp = '/api/sprint-k/p1/role-summary/compose';
const composeAllEp = '/api/sprint-k/p1/role-summary/compose-all';
const filterEp = '/api/sprint-k/p1/role-summary/filter-lessons';

// A valid snapshot the caller pre-aggregates. Covers metrics + highlights so
// the engine has real material to rank and filter per audience.
function snap(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    projectId: 'p1',
    projectName: 'Faena Andina',
    periodFrom: '2026-05-01',
    periodTo: '2026-05-31',
    metrics: {
      sifIncidentsCount: 2,
      trir: 1.4,
      ltifr: 0.9,
      incidentsCount: 7,
      correctiveActionsOpen: 4,
      correctiveActionsClosed: 11,
      complianceScore: 88,
      averageReadinessScore: 75,
      daysSinceLastSif: 30,
      workersWithCompleteEpp: 95,
      inspectionsCompleted: 12,
    },
    highlights: [
      {
        kind: 'concern',
        text: 'Aumento de casi-accidentes en el turno noche.',
        relevantTo: ['prevencionista', 'supervisor', 'cphs'],
      },
      {
        kind: 'achievement',
        text: '30 días sin incidente SIF.',
        relevantTo: ['worker', 'supervisor', 'client_mandante'],
      },
      {
        kind: 'critical_decision',
        text: 'Inversión aprobada en controles de ingeniería.',
        relevantTo: ['executive', 'auditor_external'],
      },
    ],
    transferableLessons: [
      { summary: 'Checklist pre-uso reduce fallas.', applicableTo: 'any' },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(captureRouteError).mockReset();
  H.db = createFakeFirestore();
  // u1 is a member of p1 (members[]). Real assertProjectMember reads this.
  // requireTier (report-only) also reads users/{uid}; no plan doc → resolves
  // to `free`, which would block under platino IF enforced — but enforce is
  // off, so the request proceeds. That report-only behavior is asserted below.
  H.db._seed('projects/p1', { tenantId: 't1', members: ['u1'] });
});

// ──────────────────────────────────────────────────────────────────────────
// POST /:projectId/role-summary/compose
// ──────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/role-summary/compose', () => {
  it('401 without a token (verifyAuth)', async () => {
    const res = await request(buildApp())
      .post(composeEp)
      .send({ snapshot: snap(), audience: 'prevencionista' });
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a member of the project (real guard, no IDOR)', async () => {
    // u2 is neither in members[] nor createdBy → real assertProjectMember throws.
    const res = await request(buildApp())
      .post(composeEp)
      .set({ 'x-test-uid': 'u2' })
      .send({ snapshot: snap(), audience: 'prevencionista' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist (guard denies before compute)', async () => {
    H.db!._store.delete('projects/p1');
    const res = await request(buildApp())
      .post(composeEp)
      .set(uid)
      .send({ snapshot: snap(), audience: 'prevencionista' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 invalid_payload when snapshot is missing (real Zod schema)', async () => {
    const res = await request(buildApp())
      .post(composeEp)
      .set(uid)
      .send({ audience: 'prevencionista' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('400 when audience is not in the enum (schema enum)', async () => {
    const res = await request(buildApp())
      .post(composeEp)
      .set(uid)
      .send({ snapshot: snap(), audience: 'ceo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when language is not a supported locale (schema enum)', async () => {
    const res = await request(buildApp())
      .post(composeEp)
      .set(uid)
      .send({ snapshot: snap(), audience: 'worker', language: 'fr-FR' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a metric is negative (schema nonnegative)', async () => {
    const res = await request(buildApp())
      .post(composeEp)
      .set(uid)
      .send({
        snapshot: snap({ metrics: { incidentsCount: -1 } }),
        audience: 'prevencionista',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a highlight has an empty relevantTo array (schema .min(1))', async () => {
    const res = await request(buildApp())
      .post(composeEp)
      .set(uid)
      .send({
        snapshot: snap({
          highlights: [{ kind: 'concern', text: 'x', relevantTo: [] as SummaryAudience[] }],
        }),
        audience: 'prevencionista',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns the REAL engine summary for the requested audience', async () => {
    const snapshot = snap();
    const res = await request(buildApp())
      .post(composeEp)
      .set(uid)
      .send({ snapshot, audience: 'prevencionista' });
    expect(res.status).toBe(200);
    // Re-derive from the REAL engine on the same input (not a reimplementation).
    const expected = composeRoleSummary(snapshot, 'prevencionista');
    expect(res.body.summary).toEqual(expected);
    // Spot-check the real shape so an empty/echoing handler can't pass.
    expect(res.body.summary.audience).toBe('prevencionista');
    expect(res.body.summary.language).toBe('es-CL'); // default applied by engine
    // prevencionista sees the night-shift CONCERN (relevantTo includes it) but
    // NOT the executive-only critical_decision highlight.
    expect(res.body.summary.bullets).toContain(
      'Aumento de casi-accidentes en el turno noche.',
    );
    expect(res.body.summary.bullets).not.toContain(
      'Inversión aprobada en controles de ingeniería.',
    );
    // Headline = first prioritized metric present → sifIncidentsCount = 2.
    expect(res.body.summary.headlineMetric).toEqual({
      label: 'Incidentes SIF',
      value: '2',
    });
    expect(captureRouteError).not.toHaveBeenCalled();
  });

  it('200 honors the language override (engine i18n)', async () => {
    const snapshot = snap();
    const res = await request(buildApp())
      .post(composeEp)
      .set(uid)
      .send({ snapshot, audience: 'worker', language: 'en-US' });
    expect(res.status).toBe(200);
    const expected = composeRoleSummary(snapshot, 'worker', 'en-US');
    expect(res.body.summary).toEqual(expected);
    expect(res.body.summary.language).toBe('en-US');
    expect(res.body.summary.title).toContain('Summary —');
  });

  it('200 even for a sub-platino caller (tier gate is REPORT-ONLY here)', async () => {
    // No subscription doc for u1 → plan resolves to `free`, below `platino`.
    // Because TIER_GATE_ENFORCE is unset, requireTier logs would-block and
    // calls next() rather than 402. Pin that real rollout posture.
    const res = await request(buildApp())
      .post(composeEp)
      .set(uid)
      .send({ snapshot: snap(), audience: 'executive' });
    expect(res.status).toBe(200);
    expect(res.body.summary.audience).toBe('executive');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// POST /:projectId/role-summary/compose-all
// ──────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/role-summary/compose-all', () => {
  it('401 without a token (verifyAuth)', async () => {
    const res = await request(buildApp()).post(composeAllEp).send({ snapshot: snap() });
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a member (real guard)', async () => {
    const res = await request(buildApp())
      .post(composeAllEp)
      .set({ 'x-test-uid': 'u2' })
      .send({ snapshot: snap() });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 invalid_payload when snapshot is missing (real Zod schema)', async () => {
    const res = await request(buildApp()).post(composeAllEp).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it('400 when projectName exceeds max length (schema .max)', async () => {
    const res = await request(buildApp())
      .post(composeAllEp)
      .set(uid)
      .send({ snapshot: snap({ projectName: 'x'.repeat(201) }) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns a summary for EACH of the 8 audiences (real engine)', async () => {
    const snapshot = snap();
    const res = await request(buildApp())
      .post(composeAllEp)
      .set(uid)
      .send({ snapshot, language: 'es-CL' });
    expect(res.status).toBe(200);
    const expected = composeAllAudiences(snapshot, 'es-CL');
    expect(res.body.summaries).toEqual(expected);
    // All 8 audiences present and keyed by their own audience.
    const audiences: SummaryAudience[] = [
      'worker',
      'supervisor',
      'prevencionista',
      'executive',
      'client_mandante',
      'mutuality',
      'cphs',
      'auditor_external',
    ];
    expect(Object.keys(res.body.summaries).sort()).toEqual([...audiences].sort());
    for (const a of audiences) {
      expect(res.body.summaries[a].audience).toBe(a);
    }
    // Audience-specific filtering really happened: the worker (individual tone)
    // sees the achievement but not the prevencionista-only concern.
    expect(res.body.summaries.worker.bullets).toContain('30 días sin incidente SIF.');
    expect(res.body.summaries.worker.bullets).not.toContain(
      'Aumento de casi-accidentes en el turno noche.',
    );
    expect(captureRouteError).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────
// POST /:projectId/role-summary/filter-lessons
// ──────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/role-summary/filter-lessons', () => {
  const lessons = [
    { summary: 'Bloqueo y etiquetado evita arranques.', applicableTo: 'any' as const },
    {
      summary: 'Rotación de turno reduce fatiga (mismo rubro).',
      applicableTo: 'similar_industry' as const,
    },
    {
      summary: 'Plan de evacuación para faena grande.',
      applicableTo: 'similar_size' as const,
    },
  ];

  it('401 without a token (verifyAuth)', async () => {
    const res = await request(buildApp())
      .post(filterEp)
      .send({ lessons, context: {} });
    expect(res.status).toBe(401);
  });

  it('403 when the caller is not a member (real guard)', async () => {
    const res = await request(buildApp())
      .post(filterEp)
      .set({ 'x-test-uid': 'u2' })
      .send({ lessons, context: {} });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('400 invalid_payload when lessons is empty (schema .min(1))', async () => {
    const res = await request(buildApp())
      .post(filterEp)
      .set(uid)
      .send({ lessons: [], context: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when an applicableTo is not in the enum (schema enum)', async () => {
    const res = await request(buildApp())
      .post(filterEp)
      .set(uid)
      .send({
        lessons: [{ summary: 'x', applicableTo: 'whenever' }],
        context: {},
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when workforceSize is not a valid size (schema enum)', async () => {
    const res = await request(buildApp())
      .post(filterEp)
      .set(uid)
      .send({ lessons, context: { workforceSize: 'gigantic' } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('200 returns only the transferable lessons (real engine filter)', async () => {
    // Context: same industry as the lesson source, but different size → the
    // similar_industry lesson + the `any` lesson pass, similar_size does not.
    const context: LessonApplicabilityContext = {
      industry: 'mineria',
      workforceSize: 'medium',
      source: { industry: 'mineria', workforceSize: 'large' },
    };
    const res = await request(buildApp())
      .post(filterEp)
      .set(uid)
      .send({ lessons, context });
    expect(res.status).toBe(200);
    const expected = filterTransferableLessons(lessons, context);
    expect(res.body.lessons).toEqual(expected);
    // Re-derived expectation: `any` + similar_industry (industries match), but
    // NOT similar_size (medium ≠ large).
    expect(res.body.lessons).toHaveLength(2);
    const summaries = res.body.lessons.map((l: { summary: string }) => l.summary);
    expect(summaries).toContain('Bloqueo y etiquetado evita arranques.');
    expect(summaries).toContain('Rotación de turno reduce fatiga (mismo rubro).');
    expect(summaries).not.toContain('Plan de evacuación para faena grande.');
    expect(captureRouteError).not.toHaveBeenCalled();
  });

  it('200 keeps only `any` lessons when context has no matching attributes', async () => {
    const onlyConditional = [
      { summary: 'Industria.', applicableTo: 'similar_industry' as const },
      { summary: 'Universal.', applicableTo: 'any' as const },
    ];
    const res = await request(buildApp())
      .post(filterEp)
      .set(uid)
      .send({ lessons: onlyConditional, context: {} });
    expect(res.status).toBe(200);
    const expected = filterTransferableLessons(onlyConditional, {});
    expect(res.body.lessons).toEqual(expected);
    expect(res.body.lessons).toHaveLength(1);
    expect(res.body.lessons[0].applicableTo).toBe('any');
  });
});
