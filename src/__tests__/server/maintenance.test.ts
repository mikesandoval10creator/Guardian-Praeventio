// Real-router supertest for src/server/routes/maintenance.ts
// Plan v3 Fase 1 — raises line coverage on the 698-LOC maintenance surface
// (was 0 tests). Mounts the ACTUAL router through fakeFirestore so the real
// handler code (verifySchedulerToken gate, job delegation, resilience ping,
// project enumeration via iterateAllProjects) is exercised.
//
// All four endpoints use verifySchedulerToken (Cloud Scheduler bearer-secret
// gate). None use verifyAuth. No endpoint is user-facing.
//
// Mount point (from maintenance.ts line 6-7):
//   app.use('/api/maintenance', maintenanceRouter);

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── fake-admin hoisted holder + all vi.fn() mocks ────────────────────────────
// All variables referenced inside vi.mock() factories MUST be hoisted via
// vi.hoisted() to avoid "Cannot access before initialization" errors.

const H = vi.hoisted(() => ({
  db: null as ReturnType<typeof import('../helpers/fakeFirestore').createFakeFirestore> | null,
  // fake messaging
  fakeMessagingSendEach: vi.fn().mockResolvedValue({ successCount: 1, failureCount: 0, responses: [] }),
  // job mocks
  checkOverdueMaintenance: vi.fn(),
  checkExpiredPpe: vi.fn(),
  checkExpiredBrigadeResources: vi.fn(),
  sendSusesoReminders: vi.fn(),
  runCalendarPreWarnCron: vi.fn(),
  runResilienceHealthAlertCron: vi.fn(),
  runB2dMrrSnapshot: vi.fn(),
  runLoneWorkerEscalationCron: vi.fn(),
  runManDownEscalationCron: vi.fn(),
  runExceptionAutoExpire: vi.fn(),
  runWorkPermitAutoExpire: vi.fn(),
  runLegalCalendarReminders: vi.fn(),
  runDteIssueQueueDrain: vi.fn(),
  sendToProjectSupervisors: vi.fn(),
  fcmAdapterSendToTokens: vi.fn(),
  iterateAllProjects: vi.fn(),
  resolveProjectMemberTokens: vi.fn(),
  sendMulticastChunked: vi.fn(),
}));

// ── firebase-admin mock ───────────────────────────────────────────────────────

vi.mock('firebase-admin', async () => {
  const { adminMock } = await import('../helpers/fakeFirestore');
  const fakeMessaging = { sendEachForMulticast: H.fakeMessagingSendEach };
  const base = adminMock(() => H.db!);
  return {
    ...base,
    default: {
      ...base.default,
      messaging: () => fakeMessaging,
    },
    messaging: () => fakeMessaging,
  };
});

// ── verifySchedulerToken: accept "Bearer ok-secret" ──────────────────────────

vi.mock('../../server/middleware/verifySchedulerToken.js', () => ({
  verifySchedulerToken: (
    req: import('express').Request,
    res: import('express').Response,
    next: import('express').NextFunction,
  ) => {
    const auth = req.header('authorization') ?? '';
    if (auth !== 'Bearer ok-secret') {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  },
}));

// ── infrastructure mocks ──────────────────────────────────────────────────────

vi.mock('../../server/middleware/captureRouteError.js', () => ({
  captureRouteError: vi.fn(),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── domain job mocks ──────────────────────────────────────────────────────────

vi.mock('../../server/jobs/checkOverdueMaintenance.js', () => ({
  checkOverdueMaintenance: H.checkOverdueMaintenance,
}));

vi.mock('../../server/jobs/checkExpiredPpe.js', () => ({
  checkExpiredPpe: H.checkExpiredPpe,
}));

vi.mock('../../server/jobs/checkExpiredBrigadeResources.js', () => ({
  checkExpiredBrigadeResources: H.checkExpiredBrigadeResources,
}));

vi.mock('../../server/jobs/sendSusesoReminders.js', () => ({
  sendSusesoReminders: H.sendSusesoReminders,
}));

vi.mock('../../services/predictiveAlerts/calendarPreWarn.js', () => ({
  runCalendarPreWarnCron: H.runCalendarPreWarnCron,
}));

vi.mock('../../server/jobs/runResilienceHealthAlert.js', () => ({
  runResilienceHealthAlertCron: H.runResilienceHealthAlertCron,
}));

vi.mock('../../server/jobs/runB2dMrrSnapshot.js', () => ({
  runB2dMrrSnapshot: H.runB2dMrrSnapshot,
}));

vi.mock('../../server/jobs/runLoneWorkerEscalation.js', () => ({
  runLoneWorkerEscalationCron: H.runLoneWorkerEscalationCron,
}));

vi.mock('../../server/jobs/runManDownEscalation.js', () => ({
  runManDownEscalationCron: H.runManDownEscalationCron,
}));

vi.mock('../../server/jobs/runExceptionAutoExpire.js', () => ({
  runExceptionAutoExpire: H.runExceptionAutoExpire,
}));

vi.mock('../../server/jobs/runWorkPermitAutoExpire.js', () => ({
  runWorkPermitAutoExpire: H.runWorkPermitAutoExpire,
}));

vi.mock('../../server/jobs/runLegalCalendarReminders.js', () => ({
  runLegalCalendarReminders: H.runLegalCalendarReminders,
}));

// B5/B15 — DTE issue queue drain (fourth check-overdue step).
vi.mock('../../server/jobs/runDteIssueQueueDrain.js', () => ({
  runDteIssueQueueDrain: H.runDteIssueQueueDrain,
}));

// emergency.js re-exports sendToProjectSupervisors used by check-expired-ppe
vi.mock('../../server/routes/emergency.js', () => ({
  sendToProjectSupervisors: H.sendToProjectSupervisors,
}));

// fcmAdapter used by resilience-health notifyOps
vi.mock('../../services/notifications/fcmAdapter.js', () => ({
  fcmAdapter: { sendToTokens: H.fcmAdapterSendToTokens },
}));

// iterateAllProjects + resolveProjectMemberTokens + LONE_WORKER_ROLE_BUCKETS
vi.mock('../../server/services/projectTokens.js', () => ({
  iterateAllProjects: H.iterateAllProjects,
  resolveProjectMemberTokens: H.resolveProjectMemberTokens,
  LONE_WORKER_ROLE_BUCKETS: {
    supervisor: ['supervisor'],
    brigade: ['brigade'],
    emergency_services: ['emergency_services'],
  },
}));

// sendMulticastChunked (used by lone-worker + housekeeping FCM dispatch)
vi.mock('../../server/utils/fcmMulticast.js', () => ({
  sendMulticastChunked: H.sendMulticastChunked,
}));

// ── imports (after mocks) ─────────────────────────────────────────────────────

import maintenanceRouter from '../../server/routes/maintenance.js';
import { createFakeFirestore } from '../helpers/fakeFirestore';

// ── app factory ───────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/maintenance', maintenanceRouter);
  return app;
}

const AUTH = 'Bearer ok-secret';

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  H.db = createFakeFirestore();
  vi.clearAllMocks();

  H.fakeMessagingSendEach.mockResolvedValue({ successCount: 1, failureCount: 0, responses: [] });

  // Default happy stubs
  H.checkOverdueMaintenance.mockResolvedValue({ updated: 0, eventsFlipped: 0, skipped: 0 });
  H.checkExpiredPpe.mockResolvedValue({ scanned: 0, expired: 0, notified: 0, findingsCreated: 0 });
  H.checkExpiredBrigadeResources.mockResolvedValue({
    scanned: 0,
    expired: 0,
    notified: 0,
    findingsCreated: 0,
  });
  H.sendSusesoReminders.mockResolvedValue({
    scanned: 0,
    remindedTotal: 0,
    escalations: { green: 0, yellow: 0, orange: 0, red: 0, overdue: 0 },
  });
  H.runCalendarPreWarnCron.mockResolvedValue({ scanned: 0, warned: 0 });
  H.runResilienceHealthAlertCron.mockResolvedValue({
    overallStatus: 'healthy',
    alertFired: false,
    reportPersisted: true,
    subsystems: [],
    generatedAt: new Date().toISOString(),
  });
  H.runB2dMrrSnapshot.mockResolvedValue({
    monthKey: '2026-04',
    created: false,
    snapshot: { mrr: 0, arr: 0, customersActive: 0 },
  });
  H.runLoneWorkerEscalationCron.mockResolvedValue({
    sessionsScanned: 0,
    escalationsEmitted: 0,
    escalationsSkippedIdempotent: 0,
    byLevel: { supervisor: 0, brigade: 0, emergency_services: 0 },
    startedAtIso: new Date().toISOString(),
    finishedAtIso: new Date().toISOString(),
    errors: 0,
  });
  H.runManDownEscalationCron.mockResolvedValue({
    eventsScanned: 0,
    escalationsEmitted: 0,
    escalationsSkippedIdempotent: 0,
    byLevel: { supervisor: 0, brigade: 0, emergency_services: 0 },
    startedAtIso: new Date().toISOString(),
    finishedAtIso: new Date().toISOString(),
    errors: 0,
  });
  H.runExceptionAutoExpire.mockResolvedValue({ scanned: 0, expired: 0, errors: 0 });
  H.runWorkPermitAutoExpire.mockResolvedValue({ scanned: 0, expired: 0, errors: 0 });
  H.runLegalCalendarReminders.mockResolvedValue({
    scanned: 0,
    remindersEmitted: 0,
    skippedNotDue: 0,
    skippedIdempotent: 0,
    errors: 0,
  });
  H.runDteIssueQueueDrain.mockResolvedValue({
    gateClosed: true,
    scanned: 0,
    attempted: 0,
    issued: 0,
    retried: 0,
    permanentFailures: 0,
    skippedNotDue: 0,
    errors: 0,
  });
  H.iterateAllProjects.mockResolvedValue(0);
  H.resolveProjectMemberTokens.mockResolvedValue({ tokens: ['tkn-1'], emails: [] });
  H.sendMulticastChunked.mockResolvedValue({
    attempted: 1,
    successCount: 1,
    failureCount: 0,
    errorCount: 0,
    chunkCount: 1,
  });
  H.fcmAdapterSendToTokens.mockResolvedValue({ ok: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. POST /api/maintenance/check-overdue
//    Gate: verifySchedulerToken
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/maintenance/check-overdue', () => {
  const URL = '/api/maintenance/check-overdue';

  it('401 — missing Authorization header', async () => {
    const res = await request(buildApp()).post(URL).send();
    expect(res.status).toBe(401);
  });

  it('401 — wrong bearer secret', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', 'Bearer wrong-secret')
      .send();
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('200 — happy path: all 5 sub-jobs succeed, response shape is correct', async () => {
    H.checkOverdueMaintenance.mockResolvedValueOnce({ updated: 3, eventsFlipped: 3, skipped: 1 });
    H.checkExpiredPpe.mockResolvedValueOnce({ scanned: 10, expired: 2, notified: 2, findingsCreated: 2 });
    H.checkExpiredBrigadeResources.mockResolvedValueOnce({
      scanned: 4,
      expired: 1,
      notified: 1,
      findingsCreated: 1,
    });
    H.sendSusesoReminders.mockResolvedValueOnce({
      scanned: 5,
      remindedTotal: 3,
      escalations: { green: 1, yellow: 1, orange: 0, red: 1, overdue: 0 },
    });
    H.runCalendarPreWarnCron.mockResolvedValueOnce({ scanned: 20, warned: 4 });
    H.runResilienceHealthAlertCron.mockResolvedValueOnce({
      overallStatus: 'healthy',
      alertFired: false,
      reportPersisted: true,
      subsystems: [{ id: 'firestore', status: 'healthy' }],
      generatedAt: new Date().toISOString(),
    });

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBe(3);
    expect(res.body.eventsFlipped).toBe(3);
    expect(res.body.ppe).toMatchObject({ scanned: 10, expired: 2, notified: 2, findingsCreated: 2 });
    expect(res.body.brigadeResources).toMatchObject({
      scanned: 4,
      expired: 1,
      notified: 1,
      findingsCreated: 1,
    });
    expect(res.body.susesoReminders).toMatchObject({ scanned: 5, remindedTotal: 3 });
    expect(res.body.calendarPreWarn).toMatchObject({ scanned: 20, warned: 4 });
    expect(res.body.resilienceHealth).toMatchObject({ status: 'healthy', alertFired: false });
    expect(typeof res.body.tookMs).toBe('number');
  });

  it('200 — ppe sub-job throws: fault isolation, rest continue', async () => {
    H.checkOverdueMaintenance.mockResolvedValueOnce({ updated: 1, eventsFlipped: 1, skipped: 0 });
    H.checkExpiredPpe.mockRejectedValueOnce(new Error('ppe boom'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.updated).toBe(1);
    // ppe defaults to zeros because of isolation catch
    expect(res.body.ppe).toMatchObject({ scanned: 0, expired: 0, notified: 0 });
  });

  it('200 — brigade-resources sub-job throws: fault isolation, rest continue', async () => {
    H.checkExpiredBrigadeResources.mockRejectedValueOnce(new Error('brigade boom'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // brigadeResources defaults to zeros because of isolation catch
    expect(res.body.brigadeResources).toMatchObject({
      scanned: 0,
      expired: 0,
      notified: 0,
      findingsCreated: 0,
    });
  });

  it('200 — suseso sub-job throws: fault isolation', async () => {
    H.sendSusesoReminders.mockRejectedValueOnce(new Error('suseso boom'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.susesoReminders).toMatchObject({ scanned: 0, remindedTotal: 0 });
  });

  // ── B5/B15 — DTE issue queue drain step (mirrors the PPE mounting) ────────

  it('200 — dte-queue drain is invoked and its counts surface in the response', async () => {
    H.runDteIssueQueueDrain.mockResolvedValueOnce({
      gateClosed: false,
      scanned: 3,
      attempted: 2,
      issued: 1,
      retried: 1,
      permanentFailures: 0,
      skippedNotDue: 1,
      errors: 0,
    });

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(H.runDteIssueQueueDrain).toHaveBeenCalledTimes(1);
    expect(res.body.dteQueue).toMatchObject({
      gateClosed: false,
      scanned: 3,
      attempted: 2,
      issued: 1,
      retried: 1,
    });
  });

  it('200 — dte-queue drain throws: fault isolation, rest continue', async () => {
    H.runDteIssueQueueDrain.mockRejectedValueOnce(new Error('drain boom'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // dteQueue defaults to zeros because of the isolation catch.
    expect(res.body.dteQueue).toMatchObject({ scanned: 0, issued: 0, permanentFailures: 0 });
  });

  it('200 — calendar-prewarn sub-job throws: fault isolation', async () => {
    H.runCalendarPreWarnCron.mockRejectedValueOnce(new Error('prewarn boom'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.calendarPreWarn).toMatchObject({ scanned: 0, warned: 0 });
  });

  it('200 — resilience-health sub-job throws: fault isolation', async () => {
    H.runResilienceHealthAlertCron.mockRejectedValueOnce(new Error('health boom'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.resilienceHealth).toMatchObject({ status: 'unknown', alertFired: false });
  });

  it('500 — top-level checkOverdueMaintenance throws → 500 internal_error', async () => {
    H.checkOverdueMaintenance.mockRejectedValueOnce(new Error('db exploded'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('internal_error');
  });

  it('200 — resilience-health critical: fcmAdapter.sendToTokens called for admin tokens', async () => {
    // Seed an admin user with FCM tokens
    H.db!._seed('users/admin-uid-1', { role: 'admin', fcmTokens: ['token-admin-1'] });

    H.runResilienceHealthAlertCron.mockImplementationOnce(async (deps: { notifyOps: (report: unknown) => Promise<void> }) => {
      await deps.notifyOps({
        overallStatus: 'critical',
        alertFired: true,
        reportPersisted: false,
        subsystems: [{ id: 'firestore', status: 'critical', detail: 'down' }],
        generatedAt: new Date().toISOString(),
      });
      return {
        overallStatus: 'critical',
        alertFired: true,
        reportPersisted: false,
        subsystems: [{ id: 'firestore', status: 'critical', detail: 'down' }],
        generatedAt: new Date().toISOString(),
      };
    });

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(H.fcmAdapterSendToTokens).toHaveBeenCalledWith(
      expect.arrayContaining(['token-admin-1']),
      expect.objectContaining({ title: expect.stringContaining('crítico') }),
    );
    expect(res.body.resilienceHealth.alertFired).toBe(true);
  });

  it('200 — resilience-health critical: no admin tokens → no FCM call', async () => {
    // No admin users seeded → snap is empty → no tokens
    H.runResilienceHealthAlertCron.mockImplementationOnce(async (deps: { notifyOps: (report: unknown) => Promise<void> }) => {
      await deps.notifyOps({
        overallStatus: 'critical',
        alertFired: false,
        reportPersisted: false,
        subsystems: [{ id: 'firestore', status: 'critical', detail: 'down' }],
        generatedAt: new Date().toISOString(),
      });
      return {
        overallStatus: 'critical',
        alertFired: false,
        reportPersisted: false,
        subsystems: [],
        generatedAt: new Date().toISOString(),
      };
    });

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(H.fcmAdapterSendToTokens).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. POST /api/maintenance/run-b2d-mrr-snapshot
//    Gate: verifySchedulerToken
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/maintenance/run-b2d-mrr-snapshot', () => {
  const URL = '/api/maintenance/run-b2d-mrr-snapshot';

  it('401 — missing Authorization header', async () => {
    const res = await request(buildApp()).post(URL).send();
    expect(res.status).toBe(401);
  });

  it('401 — wrong bearer token', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', 'Bearer bad-secret')
      .send();
    expect(res.status).toBe(401);
  });

  it('200 — happy path: response shape matches B2D snapshot fields', async () => {
    H.runB2dMrrSnapshot.mockResolvedValueOnce({
      monthKey: '2026-04',
      created: true,
      snapshot: { mrr: 120_000, arr: 1_440_000, customersActive: 12 },
    });

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.monthKey).toBe('2026-04');
    expect(res.body.created).toBe(true);
    expect(res.body.mrr).toBe(120_000);
    expect(res.body.arr).toBe(1_440_000);
    expect(res.body.customersActive).toBe(12);
    expect(typeof res.body.tookMs).toBe('number');
  });

  it('200 — created:false when snapshot already exists (idempotent re-run)', async () => {
    H.runB2dMrrSnapshot.mockResolvedValueOnce({
      monthKey: '2026-04',
      created: false,
      snapshot: { mrr: 90_000, arr: 1_080_000, customersActive: 9 },
    });

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(false);
    expect(res.body.mrr).toBe(90_000);
  });

  it('500 — runB2dMrrSnapshot throws → 500 internal_error', async () => {
    H.runB2dMrrSnapshot.mockRejectedValueOnce(new Error('snapshot failed'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('internal_error');
    expect(res.body.message).toBe('b2d-mrr-snapshot failed');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. POST /api/maintenance/run-lone-worker-escalation
//    Gate: verifySchedulerToken
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/maintenance/run-lone-worker-escalation', () => {
  const URL = '/api/maintenance/run-lone-worker-escalation';

  it('401 — missing Authorization header', async () => {
    const res = await request(buildApp()).post(URL).send();
    expect(res.status).toBe(401);
  });

  it('401 — wrong bearer token', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', 'Bearer evil-secret')
      .send();
    expect(res.status).toBe(401);
  });

  it('200 — no projects: response shape correct with zero aggregates', async () => {
    H.iterateAllProjects.mockImplementationOnce(async () => 0);

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.projectsScanned).toBe(0);
    expect(res.body.sessionsScanned).toBe(0);
    expect(res.body.escalationsEmitted).toBe(0);
    expect(res.body.errors).toBe(0);
    expect(res.body.notifications).toMatchObject({
      attempted: 0, delivered: 0, failed: 0, chunks: 0, chunkErrors: 0,
    });
    expect(typeof res.body.tookMs).toBe('number');
  });

  it('200 — one project, cron emits 1 escalation: aggregates rolled up', async () => {
    H.iterateAllProjects.mockImplementationOnce(
      async (
        _db: unknown,
        _ps: unknown,
        onProject: (doc: unknown) => Promise<void>,
      ) => {
        const fakeDoc = {
          id: 'proj-lw-1',
          data: () => ({ tenantId: 'tenant-1' }),
        };
        await onProject(fakeDoc);
        return 1;
      },
    );
    H.runLoneWorkerEscalationCron.mockResolvedValueOnce({
      sessionsScanned: 5,
      escalationsEmitted: 1,
      escalationsSkippedIdempotent: 2,
      byLevel: { supervisor: 1, brigade: 0, emergency_services: 0 },
      startedAtIso: new Date().toISOString(),
      finishedAtIso: new Date().toISOString(),
      errors: 0,
    });

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.projectsScanned).toBe(1);
    expect(res.body.sessionsScanned).toBe(5);
    expect(res.body.escalationsEmitted).toBe(1);
    expect(res.body.byLevel.supervisor).toBe(1);
  });

  it('200 — per-project cron throws: errors counter incremented, overall 200', async () => {
    H.iterateAllProjects.mockImplementationOnce(
      async (
        _db: unknown,
        _ps: unknown,
        onProject: (doc: unknown) => Promise<void>,
      ) => {
        const fakeDoc = { id: 'proj-err', data: () => ({}) };
        await onProject(fakeDoc);
        return 1;
      },
    );
    H.runLoneWorkerEscalationCron.mockRejectedValueOnce(new Error('per-project crash'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.errors).toBe(1);
  });

  it('500 — iterateAllProjects itself throws → 500 internal_error', async () => {
    H.iterateAllProjects.mockRejectedValueOnce(new Error('iterate failed'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('internal_error');
    expect(res.body.message).toBe('lone-worker-escalation failed');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3b. POST /api/maintenance/run-man-down-escalation
//    Gate: verifySchedulerToken
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/maintenance/run-man-down-escalation', () => {
  const URL = '/api/maintenance/run-man-down-escalation';

  it('401 — missing Authorization header', async () => {
    const res = await request(buildApp()).post(URL).send();
    expect(res.status).toBe(401);
  });

  it('401 — wrong bearer token', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', 'Bearer evil-secret')
      .send();
    expect(res.status).toBe(401);
  });

  it('200 — no projects: response shape correct with zero aggregates', async () => {
    H.iterateAllProjects.mockImplementationOnce(async () => 0);

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.projectsScanned).toBe(0);
    expect(res.body.eventsScanned).toBe(0);
    expect(res.body.escalationsEmitted).toBe(0);
    expect(res.body.errors).toBe(0);
    expect(res.body.notifications).toMatchObject({
      attempted: 0, delivered: 0, failed: 0, chunks: 0, chunkErrors: 0,
    });
    expect(typeof res.body.tookMs).toBe('number');
  });

  it('200 — one project, cron emits 3 escalations: aggregates rolled up', async () => {
    H.iterateAllProjects.mockImplementationOnce(
      async (
        _db: unknown,
        _ps: unknown,
        onProject: (doc: unknown) => Promise<void>,
      ) => {
        const fakeDoc = { id: 'proj-md-1', data: () => ({ tenantId: 'tenant-1' }) };
        await onProject(fakeDoc);
        return 1;
      },
    );
    H.runManDownEscalationCron.mockResolvedValueOnce({
      eventsScanned: 2,
      escalationsEmitted: 3,
      escalationsSkippedIdempotent: 1,
      byLevel: { supervisor: 1, brigade: 1, emergency_services: 1 },
      startedAtIso: new Date().toISOString(),
      finishedAtIso: new Date().toISOString(),
      errors: 0,
    });

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.projectsScanned).toBe(1);
    expect(res.body.eventsScanned).toBe(2);
    expect(res.body.escalationsEmitted).toBe(3);
    expect(res.body.byLevel).toMatchObject({ supervisor: 1, brigade: 1, emergency_services: 1 });
  });

  it('200 — per-project cron throws: errors counter incremented, overall 200', async () => {
    H.iterateAllProjects.mockImplementationOnce(
      async (
        _db: unknown,
        _ps: unknown,
        onProject: (doc: unknown) => Promise<void>,
      ) => {
        const fakeDoc = { id: 'proj-err', data: () => ({}) };
        await onProject(fakeDoc);
        return 1;
      },
    );
    H.runManDownEscalationCron.mockRejectedValueOnce(new Error('per-project crash'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.errors).toBe(1);
  });

  it('200 — cron notify hook resolves tokens + multicasts (FCM wiring exercised)', async () => {
    // Drive the real notify closure: iterateAllProjects invokes perProject,
    // and the cron mock calls the provided notify with a supervisor escalation.
    H.iterateAllProjects.mockImplementationOnce(
      async (
        _db: unknown,
        _ps: unknown,
        onProject: (doc: unknown) => Promise<void>,
      ) => {
        const fakeDoc = { id: 'proj-md-2', data: () => ({}) };
        await onProject(fakeDoc);
        return 1;
      },
    );
    H.runManDownEscalationCron.mockImplementationOnce(
      async (deps: { notify?: (info: unknown) => Promise<void> }) => {
        await deps.notify?.({
          eventId: 'evt-9',
          workerId: 'w-9',
          workerName: 'Ana',
          level: 'supervisor',
          triggeredAtIso: '2026-05-12T11:58:00Z',
          message: 'Trabajador Ana caído o inmóvil — alerta supervisor (man down)',
          location: { lat: -33.45, lng: -70.66 },
        });
        return {
          eventsScanned: 1,
          escalationsEmitted: 1,
          escalationsSkippedIdempotent: 0,
          byLevel: { supervisor: 1, brigade: 0, emergency_services: 0 },
          startedAtIso: new Date().toISOString(),
          finishedAtIso: new Date().toISOString(),
          errors: 0,
        };
      },
    );

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(H.resolveProjectMemberTokens).toHaveBeenCalledWith(
      'proj-md-2',
      ['supervisor'],
      expect.anything(),
    );
    expect(H.sendMulticastChunked).toHaveBeenCalledOnce();
    const [, tokens, payload] = H.sendMulticastChunked.mock.calls[0];
    expect(tokens).toEqual(['tkn-1']);
    expect(payload.data).toMatchObject({
      kind: 'man_down_escalation',
      eventId: 'evt-9',
      level: 'supervisor',
      lat: '-33.45',
      lng: '-70.66',
    });
    expect(res.body.notifications.delivered).toBe(1);
  });

  it('500 — iterateAllProjects itself throws → 500 internal_error', async () => {
    H.iterateAllProjects.mockRejectedValueOnce(new Error('iterate failed'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('internal_error');
    expect(res.body.message).toBe('man-down-escalation failed');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. POST /api/maintenance/run-daily-housekeeping
//    Gate: verifySchedulerToken
// ═════════════════════════════════════════════════════════════════════════════

describe('POST /api/maintenance/run-daily-housekeeping', () => {
  const URL = '/api/maintenance/run-daily-housekeeping';

  it('401 — missing Authorization header', async () => {
    const res = await request(buildApp()).post(URL).send();
    expect(res.status).toBe(401);
  });

  it('401 — wrong bearer token', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', 'Bearer bad-key')
      .send();
    expect(res.status).toBe(401);
  });

  it('200 — no projects: all counters zero, shape correct', async () => {
    H.iterateAllProjects.mockImplementationOnce(async () => 0);

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.projectsScanned).toBe(0);
    expect(res.body.exceptions).toMatchObject({ scanned: 0, expired: 0, errors: 0 });
    expect(res.body.workPermits).toMatchObject({ scanned: 0, expired: 0, errors: 0 });
    expect(res.body.legalReminders).toMatchObject({
      scanned: 0, remindersEmitted: 0, skipped: 0, errors: 0,
    });
    expect(typeof res.body.tookMs).toBe('number');
  });

  it('200 — one project processed: all three sub-jobs aggregate correctly', async () => {
    H.iterateAllProjects.mockImplementationOnce(
      async (
        _db: unknown,
        _ps: unknown,
        onProject: (doc: unknown) => Promise<void>,
      ) => {
        const fakeDoc = {
          id: 'proj-house-1',
          data: () => ({ tenantId: 'tenant-hh' }),
        };
        await onProject(fakeDoc);
        return 1;
      },
    );
    H.runExceptionAutoExpire.mockResolvedValueOnce({ scanned: 10, expired: 3, errors: 0 });
    H.runWorkPermitAutoExpire.mockResolvedValueOnce({ scanned: 7, expired: 2, errors: 0 });
    H.runLegalCalendarReminders.mockResolvedValueOnce({
      scanned: 5,
      remindersEmitted: 2,
      skippedNotDue: 2,
      skippedIdempotent: 1,
      errors: 0,
    });

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.projectsScanned).toBe(1);
    expect(res.body.exceptions).toMatchObject({ scanned: 10, expired: 3, errors: 0 });
    expect(res.body.workPermits).toMatchObject({ scanned: 7, expired: 2, errors: 0 });
    expect(res.body.legalReminders).toMatchObject({ scanned: 5, remindersEmitted: 2 });
    // skipped = skippedNotDue + skippedIdempotent = 2+1 = 3
    expect(res.body.legalReminders.skipped).toBe(3);
  });

  it('200 — project with empty tenantId string falls back to projectId for work_permits path', async () => {
    H.iterateAllProjects.mockImplementationOnce(
      async (
        _db: unknown,
        _ps: unknown,
        onProject: (doc: unknown) => Promise<void>,
      ) => {
        const fakeDoc = {
          id: 'proj-no-tenant',
          data: () => ({ tenantId: '' }),
        };
        await onProject(fakeDoc);
        return 1;
      },
    );

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(H.runWorkPermitAutoExpire).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionPath: 'tenants/proj-no-tenant/projects/proj-no-tenant/work_permits',
      }),
    );
  });

  it('200 — project without tenantId field falls back to projectId', async () => {
    H.iterateAllProjects.mockImplementationOnce(
      async (
        _db: unknown,
        _ps: unknown,
        onProject: (doc: unknown) => Promise<void>,
      ) => {
        const fakeDoc = {
          id: 'proj-no-tid-field',
          data: () => ({}),
        };
        await onProject(fakeDoc);
        return 1;
      },
    );

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(H.runWorkPermitAutoExpire).toHaveBeenCalledWith(
      expect.objectContaining({
        collectionPath: 'tenants/proj-no-tid-field/projects/proj-no-tid-field/work_permits',
      }),
    );
  });

  it('200 — exception sub-job throws: errors incremented, other jobs still run', async () => {
    H.iterateAllProjects.mockImplementationOnce(
      async (
        _db: unknown,
        _ps: unknown,
        onProject: (doc: unknown) => Promise<void>,
      ) => {
        const fakeDoc = { id: 'proj-exc-err', data: () => ({ tenantId: 'tid' }) };
        await onProject(fakeDoc);
        return 1;
      },
    );
    H.runExceptionAutoExpire.mockRejectedValueOnce(new Error('exception job crashed'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.exceptions.errors).toBe(1);
    expect(H.runWorkPermitAutoExpire).toHaveBeenCalledTimes(1);
    expect(H.runLegalCalendarReminders).toHaveBeenCalledTimes(1);
  });

  it('200 — work_permit sub-job throws: errors incremented, other jobs still run', async () => {
    H.iterateAllProjects.mockImplementationOnce(
      async (
        _db: unknown,
        _ps: unknown,
        onProject: (doc: unknown) => Promise<void>,
      ) => {
        const fakeDoc = { id: 'proj-wp-err', data: () => ({ tenantId: 'tid' }) };
        await onProject(fakeDoc);
        return 1;
      },
    );
    H.runWorkPermitAutoExpire.mockRejectedValueOnce(new Error('work permit crashed'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.workPermits.errors).toBe(1);
    expect(H.runExceptionAutoExpire).toHaveBeenCalledTimes(1);
    expect(H.runLegalCalendarReminders).toHaveBeenCalledTimes(1);
  });

  it('200 — legal-reminders sub-job throws: errors incremented, other jobs still ran', async () => {
    H.iterateAllProjects.mockImplementationOnce(
      async (
        _db: unknown,
        _ps: unknown,
        onProject: (doc: unknown) => Promise<void>,
      ) => {
        const fakeDoc = { id: 'proj-lr-err', data: () => ({ tenantId: 'tid' }) };
        await onProject(fakeDoc);
        return 1;
      },
    );
    H.runLegalCalendarReminders.mockRejectedValueOnce(new Error('legal reminder crashed'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.legalReminders.errors).toBe(1);
    expect(H.runExceptionAutoExpire).toHaveBeenCalledTimes(1);
    expect(H.runWorkPermitAutoExpire).toHaveBeenCalledTimes(1);
  });

  it('200 — legalReminders.notifications field is present in response', async () => {
    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.legalReminders.notifications).toBeDefined();
    expect(typeof res.body.legalReminders.notifications.attempted).toBe('number');
  });

  it('500 — iterateAllProjects throws → 500 internal_error', async () => {
    H.iterateAllProjects.mockRejectedValueOnce(new Error('firestore down'));

    const res = await request(buildApp())
      .post(URL)
      .set('Authorization', AUTH)
      .send();

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('internal_error');
    expect(res.body.message).toBe('daily-housekeeping failed');
  });
});
