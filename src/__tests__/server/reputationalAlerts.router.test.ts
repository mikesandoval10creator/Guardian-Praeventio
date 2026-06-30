// Real-router supertest for the Reputational Alerts HTTP surface
// (src/server/routes/reputationalAlerts.ts). Two stateless POST endpoints over
// the pure-compute engine in
// src/services/reputationalAlerts/reputationalAlertEngine.ts:
//
//   POST /:projectId/reputational-alerts/analyze   → { alerts: ReputationalAlert[] }
//   POST /:projectId/reputational-alerts/summarize → { summary: ReputationalRiskSummary }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore — 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate). verifyAuth + logger + observability are mocked;
// the engine itself runs UNMOCKED so every 200 asserts real deterministic
// compute. Happy-path assertions re-derive expected values from the engine's
// own severity + recommendation logic.

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
vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../services/observability/index.js', () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import reputationalAlertsRouter from '../../server/routes/reputationalAlerts.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import type { ExternalSignal } from '../../services/reputationalAlerts/reputationalAlertEngine.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', reputationalAlertsRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

/** A local negative signal (no fatality, no regulator action). Engine: info → monitor. */
const localNegativeSignal: ExternalSignal = {
  source: 'news',
  keyword: 'accidente minera',
  publishedAt: '2026-06-01T10:00:00.000Z',
  sentiment: 'negative',
  reach: 'local',
};

/**
 * Two national negative signals about the same keyword (same cluster, 7-day window).
 * Engine: negatives>=3 not met but national reach + negative → falls to 'warning'
 * check: negatives>=2 && regional+: 2 negatives national → actually:
 *   decideSeverity checks: (negatives>=3 && national) OR fatality OR (international && negatives>=1)
 *   → critical? no (negatives=2, not >=3). Then warning: negatives>=2 && national → YES → warning.
 */
const twoNationalNegatives: ExternalSignal[] = [
  {
    source: 'news',
    keyword: 'accidente planta',
    publishedAt: '2026-06-01T08:00:00.000Z',
    sentiment: 'negative',
    reach: 'national',
  },
  {
    source: 'social_media',
    keyword: 'accidente planta',
    publishedAt: '2026-06-02T09:00:00.000Z',
    sentiment: 'negative',
    reach: 'national',
  },
];

/** A fatality signal → engine produces 'critical' severity. */
const fatalitySignal: ExternalSignal = {
  source: 'official_record',
  keyword: 'accidente fatal mineria',
  publishedAt: '2026-06-10T12:00:00.000Z',
  sentiment: 'negative',
  reach: 'national',
  flags: { fatality: true },
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

// ────────────────────────────────────────────────────────────────────────
// 1. analyze
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/reputational-alerts/analyze', () => {
  const url = '/api/p1/reputational-alerts/analyze';

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send({ signals: [localNegativeSignal] });
    expect(res.status).toBe(401);
  });

  it('200 empty signals returns empty alerts array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ signals: [] });
    expect(res.status).toBe(200);
    expect(res.body.alerts).toEqual([]);
  });

  it('200 single local negative signal: severity info, recommendation monitor', async () => {
    // Engine decideSeverity: local+1 negative → not critical/warning → info
    // recommendationFor(info) = 'monitor'
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ signals: [localNegativeSignal] });
    expect(res.status).toBe(200);
    const alerts = res.body.alerts as Array<{
      severity: string;
      recommendation: string;
      reachScore: number;
      signals: unknown[];
      clusterKey: string;
    }>;
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('info');
    expect(alerts[0].recommendation).toBe('monitor');
    expect(alerts[0].signals).toHaveLength(1);
    // reachScore: base=REACH_WEIGHT[local]=10, volumeBonus=min(20,1×4)=4, negBonus=min(10,1×2)=2 → 16
    expect(alerts[0].reachScore).toBe(16);
  });

  it('200 two national negative signals cluster together (same keyword) → warning + prepare_statement', async () => {
    // Both keywords are 'accidente planta' — identical → Jaccard sim = 1.0 ≥ 0.5 → same cluster.
    // decideSeverity: negatives=2, national → warning: 'negatives>=2 && national' → warning
    // recommendationFor('warning') = 'prepare_statement'
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ signals: twoNationalNegatives });
    expect(res.status).toBe(200);
    const alerts = res.body.alerts as Array<{
      severity: string;
      recommendation: string;
      signals: unknown[];
    }>;
    // They should cluster into 1 alert
    expect(alerts).toHaveLength(1);
    expect(alerts[0].severity).toBe('warning');
    expect(alerts[0].recommendation).toBe('prepare_statement');
    expect(alerts[0].signals).toHaveLength(2);
  });

  it('200 fatality signal yields critical severity + escalate_pr_team recommendation', async () => {
    // decideSeverity: fatality=true → critical (since not international with fatality)
    // recommendationFor('critical') = 'escalate_pr_team'
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ signals: [fatalitySignal] });
    expect(res.status).toBe(200);
    const alerts = res.body.alerts as Array<{ severity: string; recommendation: string }>;
    expect(alerts[0].severity).toBe('critical');
    expect(alerts[0].recommendation).toBe('escalate_pr_team');
  });

  it('200 windowDays parameter filters signals outside the time window into separate clusters', async () => {
    // Two signals with same keyword but published 30 days apart.
    // windowDays=3 → they cannot be in the same cluster → 2 separate alerts.
    const signalOld: ExternalSignal = {
      source: 'news',
      keyword: 'incendio bodega',
      publishedAt: '2026-05-01T10:00:00.000Z',
      sentiment: 'negative',
      reach: 'local',
    };
    const signalNew: ExternalSignal = {
      source: 'social_media',
      keyword: 'incendio bodega',
      publishedAt: '2026-06-01T10:00:00.000Z',
      sentiment: 'negative',
      reach: 'local',
    };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ signals: [signalOld, signalNew], windowDays: 3 });
    expect(res.status).toBe(200);
    expect((res.body.alerts as unknown[]).length).toBe(2);
  });

  it('400 when signals is not an array', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ signals: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a signal has an invalid source enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        signals: [{ ...localNegativeSignal, source: 'tiktok' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a signal has an invalid reach enum', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        signals: [{ ...localNegativeSignal, reach: 'galactic' }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/reputational-alerts/analyze')
      .set(uid)
      .send({ signals: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/reputational-alerts/analyze')
      .set(uid)
      .send({ signals: [] });
    expect(res.status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. summarize
// ────────────────────────────────────────────────────────────────────────

describe('POST /:projectId/reputational-alerts/summarize', () => {
  const url = '/api/p1/reputational-alerts/summarize';

  it('401 without auth header', async () => {
    const res = await request(buildApp()).post(url).send({ signals: [] });
    expect(res.status).toBe(401);
  });

  it('200 empty signals → highestSeverity info, totalSignals 0, topRecommendation monitor', async () => {
    // summarizeReputationalRisk with no signals: alerts=[], highest stays 'info'
    const res = await request(buildApp()).post(url).set(uid).send({ signals: [] });
    expect(res.status).toBe(200);
    expect(res.body.summary.alerts).toEqual([]);
    expect(res.body.summary.highestSeverity).toBe('info');
    expect(res.body.summary.totalSignals).toBe(0);
    expect(res.body.summary.topRecommendation).toBe('monitor');
  });

  it('200 fatality signal: summary reflects critical highest severity + escalate_pr_team', async () => {
    // Engine summarizes across all clusters; fatality → critical → escalate_pr_team
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ signals: [fatalitySignal] });
    expect(res.status).toBe(200);
    const { summary } = res.body as {
      summary: {
        highestSeverity: string;
        totalSignals: number;
        topRecommendation: string;
        alerts: unknown[];
      };
    };
    expect(summary.highestSeverity).toBe('critical');
    expect(summary.totalSignals).toBe(1);
    expect(summary.topRecommendation).toBe('escalate_pr_team');
    expect(summary.alerts).toHaveLength(1);
  });

  it('200 mixed signals: highest severity wins across clusters', async () => {
    // Local info + fatality critical → highest = critical
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ signals: [localNegativeSignal, fatalitySignal] });
    expect(res.status).toBe(200);
    expect(res.body.summary.highestSeverity).toBe('critical');
    expect(res.body.summary.totalSignals).toBe(2);
  });

  it('400 when signals is missing', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/reputational-alerts/summarize')
      .set(uid)
      .send({ signals: [] });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

// Type-only guard: keep the imported engine type referenced so the import is not pruned.
const _typeCheck: keyof ExternalSignal = 'source';
void _typeCheck;
