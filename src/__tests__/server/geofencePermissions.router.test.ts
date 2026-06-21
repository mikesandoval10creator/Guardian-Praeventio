// Real-router supertest for src/server/routes/geofencePermissions.ts
// (Sprint 50 E.5 H27 — Geofence permission UX decision HTTP surface).
//
// Mounts the ACTUAL production router via the firebase-admin fake so the guard's
// REAL assertProjectMember runs against a seeded `projects/{id}` doc, and the
// REAL pure engine `decidePermissionUX` runs UNMOCKED — we assert the engine's
// actual decision shape, never re-implementing it.
//
// Surface (1 endpoint):
//   POST /:projectId/geofence-permissions/decide-ux
//     body: { platform, foregroundState, backgroundState, inCriticalZone?, userOptedOutForever? }
//     200:  { decision: PermissionUXDecision }
//
// Coverage per CLAUDE.md #22: 401 (no token), 403 (non-member — exercised
// through the REAL membership check, not a mocked gate), 400 (Zod invalid body),
// 200 (happy paths asserting REAL engine output).
//
// LIFE-SAFETY INVARIANTS pinned here (Directive #2 + engine design rules):
//   • In a critical zone with denied location, the engine BLOCKS Guardian's own
//     geofence/SOS feature (canUseGeofence=false) — but the response is advisory
//     copy ("solicita acompañamiento"), NEVER an instruction to block machinery.
//   • Pure compute — the handler performs NO Firestore writes (only the guard
//     reads the project doc). We assert the project doc is left untouched.

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

// verifyAuth: token presence is signalled by the x-test-uid header. No uid → 401,
// mirroring the real middleware's contract without needing a real Firebase token.
vi.mock('../../server/middleware/verifyAuth.js', () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header('x-test-uid');
    if (!uid) return void res.status(401).json({ error: 'unauthorized' });
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// NOTE: projectMembership is intentionally NOT mocked — the real
// assertProjectMember runs against the fakeFirestore so the 403 path exercises
// real membership logic (project-not-found + caller-not-in-members).

import geofenceRouter from '../../server/routes/geofencePermissions.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

const PROJECT_ID = 'p1';
const MEMBER_UID = 'worker-1';
const URL = `/api/sprint-k/${PROJECT_ID}/geofence-permissions/decide-ux`;

function buildApp() {
  const app = express();
  app.use(express.json());
  // Same prefix as server.ts: app.use('/api/sprint-k', geofencePermissionsRouter)
  app.use('/api/sprint-k', geofenceRouter);
  return app;
}

function seedMemberProject() {
  H.db!._seed(`projects/${PROJECT_ID}`, {
    name: 'Faena Norte',
    members: [MEMBER_UID],
    createdBy: 'admin-uid',
  });
}

const GRANTED_FULL_BODY = {
  platform: 'android',
  foregroundState: 'granted',
  backgroundState: 'granted_always',
} as const;

beforeEach(() => {
  H.db = createFakeFirestore();
});

// =============================================================================
// Auth gate
// =============================================================================

describe('POST /api/sprint-k/:projectId/geofence-permissions/decide-ux — auth', () => {
  it('401 without a token', async () => {
    const res = await request(buildApp()).post(URL).send(GRANTED_FULL_BODY);
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// Membership gate (REAL assertProjectMember)
// =============================================================================

describe('POST decide-ux — project membership (real guard)', () => {
  it('403 when the project does not exist (no seed)', async () => {
    // Project not seeded → assertProjectMember throws ProjectMembershipError.
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send(GRANTED_FULL_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('403 when caller is not a member of the project', async () => {
    seedMemberProject(); // members: [worker-1], createdBy: admin-uid
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'outsider-uid')
      .send(GRANTED_FULL_BODY);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('200 for the project creator even if not in members[]', async () => {
    // createdBy fast-path of the REAL membership check.
    H.db!._seed(`projects/${PROJECT_ID}`, {
      name: 'Faena Sur',
      members: [],
      createdBy: 'creator-uid',
    });
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', 'creator-uid')
      .send(GRANTED_FULL_BODY);
    expect(res.status).toBe(200);
    expect(res.body.decision).toBeDefined();
  });
});

// =============================================================================
// Body validation (Zod)
// =============================================================================

describe('POST decide-ux — body validation', () => {
  beforeEach(seedMemberProject);

  it('400 when platform is an unknown enum value', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...GRANTED_FULL_BODY, platform: 'symbian' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when foregroundState is missing', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ platform: 'android', backgroundState: 'granted_always' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when backgroundState is an unknown enum value', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...GRANTED_FULL_BODY, backgroundState: 'maybe' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('400 when inCriticalZone is not a boolean', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ ...GRANTED_FULL_BODY, inCriticalZone: 'yes' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });

  it('validation runs before the membership guard (400 even with no project seeded)', async () => {
    H.db = createFakeFirestore(); // no project doc
    const res = await request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send({ platform: 'android' }); // invalid: missing required fields
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
  });
});

// =============================================================================
// Happy path — REAL engine decisions
// =============================================================================

describe('POST decide-ux — engine decisions (real decidePermissionUX)', () => {
  beforeEach(seedMemberProject);

  async function decide(body: Record<string, unknown>) {
    return request(buildApp())
      .post(URL)
      .set('x-test-uid', MEMBER_UID)
      .send(body);
  }

  it('200 fully granted → geofence + background SOS enabled, continue degraded', async () => {
    const res = await decide({
      platform: 'android',
      foregroundState: 'granted',
      backgroundState: 'granted_always',
    });
    expect(res.status).toBe(200);
    const d = res.body.decision;
    expect(d.canUseGeofence).toBe(true);
    expect(d.canUseEmergencySOSWithLocation).toBe(true);
    expect(d.mustUseFallback).toBe(false);
    expect(d.recommendedAction).toBe('continue_degraded');
    expect(d.userMessage.key).toBe('geofence.permission.granted');
    // Rationale is platform-tuned (android), not the desktop fallback.
    expect(d.rationaleText).toContain('Permitir todo el tiempo');
  });

  it('200 granted_when_in_use → foreground works but upgrade to "Siempre" needed', async () => {
    const res = await decide({
      platform: 'ios',
      foregroundState: 'granted',
      backgroundState: 'granted_when_in_use',
    });
    expect(res.status).toBe(200);
    const d = res.body.decision;
    expect(d.canUseGeofence).toBe(true);
    expect(d.canUseEmergencySOSWithLocation).toBe(true);
    expect(d.mustUseFallback).toBe(false);
    expect(d.recommendedAction).toBe('open_system_settings');
    expect(d.userMessage.key).toBe('geofence.permission.granted_when_in_use_only');
  });

  it('200 LIFE-SAFETY: denied in a critical zone BLOCKS Guardian feature with advisory copy', async () => {
    const res = await decide({
      platform: 'android',
      foregroundState: 'denied',
      backgroundState: 'denied',
      inCriticalZone: true,
    });
    expect(res.status).toBe(200);
    const d = res.body.decision;
    // Feature is blocked (Guardian's own geofence/SOS), fallback forced.
    expect(d.canUseGeofence).toBe(false);
    expect(d.canUseEmergencySOSWithLocation).toBe(false);
    expect(d.mustUseFallback).toBe(true);
    expect(d.recommendedAction).toBe('block_feature_with_explanation');
    expect(d.userMessage.key).toBe('geofence.permission.denied_critical_zone');
    // Directive #2: advisory copy, NEVER an instruction to block machinery.
    expect(d.userMessage.fallback).toContain('solicita acompañamiento');
    const blob = JSON.stringify(d).toLowerCase();
    expect(blob).not.toContain('maquinaria');
    expect(blob).not.toContain('block machinery');
  });

  it('200 android "Don\'t ask again" (denied + optedOutForever) → open settings', async () => {
    const res = await decide({
      platform: 'android',
      foregroundState: 'denied',
      backgroundState: 'denied',
      userOptedOutForever: true,
    });
    expect(res.status).toBe(200);
    const d = res.body.decision;
    expect(d.canUseGeofence).toBe(false);
    expect(d.recommendedAction).toBe('open_system_settings');
    expect(d.userMessage.key).toBe('geofence.permission.denied_forever');
  });

  it('200 iOS ignores optedOutForever (no "deny forever") → friendlier modal', async () => {
    const res = await decide({
      platform: 'ios',
      foregroundState: 'denied',
      backgroundState: 'denied',
      userOptedOutForever: true, // ignored on iOS by design
    });
    expect(res.status).toBe(200);
    const d = res.body.decision;
    expect(d.recommendedAction).toBe('show_explanation_modal');
    expect(d.userMessage.key).toBe('geofence.permission.denied_one_time');
  });

  it('200 prompt → request permission inline', async () => {
    const res = await decide({
      platform: 'android',
      foregroundState: 'prompt',
      backgroundState: 'not_requested',
    });
    expect(res.status).toBe(200);
    const d = res.body.decision;
    expect(d.recommendedAction).toBe('request_permission_inline');
    expect(d.userMessage.key).toBe('geofence.permission.prompt_inline');
  });

  it('200 web-desktop → unsupported, use the mobile app', async () => {
    const res = await decide({
      platform: 'web-desktop',
      foregroundState: 'granted',
      backgroundState: 'granted_always',
    });
    expect(res.status).toBe(200);
    const d = res.body.decision;
    expect(d.canUseGeofence).toBe(false);
    expect(d.mustUseFallback).toBe(true);
    expect(d.recommendedAction).toBe('block_feature_with_explanation');
    expect(d.userMessage.key).toBe('geofence.permission.unsupported_desktop');
  });

  it('200 iOS restricted (MDM/parental controls) → open system settings', async () => {
    const res = await decide({
      platform: 'ios',
      foregroundState: 'restricted',
      backgroundState: 'not_requested',
    });
    expect(res.status).toBe(200);
    const d = res.body.decision;
    expect(d.canUseGeofence).toBe(false);
    expect(d.recommendedAction).toBe('open_system_settings');
    expect(d.userMessage.key).toBe('geofence.permission.restricted_ios');
  });

  it('200 is pure compute — the project doc is NOT mutated by the handler', async () => {
    const before = JSON.stringify(H.db!._dump());
    const res = await decide(GRANTED_FULL_BODY);
    expect(res.status).toBe(200);
    const after = JSON.stringify(H.db!._dump());
    // No writes: only the guard READS projects/{id}; the engine has no I/O.
    expect(after).toBe(before);
  });
});
