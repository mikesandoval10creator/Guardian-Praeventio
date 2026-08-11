// Ticket 39aaa66d-73fe-816c — Matriz de entitlements backend.
//
// Cada feature pagada debe devolver 402 upgrade_required para un caller free,
// probado DIRECTO contra el backend (no via frontend). Esto detecta gates
// faltantes como el de /api/auth/google/url (SSO) que la TIER_ROUTE_TABLE
// declara pero la ruta no aplicaba.
//
// Directiva: funciones vitales SIEMPRE gratis; el tier-gating aplica solo a
// gestion/escala/conveniencia.

import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted state ────────────────────────────────────────────────────────
const H = vi.hoisted(() => ({
  db: null as ReturnType<
    typeof import('../helpers/fakeFirestore').createFakeFirestore
  > | null,
}));

// ── Mocks: firebase-admin → fakeFirestore ────────────────────────────────
vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  return adminMock(() => H.db!);
});

// ── Mocks: verifyAuth → stub authenticated free user ─────────────────────
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (
    req: import('express').Request,
    _res: import('express').Response,
    next: import('express').NextFunction,
  ) => {
    req.user = { uid: 'free-user' } as never;
    next();
  },
}));

vi.mock('../../utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

// ── Mocks: heavy deps imported by oauthGoogle (prevent async leaks) ──────
vi.mock('../../utils/sentry.js', () => ({
  sentryCapture: vi.fn(),
}));

vi.mock('../../server/middleware/auditLog.js', () => ({
  auditServerEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/oauthTokenStore.js', () => ({
  saveTokens: vi.fn().mockResolvedValue(undefined),
  getValidAccessToken: vi.fn().mockResolvedValue(null),
  revokeTokens: vi.fn().mockResolvedValue(undefined),
  envelopeEncrypt: vi.fn().mockResolvedValue('enc'),
  envelopeDecrypt: vi.fn().mockResolvedValue('dec'),
}));

// ── Matrix definition ────────────────────────────────────────────────────
type MatrixCase = {
  feature: string;
  method: 'get' | 'post';
  path: string;
  body?: unknown;
  requiredPlan: 'titanio' | 'platino';
};

const PAID_BACKEND_MATRIX: readonly MatrixCase[] = [
  {
    feature: 'advanced_analytics.insights',
    method: 'get',
    path: '/api/insights/p1/risk-ranking',
    requiredPlan: 'platino',
  },
  {
    feature: 'multi_tenant_portfolio.compare',
    method: 'post',
    path: '/api/sprint-k/p1/multi-project/compare',
    body: { snapshots: [] },
    requiredPlan: 'platino',
  },
  {
    feature: 'advanced_analytics.maturity_index',
    method: 'get',
    path: '/api/sprint-k/p1/maturity-index',
    requiredPlan: 'platino',
  },
  {
    feature: 'advanced_analytics.role_summary',
    method: 'post',
    path: '/api/sprint-k/p1/role-summary/compose',
    body: {
      snapshot: {
        projectId: 'p1',
        projectName: 'Faena Norte',
        periodFrom: '2026-01-01',
        periodTo: '2026-01-31',
      },
      audience: 'executive',
    },
    requiredPlan: 'platino',
  },
  {
    feature: 'google_workspace.calendar_list',
    method: 'get',
    path: '/api/calendar/list',
    requiredPlan: 'titanio',
  },
  {
    feature: 'google_workspace.calendar_sync',
    method: 'post',
    path: '/api/calendar/sync',
    body: { challenges: [] },
    requiredPlan: 'titanio',
  },
  {
    feature: 'google_workspace.drive_auth',
    method: 'get',
    path: '/api/drive/auth/url',
    requiredPlan: 'titanio',
  },
  {
    feature: 'google_workspace.oauth_google_url',
    method: 'get',
    path: '/api/auth/google/url',
    requiredPlan: 'titanio',
  },
];

async function buildApp() {
  // `tierGateEnforced()` is read at module-registration time. Enforce so the
  // 402 path fires (not report-only).
  process.env.TIER_GATE_ENFORCE = 'true';

  const [
    { default: insightsRouter },
    { default: multiProjectRouter },
    { default: maturityRouter },
    { default: multiRoleSummaryRouter },
    { oauthGoogleApiRouter },
  ] = await Promise.all([
    import('../../server/routes/insights.js'),
    import('../../server/routes/multiProject.js'),
    import('../../server/routes/maturity.js'),
    import('../../server/routes/multiRoleSummary.js'),
    import('../../server/routes/oauthGoogle.js'),
  ]);

  const app = express();
  app.use(express.json());
  app.use('/api/insights', insightsRouter);
  app.use('/api/sprint-k', multiProjectRouter);
  app.use('/api/sprint-k', maturityRouter);
  app.use('/api/sprint-k', multiRoleSummaryRouter);
  app.use('/api', oauthGoogleApiRouter);
  return app;
}

describe('paid backend entitlements matrix', () => {
  let app: express.Express;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(async () => {
    const { createFakeFirestore } = await import('../helpers/fakeFirestore');
    H.db = createFakeFirestore();
    // Explicit free subscription so we prove backend entitlement, not
    // missing-user behavior.
    H.db._seed('users/free-user', {
      subscription: { plan: 'free', status: 'active' },
    });
  });

  it.each(PAID_BACKEND_MATRIX)(
    '$feature requires $requiredPlan server-side for a free caller',
    async ({ method, path, body, requiredPlan }) => {
      const res = await request(app)[method](path).send(body ?? {});
      expect(res.status).toBe(402);
      expect(res.body).toMatchObject({
        error: 'upgrade_required',
        requiredPlan,
        currentPlan: 'free',
      });
    },
  );
});
