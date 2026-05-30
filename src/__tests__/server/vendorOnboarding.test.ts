// Real-router supertest for Sprint K §35, §40, §42-45 vendor/contractor
// onboarding HTTP surface. 5 POST endpoints — all stateless pure-compute
// over caller-supplied inputs. DS 76 compliance (contractor management).
//
// Plan v3 Fase 1 — server lever. No production-code changes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── Hoisted db holder ─────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
}));

// ── firebase-admin mock ───────────────────────────────────────────────────
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ── middleware mocks ──────────────────────────────────────────────────────
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));

// Exercise REAL validate() so Zod schema paths are covered.
// Do NOT mock validate — the route schemas are inline and we want 400 coverage.

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// assertProjectMember is mocked as a vi.fn so individual tests can override it.
vi.mock('../../services/auth/projectMembership.js', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, assertProjectMember: vi.fn(async () => undefined) };
});

// ── REAL services — they are pure functions, no I/O ──────────────────────
// (not mocked — we exercise real compute logic)

// ── imports after mocks ───────────────────────────────────────────────────
import vendorOnboardingRouter from '../../server/routes/vendorOnboarding.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';

// ── app factory ───────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sprint-k', vendorOnboardingRouter);
  return app;
}

const AUTH = { 'x-test-uid': 'u1' };

// ── shared fixture data ───────────────────────────────────────────────────

const BASE_STATE = {
  vendorId: 'v1',
  legalName: 'Constructora DS-76 SpA',
  invitedAt: '2026-01-01T00:00:00Z',
};

const REQ_DOC: Record<string, unknown> = {
  id: 'r1',
  label: 'Certificado de antecedentes laborales',
  kind: 'document',
  mandatory: true,
};

const COMPLIANCE_APPROVED: Record<string, unknown> = {
  vendorId: 'v1',
  requirementId: 'r1',
  status: 'approved',
  submittedAt: '2026-02-01T00:00:00Z',
  reviewedAt: '2026-02-10T00:00:00Z',
  reviewedByUid: 'reviewer1',
};

const OBS_MINOR: Record<string, unknown> = {
  id: 'o1',
  vendorId: 'v1',
  observedByUid: 'inspector1',
  kind: 'documentation',
  severity: 'minor',
  description: 'Certificado de vigencia próximo a vencer',
  observedAt: '2026-03-01T00:00:00Z',
};

const OBS_CRITICAL: Record<string, unknown> = {
  id: 'o2',
  vendorId: 'v1',
  observedByUid: 'inspector1',
  kind: 'incident',
  severity: 'critical',
  description: 'Accidente con lesionado grave en faena',
  observedAt: '2026-03-05T00:00:00Z',
};

// ── setup ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.mocked(assertProjectMember).mockReset().mockResolvedValue(undefined as never);
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { tenantId: 't1' });
});

// ═══════════════════════════════════════════════════════════════════════════
// Endpoint 1 — POST /:projectId/vendors/onboarding/evaluate-stage
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/vendors/onboarding/evaluate-stage', () => {
  const URL = '/api/sprint-k/p1/vendors/onboarding/evaluate-stage';

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(URL).send({});
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('no es miembro'),
    );
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        state: BASE_STATE,
        compliance: [],
        requirements: [],
      });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden' });
  });

  it('400 when body is missing required fields', async () => {
    const res = await request(buildApp()).post(URL).set(AUTH).send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_payload' });
  });

  it('400 when state is malformed (missing legalName)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        state: { vendorId: 'v1', invitedAt: '2026-01-01T00:00:00Z' }, // missing legalName
        compliance: [],
        requirements: [],
      });
    expect(res.status).toBe(400);
  });

  it('400 when compliance has an invalid status enum', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        state: BASE_STATE,
        compliance: [{ vendorId: 'v1', requirementId: 'r1', status: 'bogus_status' }],
        requirements: [],
      });
    expect(res.status).toBe(400);
  });

  it('200 returns "invited" stage when no compliance records exist', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        state: BASE_STATE,
        compliance: [],
        requirements: [REQ_DOC],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'invited' });
  });

  it('200 returns "docs_uploaded" when all mandatory items submitted', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        state: BASE_STATE,
        compliance: [{ ...COMPLIANCE_APPROVED, status: 'submitted' }],
        requirements: [REQ_DOC],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'docs_uploaded' });
  });

  it('200 returns "docs_validated" when all mandatory items approved', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        state: BASE_STATE,
        compliance: [COMPLIANCE_APPROVED],
        requirements: [REQ_DOC],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'docs_validated' });
  });

  it('200 returns "accredited" for an accredited vendor with current docs', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        state: { ...BASE_STATE, accreditedAt: '2026-02-15T00:00:00Z' },
        compliance: [COMPLIANCE_APPROVED],
        requirements: [REQ_DOC],
        now: '2026-04-01T00:00:00Z',
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'accredited' });
  });

  it('200 returns "expired" when an accredited vendor has an expired mandatory doc', async () => {
    // Compliance status explicitly 'expired' (compliance directive: expired docs
    // block accreditation renewal — advisory, not hard block at HTTP level).
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        state: { ...BASE_STATE, accreditedAt: '2026-02-15T00:00:00Z' },
        compliance: [{ ...COMPLIANCE_APPROVED, status: 'expired' }],
        requirements: [REQ_DOC],
        now: '2027-01-01T00:00:00Z',
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'expired' });
  });

  it('200 returns "expired" when expiresAt timestamp has passed', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        state: { ...BASE_STATE, accreditedAt: '2026-02-15T00:00:00Z' },
        compliance: [{
          ...COMPLIANCE_APPROVED,
          status: 'approved',
          expiresAt: '2026-06-01T00:00:00Z',
        }],
        requirements: [REQ_DOC],
        now: '2026-12-01T00:00:00Z', // past expiresAt
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'expired' });
  });

  it('200 returns "rejected" when rejectedAt is set', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        state: {
          ...BASE_STATE,
          rejectedAt: '2026-02-01T00:00:00Z',
          rejectionReason: 'Documentos incompletos',
        },
        compliance: [],
        requirements: [REQ_DOC],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'rejected' });
  });

  it('200 returns "site_walk" when siteWalkAt is set (not yet accredited)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        state: { ...BASE_STATE, siteWalkAt: '2026-02-20T00:00:00Z' },
        compliance: [COMPLIANCE_APPROVED],
        requirements: [REQ_DOC],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ stage: 'site_walk' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Endpoint 2 — POST /:projectId/vendors/:vendorId/onboarding/missing-mandatory
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/vendors/:vendorId/onboarding/missing-mandatory', () => {
  const URL = '/api/sprint-k/p1/vendors/v1/onboarding/missing-mandatory';

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(URL).send({});
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('no es miembro'),
    );
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({ compliance: [], requirements: [] });
    expect(res.status).toBe(403);
  });

  it('400 on missing body', async () => {
    const res = await request(buildApp()).post(URL).set(AUTH).send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_payload' });
  });

  it('200 returns empty list when all mandatory items are approved', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        compliance: [COMPLIANCE_APPROVED],
        requirements: [REQ_DOC],
      });
    expect(res.status).toBe(200);
    expect(res.body.requirements).toHaveLength(0);
  });

  it('200 returns missing mandatory requirement when vendor has no compliance record', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        compliance: [],
        requirements: [REQ_DOC],
      });
    expect(res.status).toBe(200);
    expect(res.body.requirements).toHaveLength(1);
    expect(res.body.requirements[0].id).toBe('r1');
  });

  it('200 returns mandatory requirement when status is pending', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        compliance: [{ ...COMPLIANCE_APPROVED, status: 'pending' }],
        requirements: [REQ_DOC],
      });
    expect(res.status).toBe(200);
    expect(res.body.requirements).toHaveLength(1);
  });

  it('200 returns mandatory requirement when status is rejected', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        compliance: [{ ...COMPLIANCE_APPROVED, status: 'rejected', reason: 'Ilegible' }],
        requirements: [REQ_DOC],
      });
    expect(res.status).toBe(200);
    expect(res.body.requirements).toHaveLength(1);
  });

  it('200 does not include non-mandatory requirements', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        compliance: [],
        requirements: [{ ...REQ_DOC, mandatory: false }],
      });
    expect(res.status).toBe(200);
    expect(res.body.requirements).toHaveLength(0);
  });

  it('200 only returns missing for the vendorId in the URL path', async () => {
    // compliance for a DIFFERENT vendor — should NOT count
    const res = await request(buildApp())
      .post(URL) // vendorId = v1
      .set(AUTH)
      .send({
        compliance: [{ ...COMPLIANCE_APPROVED, vendorId: 'v2' }], // other vendor
        requirements: [REQ_DOC],
      });
    expect(res.status).toBe(200);
    // v1 has no compliance record, so it shows as missing
    expect(res.body.requirements).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Endpoint 3 — POST /:projectId/vendors/onboarding/build-client-bundle
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/vendors/onboarding/build-client-bundle', () => {
  const URL = '/api/sprint-k/p1/vendors/onboarding/build-client-bundle';

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(URL).send({});
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('no es miembro'),
    );
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({ clientId: 'c1', baseRequirements: [], clientSpecificRequirements: [] });
    expect(res.status).toBe(403);
  });

  it('400 on missing clientId', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({ baseRequirements: [], clientSpecificRequirements: [] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_payload' });
  });

  it('400 when requirement has invalid kind', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        clientId: 'c1',
        baseRequirements: [{ ...REQ_DOC, kind: 'not_a_kind' }],
        clientSpecificRequirements: [],
      });
    expect(res.status).toBe(400);
  });

  it('200 returns merged bundle for baseline + client-specific requirements', async () => {
    const clientReq = {
      id: 'r2',
      label: 'Seguro específico mandante',
      kind: 'insurance',
      mandatory: true,
      clientSpecific: 'c1',
    };
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        clientId: 'c1',
        baseRequirements: [REQ_DOC],
        clientSpecificRequirements: [clientReq],
      });
    expect(res.status).toBe(200);
    expect(res.body.requirements).toHaveLength(2);
    const ids = res.body.requirements.map((r: { id: string }) => r.id);
    expect(ids).toContain('r1');
    expect(ids).toContain('r2');
  });

  it('200 excludes requirements for a different client', async () => {
    const otherClientReq = {
      id: 'r3',
      label: 'Requisito de otro mandante',
      kind: 'certification',
      mandatory: true,
      clientSpecific: 'c_other',
    };
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        clientId: 'c1',
        baseRequirements: [REQ_DOC],
        clientSpecificRequirements: [otherClientReq],
      });
    expect(res.status).toBe(200);
    const ids = res.body.requirements.map((r: { id: string }) => r.id);
    expect(ids).not.toContain('r3'); // filtered out — belongs to different client
    expect(ids).toContain('r1');    // baseline always included
  });

  it('200 client-specific overrides base requirement with same id', async () => {
    const overriddenReq = {
      id: 'r1', // same id as REQ_DOC
      label: 'Certificado antecedentes (versión mandante — más estricto)',
      kind: 'document',
      mandatory: true,
      clientSpecific: 'c1',
    };
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        clientId: 'c1',
        baseRequirements: [REQ_DOC],
        clientSpecificRequirements: [overriddenReq],
      });
    expect(res.status).toBe(200);
    expect(res.body.requirements).toHaveLength(1);
    expect(res.body.requirements[0].label).toBe(
      'Certificado antecedentes (versión mandante — más estricto)',
    );
  });

  it('200 returns empty bundle when no matching requirements', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        clientId: 'c1',
        baseRequirements: [],
        clientSpecificRequirements: [],
      });
    expect(res.status).toBe(200);
    expect(res.body.requirements).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Endpoint 4 — POST /:projectId/vendors/:vendorId/accreditation/summarize
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/vendors/:vendorId/accreditation/summarize', () => {
  const URL = '/api/sprint-k/p1/vendors/v1/accreditation/summarize';

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(URL).send({});
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('no es miembro'),
    );
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({ observations: [] });
    expect(res.status).toBe(403);
  });

  it('400 on missing observations array', async () => {
    const res = await request(buildApp()).post(URL).set(AUTH).send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_payload' });
  });

  it('400 when observation has invalid severity', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        observations: [{ ...OBS_MINOR, severity: 'catastrophic' }],
      });
    expect(res.status).toBe(400);
  });

  it('400 when observation has invalid kind', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        observations: [{ ...OBS_MINOR, kind: 'unknown_kind' }],
      });
    expect(res.status).toBe(400);
  });

  it('200 returns zero counts for a vendor with no observations', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({ observations: [] });
    expect(res.status).toBe(200);
    expect(res.body.status).toMatchObject({
      vendorId: 'v1',
      openObservations: 0,
      criticalCount: 0,
      eligibleForRecurringWork: true,
    });
  });

  it('200 returns correct counts for a minor observation', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({ observations: [OBS_MINOR] });
    expect(res.status).toBe(200);
    expect(res.body.status).toMatchObject({
      openObservations: 1,
      minorCount: 1,
      criticalCount: 0,
      eligibleForRecurringWork: true,
    });
  });

  it('200 flags vendor as not eligible when there is a critical open observation', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({ observations: [OBS_CRITICAL] });
    expect(res.status).toBe(200);
    expect(res.body.status.eligibleForRecurringWork).toBe(false);
    expect(res.body.status.criticalCount).toBe(1);
    expect(typeof res.body.status.reasonIfNot).toBe('string');
  });

  it('200 resolves critical observation as closed when resolvedAt is set', async () => {
    const resolved = { ...OBS_CRITICAL, resolvedAt: '2026-03-10T00:00:00Z', resolvedByUid: 'u2' };
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({ observations: [resolved] });
    expect(res.status).toBe(200);
    expect(res.body.status.openObservations).toBe(0);
    expect(res.body.status.eligibleForRecurringWork).toBe(true);
  });

  it('200 flags not eligible when ≥3 major observations are open', async () => {
    const makeMajor = (id: string) => ({
      ...OBS_MINOR,
      id,
      severity: 'major',
      kind: 'documentation',
    });
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        observations: [makeMajor('o3'), makeMajor('o4'), makeMajor('o5')],
      });
    expect(res.status).toBe(200);
    expect(res.body.status.majorCount).toBe(3);
    expect(res.body.status.eligibleForRecurringWork).toBe(false);
  });

  it('200 only counts observations for the vendorId in the URL path', async () => {
    const otherVendorObs = { ...OBS_CRITICAL, id: 'o_other', vendorId: 'v_other' };
    const res = await request(buildApp())
      .post(URL) // vendorId = v1
      .set(AUTH)
      .send({ observations: [otherVendorObs] });
    expect(res.status).toBe(200);
    // v1 has no observations
    expect(res.body.status.openObservations).toBe(0);
    expect(res.body.status.eligibleForRecurringWork).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Endpoint 5 — POST /:projectId/vendors/:vendorId/accreditation/should-escalate
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /:projectId/vendors/:vendorId/accreditation/should-escalate', () => {
  const URL = '/api/sprint-k/p1/vendors/v1/accreditation/should-escalate';

  it('401 when no auth token', async () => {
    const res = await request(buildApp()).post(URL).send({});
    expect(res.status).toBe(401);
  });

  it('403 when caller is not a project member', async () => {
    vi.mocked(assertProjectMember).mockRejectedValueOnce(
      new ProjectMembershipError('no es miembro'),
    );
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({ observation: OBS_MINOR, history: [] });
    expect(res.status).toBe(403);
  });

  it('400 on missing observation', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({ history: [] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_payload' });
  });

  it('400 when windowDays is negative', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        observation: OBS_MINOR,
        history: [],
        windowDays: -5,
      });
    expect(res.status).toBe(400);
  });

  it('400 when windowDays exceeds max (365)', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        observation: OBS_MINOR,
        history: [],
        windowDays: 400,
      });
    expect(res.status).toBe(400);
  });

  it('200 escalates a critical observation regardless of history', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({ observation: OBS_CRITICAL, history: [] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ shouldEscalate: true });
  });

  it('200 does not escalate a minor observation with no history', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({ observation: OBS_MINOR, history: [] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ shouldEscalate: false });
  });

  it('200 escalates a major observation with ≥2 same-kind events in window', async () => {
    const majorObs = {
      ...OBS_MINOR,
      id: 'o_new',
      severity: 'major',
      kind: 'documentation',
      observedAt: '2026-03-15T00:00:00Z',
    };
    const historicA = { ...majorObs, id: 'o_hist_a', observedAt: '2026-03-10T00:00:00Z' };
    const historicB = { ...majorObs, id: 'o_hist_b', observedAt: '2026-03-05T00:00:00Z' };
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        observation: majorObs,
        history: [historicA, historicB],
        windowDays: 30,
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ shouldEscalate: true });
  });

  it('200 does not escalate a major observation with <2 same-kind events in window', async () => {
    const majorObs = {
      ...OBS_MINOR,
      id: 'o_new',
      severity: 'major',
      kind: 'documentation',
      observedAt: '2026-03-15T00:00:00Z',
    };
    const historicA = { ...majorObs, id: 'o_hist_a', observedAt: '2026-03-10T00:00:00Z' };
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        observation: majorObs,
        history: [historicA], // only 1 historic — below threshold
        windowDays: 30,
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ shouldEscalate: false });
  });

  it('200 does not escalate a major observation outside the time window', async () => {
    const majorObs = {
      ...OBS_MINOR,
      id: 'o_new',
      severity: 'major',
      kind: 'documentation',
      observedAt: '2026-03-15T00:00:00Z',
    };
    // Both historical events are > 30 days before
    const historicA = { ...majorObs, id: 'o_hist_a', observedAt: '2025-12-01T00:00:00Z' };
    const historicB = { ...majorObs, id: 'o_hist_b', observedAt: '2025-11-01T00:00:00Z' };
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        observation: majorObs,
        history: [historicA, historicB],
        windowDays: 30,
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ shouldEscalate: false });
  });

  it('200 uses custom windowDays parameter', async () => {
    const majorObs = {
      ...OBS_MINOR,
      id: 'o_new',
      severity: 'major',
      kind: 'documentation',
      observedAt: '2026-03-15T00:00:00Z',
    };
    const historicA = { ...majorObs, id: 'o_hist_a', observedAt: '2026-01-01T00:00:00Z' };
    const historicB = { ...majorObs, id: 'o_hist_b', observedAt: '2026-01-10T00:00:00Z' };
    // With windowDays=365, all within 1 year → should escalate
    const res = await request(buildApp())
      .post(URL)
      .set(AUTH)
      .send({
        observation: majorObs,
        history: [historicA, historicB],
        windowDays: 365,
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ shouldEscalate: true });
  });
});
