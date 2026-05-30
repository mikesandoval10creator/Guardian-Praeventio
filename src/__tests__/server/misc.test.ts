// Real-router supertest for the grab-bag misc route (src/server/routes/misc.ts).
// This file mounts several unrelated-but-small endpoints that previously had 0
// tests: the climate forecast proxy, the HONEST ERP sync adapter (Sprint 39 —
// not_configured / mock / legacy-rejected modes), and the two gerente-only seed
// endpoints. We mount the ACTUAL production router through the reusable
// fakeFirestore so the real handler code (auth gate, zod validation, the ERP
// mode branching, the role check, the fail-soft audit log to `erp_sync_logs`)
// is exercised. The heavy domain deps (environmentBackend, seedBackend,
// dataSeedService, bcnKnowledgeBase, geminiBackend, the ERP adapter) are dynamic
// imports or mocked here so this stays a fast HTTP-contract test.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  // Swappable ERP adapter so a test can flip not_configured (null) vs mock-success.
  erpAdapter: null as { sync: (arg: unknown) => Promise<unknown> } | null,
}));

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  // Custom auth: getUser returns the `gerente` role ONLY for uid 'gerente-1', so
  // the same single mock can drive both the 403 (non-gerente) and 200 (gerente)
  // paths of /seed-glossary and /seed-data purely from the x-test-uid header.
  return adminMock(() => H.db!, {
    getUser: async (uid: string) => ({
      uid,
      customClaims: uid === 'gerente-1' ? { role: 'gerente' } : {},
    }),
    verifyIdToken: async () => ({ uid: 'test' }),
  });
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
      tenantId: req.header('x-test-tenant') || undefined,
    };
    next();
  },
}));
vi.mock('../../server/middleware/limiters.js', () => ({
  erpSyncLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));
vi.mock('../../services/erp/erpAdapter.js', () => ({
  selectErpAdapter: () => H.erpAdapter,
  buildNotConfiguredResult: (args: { action: string }) => ({
    ok: false,
    mode: 'not_configured',
    message: 'ERP no configurado en este servidor',
    action: args.action,
  }),
  ErpMissingCredentialsError: class ErpMissingCredentialsError extends Error {},
  ErpNotImplementedError: class ErpNotImplementedError extends Error {},
}));
// Dynamic-imported domain services — mocked so the handlers don't reach the
// network / heavy modules. Paths resolve to the SAME absolute module the route
// imports, so vitest swaps them in for the route's `await import(...)` too.
vi.mock('../../services/environmentBackend.js', () => ({
  getForecast: vi.fn(async (days: number) =>
    Array.from({ length: days }, (_, i) => ({ day: i, tempC: 20 + i, riskLevel: 'low' })),
  ),
}));
vi.mock('../../services/seedBackend.js', () => ({ runSeed: vi.fn(async () => undefined) }));
vi.mock('../../services/dataSeedService.js', () => ({ seedInitialData: vi.fn(async () => undefined) }));
vi.mock('../../data/bcnKnowledgeBase.js', () => ({
  bcnKnowledgeBase: [
    {
      id: 'ley-16744',
      title: 'Ley 16.744',
      content: 'Seguro social contra riesgos de accidentes del trabajo.',
      lastUpdated: '2024-01-01',
      relevantModules: ['incidentes'],
    },
  ],
}));
vi.mock('../../services/geminiBackend.js', () => ({
  scanLegalUpdates: vi.fn(async () => ({ impact: 'none', summary: 'Sin cambios normativos' })),
}));

import miscRouter from '../../server/routes/misc.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import { getForecast } from '../../services/environmentBackend.js';
import { runSeed } from '../../services/seedBackend.js';
import { seedInitialData } from '../../services/dataSeedService.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', miscRouter);
  return app;
}

beforeEach(() => {
  H.db = createFakeFirestore();
  H.erpAdapter = null;
  vi.mocked(getForecast).mockClear();
  vi.mocked(runSeed).mockClear();
  vi.mocked(seedInitialData).mockClear();
});

describe('GET /environment/forecast', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/environment/forecast');
    expect(res.status).toBe(401);
  });

  it('200 returns the multi-day forecast (default 3 days)', async () => {
    const res = await request(buildApp())
      .get('/api/environment/forecast')
      .set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.forecast)).toBe(true);
    expect(res.body.forecast).toHaveLength(3);
    expect(vi.mocked(getForecast)).toHaveBeenCalledWith(3);
  });

  it('clamps the ?days query into [1,7]', async () => {
    const res = await request(buildApp())
      .get('/api/environment/forecast?days=99')
      .set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    expect(vi.mocked(getForecast)).toHaveBeenCalledWith(7);
  });

  it('200 with an empty forecast (graceful) when the upstream throws', async () => {
    vi.mocked(getForecast).mockRejectedValueOnce(new Error('OpenWeather down'));
    const res = await request(buildApp())
      .get('/api/environment/forecast')
      .set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ forecast: [] });
  });
});

describe('POST /erp/sync', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post('/api/erp/sync').send({ action: 'manual_sync' });
    expect(res.status).toBe(401);
  });

  it('400 invalid_payload when the body is missing a valid action', async () => {
    const res = await request(buildApp())
      .post('/api/erp/sync')
      .set('x-test-uid', 'w1')
      .send({ payload: { foo: 'bar' } }); // no `action`
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('501 not_implemented for a legacy erpType with no adapter (oracle)', async () => {
    const res = await request(buildApp())
      .post('/api/erp/sync')
      .set('x-test-uid', 'w1')
      .send({ erpType: 'oracle', action: 'manual_sync' });
    expect(res.status).toBe(501);
    expect(res.body.success).toBe(false);
    expect(res.body.mode).toBe('not_implemented');
  });

  it('503 not_configured when no ERP adapter is selected', async () => {
    H.erpAdapter = null;
    const res = await request(buildApp())
      .post('/api/erp/sync')
      .set('x-test-uid', 'w1')
      .send({ action: 'manual_sync' });
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.mode).toBe('not_configured');
    // The attempt is recorded in the fail-soft audit log.
    const logs = await H.db!.collection('erp_sync_logs').get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data()!.status).toBe('not_configured');
  });

  it('200 mode:mock when the mock adapter syncs (test-mode, honest banner)', async () => {
    H.erpAdapter = {
      sync: vi.fn(async () => ({ ok: true, mode: 'mock', message: 'Sincronización simulada' })),
    };
    const res = await request(buildApp())
      .post('/api/erp/sync')
      .set('x-test-uid', 'w1')
      .set('x-test-tenant', 't1')
      .send({ erpType: 'mock', action: 'manual_sync', payload: { batch: 1 } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.mode).toBe('mock');
    const logs = await H.db!.collection('erp_sync_logs').get();
    expect(logs.size).toBe(1);
    expect(logs.docs[0].data()!.status).toBe('success');
  });
});

describe('POST /seed-glossary (gerente-only)', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post('/api/seed-glossary');
    expect(res.status).toBe(401);
  });

  it('403 for a non-gerente caller', async () => {
    const res = await request(buildApp())
      .post('/api/seed-glossary')
      .set('x-test-uid', 'worker-1');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/gerente/i);
    expect(vi.mocked(runSeed)).not.toHaveBeenCalled();
  });

  it('200 seeds the glossary for a gerente', async () => {
    const res = await request(buildApp())
      .post('/api/seed-glossary')
      .set('x-test-uid', 'gerente-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(vi.mocked(runSeed)).toHaveBeenCalledTimes(1);
  });
});

describe('POST /seed-data (gerente-only)', () => {
  it('403 for a non-gerente caller', async () => {
    const res = await request(buildApp())
      .post('/api/seed-data')
      .set('x-test-uid', 'worker-1');
    expect(res.status).toBe(403);
    expect(vi.mocked(seedInitialData)).not.toHaveBeenCalled();
  });

  it('200 seeds initial data for a gerente', async () => {
    const res = await request(buildApp())
      .post('/api/seed-data')
      .set('x-test-uid', 'gerente-1');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(vi.mocked(seedInitialData)).toHaveBeenCalledTimes(1);
  });
});

describe('GET /legal/check-updates', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).get('/api/legal/check-updates');
    expect(res.status).toBe(401);
  });

  it('200 returns the per-law normative-impact scan', async () => {
    const res = await request(buildApp())
      .get('/api/legal/check-updates')
      .set('x-test-uid', 'w1');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].lawId).toBe('ley-16744');
    expect(res.body.results[0].impact).toBe('none');
  });
});
