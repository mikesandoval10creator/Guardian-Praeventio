// Real-router supertest for the AI Toggle HTTP surface
// (src/server/routes/aiToggle.ts). Three stateless POST endpoints over the
// pure deterministic engines in src/services/aiToggle/*:
//
//   POST /:projectId/ai-mode/decide            → { decision }
//   POST /:projectId/ai-mode/rules-only-check  → { rulesOnly }
//   POST /:projectId/ai-mode/rule-drift        → { alerts }
//
// The router's `guard` calls the REAL `assertProjectMember` against the
// fakeFirestore, so 403 is exercised by NOT seeding the caller into the project
// (never by mocking the gate, never by seeding the membership field of the
// success project and re-reading it). verifyAuth + logger + observability are
// mocked; the engines (decideAiMode / shouldUseRulesOnly / detectRuleDrift) run
// UNMOCKED so every 200 asserts real compute. The expected 200 bodies are
// re-derived by calling the real engine functions on the same inputs — we never
// reimplement the decision/drift logic inline.

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

import aiToggleRouter from '../../server/routes/aiToggle.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';
import {
  decideAiMode,
  shouldUseRulesOnly,
  type AiCapabilitySnapshot,
} from '../../services/aiToggle/aiModeController.js';
import {
  detectRuleDrift,
  type RuleApplicationSample,
} from '../../services/aiToggle/ruleDriftDetector.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', aiToggleRouter);
  return app;
}

const uid = { 'x-test-uid': 'u1' };

beforeEach(() => {
  H.db = createFakeFirestore();
  // Caller u1 is a member of project p1; project p2 exists but excludes u1.
  H.db._seed('projects/p1', { members: ['u1'], createdBy: 'owner' });
  H.db._seed('projects/p2', { members: ['someone-else'], createdBy: 'owner' });
});

describe('POST /:projectId/ai-mode/decide', () => {
  const url = '/api/p1/ai-mode/decide';
  // A snapshot the engine resolves to a definite, interesting branch (poor
  // network → cloud_with_local_fallback). Re-derived below from the real engine.
  const snapshot: AiCapabilitySnapshot = {
    networkClass: 'cellular_3g',
    batteryClass: 'sufficient',
    userPref: 'auto',
    localModelLoaded: true,
    tenantBudgetExceeded: false,
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(snapshot);
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine decision (poor-network hybrid)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(snapshot);
    expect(res.status).toBe(200);
    // Pin against the REAL engine output, not a hand-written literal.
    expect(res.body.decision).toEqual(decideAiMode(snapshot));
    // Sanity: this snapshot exercises the hybrid branch with degradation flag.
    expect(res.body.decision.mode).toBe('cloud_with_local_fallback');
    expect(res.body.decision.reason).toBe('poor_network_hybrid');
    expect(res.body.decision.informUserOfDegradation).toBe(true);
  });

  it('200 honours an explicit AI-off user preference (rules_only)', async () => {
    const off: AiCapabilitySnapshot = { ...snapshot, userPref: 'off' };
    const res = await request(buildApp()).post(url).set(uid).send(off);
    expect(res.status).toBe(200);
    expect(res.body.decision).toEqual(decideAiMode(off));
    expect(res.body.decision.mode).toBe('rules_only');
    expect(res.body.decision.useRulesOnly).toBe(true);
  });

  it('400 on invalid enum value (networkClass not in allow-list)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...snapshot, networkClass: 'starlink' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 on a missing required field', async () => {
    const { batteryClass: _drop, ...partial } = snapshot;
    const res = await request(buildApp()).post(url).set(uid).send(partial);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/ai-mode/decide')
      .set(uid)
      .send(snapshot);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when the project does not exist', async () => {
    const res = await request(buildApp())
      .post('/api/ghost/ai-mode/decide')
      .set(uid)
      .send(snapshot);
    expect(res.status).toBe(403);
  });

  it('does NOT reach the engine when the membership gate fails', async () => {
    // p2 excludes u1 — the body is a perfectly valid snapshot, so a 403 here
    // proves the gate runs BEFORE compute (no decision leaked to a non-member).
    const res = await request(buildApp())
      .post('/api/p2/ai-mode/decide')
      .set(uid)
      .send(snapshot);
    expect(res.status).toBe(403);
    expect(res.body).not.toHaveProperty('decision');
  });
});

describe('POST /:projectId/ai-mode/rules-only-check', () => {
  const url = '/api/p1/ai-mode/rules-only-check';
  // Offline + no local model → engine resolves useRulesOnly = true.
  const rulesOnlySnapshot: AiCapabilitySnapshot = {
    networkClass: 'offline',
    batteryClass: 'low',
    userPref: 'auto',
    localModelLoaded: false,
    tenantBudgetExceeded: false,
  };
  // Good network + auto → engine resolves useRulesOnly = false.
  const cloudSnapshot: AiCapabilitySnapshot = {
    networkClass: 'wifi',
    batteryClass: 'plenty',
    userPref: 'auto',
    localModelLoaded: false,
    tenantBudgetExceeded: false,
  };

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send(rulesOnlySnapshot);
    expect(res.status).toBe(401);
  });

  it('200 true when the real engine forces rules-only (offline, no SLM)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(rulesOnlySnapshot);
    expect(res.status).toBe(200);
    expect(res.body.rulesOnly).toBe(shouldUseRulesOnly(rulesOnlySnapshot));
    expect(res.body.rulesOnly).toBe(true);
  });

  it('200 false when the real engine allows cloud (good network, auto)', async () => {
    const res = await request(buildApp()).post(url).set(uid).send(cloudSnapshot);
    expect(res.status).toBe(200);
    expect(res.body.rulesOnly).toBe(shouldUseRulesOnly(cloudSnapshot));
    expect(res.body.rulesOnly).toBe(false);
  });

  it('400 on invalid body (wrong type for boolean field)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ ...cloudSnapshot, localModelLoaded: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/ai-mode/rules-only-check')
      .set(uid)
      .send(cloudSnapshot);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});

describe('POST /:projectId/ai-mode/rule-drift', () => {
  const url = '/api/p1/ai-mode/rule-drift';

  // A 4-period series for one rule: a stable ~0.5 baseline then a collapse to
  // ~0.05 in the latest period. With the default minBaselinePeriods=3 this is
  // exactly 1 baseline-window + 1 current, so the engine emits one alert.
  const samples: RuleApplicationSample[] = [
    { ruleId: 'noise_epp', period: '2026-01', applicationCount: 50, totalEntitiesEvaluated: 100 },
    { ruleId: 'noise_epp', period: '2026-02', applicationCount: 52, totalEntitiesEvaluated: 100 },
    { ruleId: 'noise_epp', period: '2026-03', applicationCount: 48, totalEntitiesEvaluated: 100 },
    { ruleId: 'noise_epp', period: '2026-04', applicationCount: 5, totalEntitiesEvaluated: 100 },
  ];

  it('401 without auth', async () => {
    const res = await request(buildApp()).post(url).send({ samples });
    expect(res.status).toBe(401);
  });

  it('200 returns the real engine drift alerts for a collapsing rule', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ samples });
    expect(res.status).toBe(200);
    // Pin against the REAL engine output rather than reimplementing the math.
    expect(res.body.alerts).toEqual(detectRuleDrift(samples));
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0].ruleId).toBe('noise_epp');
    expect(res.body.alerts[0].direction).toBe('decreasing');
    // 0.05 vs ~0.50 median → ≥80% drop → block_and_investigate.
    expect(res.body.alerts[0].severity).toBe('block_and_investigate');
  });

  it('200 honours options (raising minBaselinePeriods suppresses the alert)', async () => {
    // With minBaselinePeriods=4 the series (4 points) has fewer than 4+1
    // points, so the rule is skipped → no alerts.
    const options = { minBaselinePeriods: 4 };
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ samples, options });
    expect(res.status).toBe(200);
    expect(res.body.alerts).toEqual(detectRuleDrift(samples, options));
    expect(res.body.alerts).toEqual([]);
  });

  it('200 returns an empty array when there is no drift', async () => {
    const flat: RuleApplicationSample[] = [
      { ruleId: 'r', period: '2026-01', applicationCount: 50, totalEntitiesEvaluated: 100 },
      { ruleId: 'r', period: '2026-02', applicationCount: 50, totalEntitiesEvaluated: 100 },
      { ruleId: 'r', period: '2026-03', applicationCount: 50, totalEntitiesEvaluated: 100 },
      { ruleId: 'r', period: '2026-04', applicationCount: 50, totalEntitiesEvaluated: 100 },
    ];
    const res = await request(buildApp()).post(url).set(uid).send({ samples: flat });
    expect(res.status).toBe(200);
    expect(res.body.alerts).toEqual([]);
  });

  it('400 when samples is empty (schema min(1))', async () => {
    const res = await request(buildApp()).post(url).set(uid).send({ samples: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when a sample has a negative count (schema nonnegative)', async () => {
    const bad: RuleApplicationSample[] = [
      { ruleId: 'r', period: '2026-01', applicationCount: -1, totalEntitiesEvaluated: 100 },
    ];
    const res = await request(buildApp()).post(url).set(uid).send({ samples: bad });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when an out-of-range option is supplied (baselineWindow > 120)', async () => {
    const res = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ samples, options: { baselineWindow: 999 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('403 when caller is not a member of the project', async () => {
    const res = await request(buildApp())
      .post('/api/p2/ai-mode/rule-drift')
      .set(uid)
      .send({ samples });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });
});
