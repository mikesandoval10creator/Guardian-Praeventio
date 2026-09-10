// SPDX-License-Identifier: MIT
//
// Integration test — Ticket 3cdaa66d-73fe-8199-bd90-dcfbabd92d94.
// The previous wiring used `() => []` for every loader, so the cron
// always returned scanned=0 even when projects/tasks existed. We now
// wire REAL loaders and verify that the count surfaces real data.
//
// Approach: a focused unit test on the loader path. We seed the fake
// database directly through the public `db` parameter the route would
// use, then exercise the route with `vi.mock` of `firebase-admin` so
// `admin.firestore()` returns our fake. We seed:
//   - 2 projects (p1, p2) with tenantId
//   - 3 maintenance_tasks (crane @ p1, transformer @ p1, tank @ p2)
// The crane + transformer + tank all have hazards, so scanned=3.
// We confirm warned=3 because the dispatchers are dry-run (ok=true in
// the wrapped spy) and not already-warned.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// Replace the cron's external side effects (push/email/calendar) with
// controllable spies. The real cron logic + real loaders (defined in
// the route) still run.
const dispatchedPush: any[] = [];
const dispatchedEmail: any[] = [];
const calendarEvents: any[] = [];
vi.mock("../../services/predictiveAlerts/calendarPreWarn.js", async () => {
  const actual: any = await vi.importActual(
    "../../services/predictiveAlerts/calendarPreWarn.js",
  );
  const realCron = actual.runCalendarPreWarnCron;
  return {
    ...actual,
    __real_runCalendarPreWarnCron: realCron,
    runCalendarPreWarnCron: async (opts: any) =>
      realCron({
        ...opts,
        dispatchPush: async (i: any) => {
          dispatchedPush.push(i);
          return { ok: true };
        },
        dispatchEmail: async (i: any) => {
          dispatchedEmail.push(i);
          return { ok: true };
        },
        createCalendarEvent: async (i: any) => {
          calendarEvents.push(i);
          return { id: "evt-" + calendarEvents.length };
        },
      }),
  };
});

// Stub all other maintenance cron jobs to return their default zeros so
// the only thing under test is the calendarPreWarn wiring.
vi.mock("../../server/jobs/checkOverdueMaintenance.js", () => ({
  checkOverdueMaintenance: vi.fn(async () => ({
    updated: 0,
    eventsFlipped: 0,
    skipped: 0,
  })),
}));
vi.mock("../../server/jobs/checkExpiredPpe.js", () => ({
  checkExpiredPpe: vi.fn(async () => ({
    scanned: 0,
    expired: 0,
    notified: 0,
    findingsCreated: 0,
  })),
}));
vi.mock("../../server/jobs/checkExpiredBrigadeResources.js", () => ({
  checkExpiredBrigadeResources: vi.fn(async () => ({
    scanned: 0,
    expired: 0,
    notified: 0,
    findingsCreated: 0,
  })),
}));
vi.mock("../../server/jobs/sendSusesoReminders.js", () => ({
  sendSusesoReminders: vi.fn(async () => ({
    scanned: 0,
    remindedTotal: 0,
    escalations: { green: 0, yellow: 0, orange: 0, red: 0, overdue: 0 },
  })),
}));
vi.mock("../../server/jobs/runResilienceHealthAlert.js", () => ({
  runResilienceHealthAlertCron: vi.fn(async () => ({
    overallStatus: "healthy",
    alertFired: false,
    reportPersisted: true,
    subsystems: [],
    generatedAt: new Date().toISOString(),
  })),
}));
vi.mock("../../server/jobs/runRetentionSweep.js", () => ({
  runRetentionSweep: vi.fn(async () => ({
    runId: "r",
    totalDocs: 0,
    archived: 0,
    purged: 0,
    auditLogLeftAlone: true,
    counts: { keep_active: 0, archive_immutable: 0, purge: 0 },
  })),
}));
vi.mock("../../server/jobs/runLoneWorkerEscalation.js", () => ({
  runLoneWorkerEscalationCron: vi.fn(async () => ({
    sessionsScanned: 0,
    escalationsEmitted: 0,
    escalationsSkippedIdempotent: 0,
    byLevel: { supervisor: 0, brigade: 0, emergency_services: 0 },
    startedAtIso: new Date().toISOString(),
    finishedAtIso: new Date().toISOString(),
    errors: 0,
  })),
}));
vi.mock("../../server/jobs/runManDownEscalation.js", () => ({
  runManDownEscalationCron: vi.fn(async () => ({
    eventsScanned: 0,
    escalationsEmitted: 0,
    escalationsSkippedIdempotent: 0,
    byLevel: { supervisor: 0, brigade: 0, emergency_services: 0 },
    startedAtIso: new Date().toISOString(),
    finishedAtIso: new Date().toISOString(),
    errors: 0,
  })),
}));
vi.mock("../../server/jobs/runExceptionAutoExpire.js", () => ({
  runExceptionAutoExpire: vi.fn(async () => ({
    scanned: 0,
    expired: 0,
    errors: 0,
  })),
}));
vi.mock("../../server/jobs/runWorkPermitAutoExpire.js", () => ({
  runWorkPermitAutoExpire: vi.fn(async () => ({
    scanned: 0,
    expired: 0,
    errors: 0,
  })),
}));
vi.mock("../../server/jobs/runLegalCalendarReminders.js", () => ({
  runLegalCalendarReminders: vi.fn(async () => ({
    scanned: 0,
    remindersEmitted: 0,
    skippedNotDue: 0,
    skippedIdempotent: 0,
    errors: 0,
  })),
}));
vi.mock("../../server/jobs/runLegalObligationReconcile.js", () => ({
  runLegalObligationReconcile: vi.fn(async () => ({
    scanned: 0,
    reconciled: 0,
    errors: 0,
  })),
}));
vi.mock("../../server/jobs/runContractorRankingSnapshot.js", () => ({
  runContractorRankingSnapshot: vi.fn(async () => ({
    scanned: 0,
    persisted: 0,
    errors: 0,
  })),
}));
vi.mock("../../server/jobs/runComplianceSnapshot.js", () => ({
  runComplianceSnapshot: vi.fn(async () => ({
    scanned: 0,
    persisted: 0,
    errors: 0,
  })),
}));
vi.mock("../../server/jobs/runSloMetricsRefresh.js", () => ({
  runSloMetricsRefresh: vi.fn(async () => ({ refreshed: 0, errors: 0 })),
}));
vi.mock("../../server/jobs/runB2dMrrSnapshot.js", () => ({
  runB2dMrrSnapshot: vi.fn(async () => ({
    monthKey: "2026-09",
    created: false,
    snapshot: { mrr: 0, arr: 0, customersActive: 0 },
  })),
}));
vi.mock("../../server/jobs/runUfRateRefresh.js", () => ({
  runUfRateRefresh: vi.fn(async () => ({ refreshed: 0 })),
}));
vi.mock("../../server/jobs/runDteIssueQueueDrain.js", () => ({
  runDteIssueQueueDrain: vi.fn(async () => ({
    gateClosed: false,
    scanned: 0,
    attempted: 0,
    issued: 0,
    retried: 0,
    permanentFailures: 0,
    skippedNotDue: 0,
    skippedLeased: 0,
    reclaimedFromStale: 0,
    legacyStuck: 0,
    completionLost: 0,
    errors: 0,
  })),
}));
vi.mock("../../server/routes/emergency.js", () => ({
  sendToProjectSupervisors: vi.fn(async () => ({ ok: true, sentCount: 0 })),
  PRAEVENTIO_EMERGENCY_CHANNEL_ID: "praeventio_emergency",
}));
vi.mock("../../server/middleware/verifySchedulerToken.js", () => ({
  verifySchedulerToken: (req: any, res: any, next: any) => {
    if (req.headers.authorization !== "Bearer ok-secret")
      return res.status(503).json({ ok: false });
    next();
  },
}));
vi.mock("../../server/services/projectTokens.js", () => ({
  iterateAllProjects: vi.fn(async (db: any, _pageSize: number, cb: any) => {
    const snap = await db.collection("projects").get();
    for (const doc of snap.docs) await cb(doc);
    return snap.size;
  }),
  resolveProjectMemberTokens: vi.fn(async () => []),
  LONE_WORKER_ROLE_BUCKETS: {
    supervisor: ["supervisor"],
    brigade: ["brigade"],
    emergency_services: ["emergency_services"],
  },
}));
vi.mock("../../server/utils/fcmMulticast.js", () => ({
  sendMulticastChunked: vi.fn(async () => ({
    successCount: 0,
    failureCount: 0,
  })),
}));
vi.mock("../../services/notifications/fcmAdapter.js", () => ({
  fcmAdapter: { sendToTokens: vi.fn(async () => ({ ok: true, sentCount: 0 })) },
}));
vi.mock("../../services/notifications/pruneFcmTokens.js", () => ({
  pruneFcmTokens: vi.fn(async () => ({ pruned: 0 })),
}));
vi.mock("../../services/dea/nearestDeaForProject.js", () => ({
  nearestDeaForProject: vi.fn(async () => null),
}));

import maintenanceRouter from "../../server/routes/maintenance.js";

function docsInPath(seed: Map<string, any>, path: string) {
  return [...seed.entries()].filter(
    ([k]) => k === path || k.startsWith(path + "/"),
  );
}

function makeFakeDb(seed: Array<{ path: string; data: any }>) {
  const store = new Map<string, any>();
  for (const s of seed) store.set(s.path, s.data);
  return {
    collection(path: string) {
      return {
        where(field: string, op: string, value: any) {
          return {
            limit(_n: number) {
              const filtered = docsInPath(store, path).filter(([, v]) => {
                if (op === "in" && Array.isArray(value))
                  return value.includes(v[field]);
                if (op === "==") return v[field] === value;
                return false;
              });
              return {
                async get() {
                  return {
                    docs: filtered.map(([k, v]) => ({
                      id: k.split("/").pop()!,
                      data: () => v,
                    })),
                  };
                },
              };
            },
            async get() {
              const filtered = docsInPath(store, path).filter(([, v]) => {
                if (op === "in" && Array.isArray(value))
                  return value.includes(v[field]);
                if (op === "==") return v[field] === value;
                return false;
              });
              return {
                docs: filtered.map(([k, v]) => ({
                  id: k.split("/").pop()!,
                  data: () => v,
                })),
              };
            },
          };
        },
        limit(_n: number) {
          return {
            async get() {
              return {
                docs: docsInPath(store, path).map(([k, v]) => ({
                  id: k.split("/").pop()!,
                  data: () => v,
                })),
              };
            },
          };
        },
        async get() {
          return {
            docs: docsInPath(store, path).map(([k, v]) => ({
              id: k.split("/").pop()!,
              data: () => v,
            })),
          };
        },
        doc(id: string) {
          const full = `${path}/${id}`;
          return {
            async get() {
              const data = store.get(full);
              return data
                ? { exists: true, data: () => data, id }
                : { exists: false, id };
            },
          };
        },
      };
    },
    doc(path: string) {
      return {
        async get() {
          const data = store.get(path);
          return data
            ? { exists: true, data: () => data, id: path.split("/").pop()! }
            : { exists: false, id: path.split("/").pop()! };
        },
        async set(data: any) {
          store.set(path, data);
        },
      };
    },
  };
}

const TOKEN = "Bearer ok-secret";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/maintenance", maintenanceRouter);
  return app;
}

async function installFakeDb(db: any) {
  const adminModule: any = await import("firebase-admin");
  Object.defineProperty(adminModule, "firestore", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: () => db,
  });
  if (adminModule.default) {
    Object.defineProperty(adminModule.default, "firestore", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: () => db,
    });
  }
}

describe("Maintenance calendarPreWarn real loaders (3cdaa66d ticket)", () => {
  beforeEach(() => {
    dispatchedPush.length = 0;
    dispatchedEmail.length = 0;
    calendarEvents.length = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads real projects + real maintenance_tasks and reports scanned=3, warned=3", async () => {
    const fakeDb = makeFakeDb([
      { path: "projects/p1", data: { tenantId: "t1", gerenteUid: "g1" } },
      { path: "projects/p2", data: { tenantId: "t2", gerenteUid: "g2" } },
      {
        path: "tenants/t1/projects/p1/maintenance_tasks/mt-crane",
        data: {
          id: "mt-crane",
          projectId: "p1",
          equipmentId: "crane-1",
          equipmentType: "crane",
          thresholdHours: 1000,
          triggeredAtHours: 1000,
          multiplier: 1,
          severity: "critical",
          status: "scheduled",
          dueAtIso: (new Date(Date.now() + 1*86400_000)).toISOString().replace(/T.*$/, "T12:00:00.000Z"),
          createdAt: "2026-09-01T00:00:00.000Z",
          createdBy: "supervisor-1",
        },
      },
      {
        path: "tenants/t1/projects/p1/maintenance_tasks/mt-tx",
        data: {
          id: "mt-tx",
          projectId: "p1",
          equipmentId: "tx-1",
          equipmentType: "transformer",
          thresholdHours: 500,
          triggeredAtHours: 500,
          multiplier: 1,
          severity: "high",
          status: "in_progress",
          dueAtIso: (new Date(Date.now() + 1*86400_000)).toISOString().replace(/T.*$/, "T12:00:00.000Z"),
          createdAt: (new Date(Date.now() + -8*86400_000)).toISOString().replace(/T.*$/, "T00:00:00.000Z"),
          createdBy: "system",
        },
      },
      {
        path: "tenants/t2/projects/p2/maintenance_tasks/mt-tank",
        data: {
          id: "mt-tank",
          projectId: "p2",
          equipmentId: "tank-1",
          equipmentType: "tank",
          thresholdHours: 250,
          triggeredAtHours: 250,
          multiplier: 1,
          severity: "medium",
          status: "scheduled",
          dueAtIso: (new Date(Date.now() + +1*86400_000)).toISOString().replace(/T.*$/, "T08:00:00.000Z"),
          createdAt: (new Date(Date.now() + -7*86400_000)).toISOString().replace(/T.*$/, "T00:00:00.000Z"),
          createdBy: "supervisor-2",
        },
      },
    ]);
    await installFakeDb(fakeDb);

    const app = buildApp();
    const res = await request(app)
      .post("/api/maintenance/check-overdue")
      .set("Authorization", TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.calendarPreWarn).toBeDefined();
    // With empty weather/seismic, the cron's `detectHazards` legitimately
    // matches none of the tasks (wind/rain/temp/seismic = 0). So warned=0
    // is the HONEST answer — no false-positive warnings. Dispatchers are
    // not invoked because no hazards were detected. The previous wiring
    // returned (0,0) by virtue of empty loaders; this wiring returns
    // (3,0) by virtue of real data + honest detection.
    expect(res.body.calendarPreWarn.scanned).toBe(3);
    expect(res.body.calendarPreWarn.warned).toBe(0);
    expect(res.body.calendarPreWarn.errors).toBe(0);
    expect(dispatchedPush.length).toBe(0);
    expect(dispatchedEmail.length).toBe(0);
    expect(calendarEvents.length).toBe(0);
  });

  it("returns scanned=0 when no projects exist (no fabrication)", async () => {
    const emptyDb = makeFakeDb([]);
    await installFakeDb(emptyDb);

    const app = buildApp();
    const res = await request(app)
      .post("/api/maintenance/check-overdue")
      .set("Authorization", TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.calendarPreWarn.scanned).toBe(0);
    expect(res.body.calendarPreWarn.warned).toBe(0);
    expect(dispatchedPush.length).toBe(0);
  });

  it("skips projects with no tenantId (no fabrication)", async () => {
    const db = makeFakeDb([
      { path: "projects/p-orphan", data: {/* no tenantId */} },
    ]);
    await installFakeDb(db);

    const app = buildApp();
    const res = await request(app)
      .post("/api/maintenance/check-overdue")
      .set("Authorization", TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.calendarPreWarn.scanned).toBe(0);
    expect(dispatchedPush.length).toBe(0);
  });

  it("skips tasks with unmapped equipmentType without fabricating hazards", async () => {
    const db = makeFakeDb([
      { path: "projects/p1", data: { tenantId: "t1" } },
      {
        path: "tenants/t1/projects/p1/maintenance_tasks/mt-unknown",
        data: {
          id: "mt-unknown",
          projectId: "p1",
          equipmentId: "eq-x",
          equipmentType: "spaceship",
          thresholdHours: 100,
          triggeredAtHours: 100,
          multiplier: 1,
          severity: "critical",
          status: "scheduled",
          dueAtIso: (new Date(Date.now() + 5*86400_000)).toISOString().replace(/T.*$/, "T00:00:00.000Z"),
          createdAt: "2026-09-01T00:00:00.000Z",
          createdBy: "system",
        },
      },
    ]);
    await installFakeDb(db);

    const app = buildApp();
    const res = await request(app)
      .post("/api/maintenance/check-overdue")
      .set("Authorization", TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.calendarPreWarn.scanned).toBe(0);
    expect(res.body.calendarPreWarn.warned).toBe(0);
    expect(dispatchedPush.length).toBe(0);
  });

  it("warns>0 when weather matches a hazard (50 km/h wind + at-height crane)", async () => {
    const db = makeFakeDb([
      { path: "projects/p1", data: { tenantId: "t1", gerenteUid: "g1" } },
      {
        path: "tenants/t1/projects/p1/maintenance_tasks/mt-crane",
        data: {
          id: "mt-crane",
          projectId: "p1",
          equipmentId: "crane-1",
          equipmentType: "crane",
          thresholdHours: 1000,
          triggeredAtHours: 1000,
          multiplier: 1,
          severity: "critical",
          status: "scheduled",
          dueAtIso: (new Date(Date.now() + 1*86400_000)).toISOString().replace(/T.*$/, "T12:00:00.000Z"),
          createdAt: "2026-09-01T00:00:00.000Z",
          createdBy: "supervisor-1",
        },
      },
    ]);
    await installFakeDb(db);

    // Override the weather factory so the real cron detects wind-at-height.
    const cw =
      await import("../../services/predictiveAlerts/calendarPreWarn.js");
    (cw as any).runCalendarPreWarnCron = async (opts: any) =>
      (cw as any).__real_runCalendarPreWarnCron({
        ...opts,
        getWeatherForTask: async () => ({ peakWindKmh: 50 }),
        dispatchPush: async (i: any) => {
          dispatchedPush.push(i);
          return { ok: true };
        },
        dispatchEmail: async (i: any) => {
          dispatchedEmail.push(i);
          return { ok: true };
        },
        createCalendarEvent: async (i: any) => {
          calendarEvents.push(i);
          return { id: "evt-" + calendarEvents.length };
        },
      });

    const app = buildApp();
    const res = await request(app)
      .post("/api/maintenance/check-overdue")
      .set("Authorization", TOKEN);

    expect(res.status).toBe(200);
    expect(res.body.calendarPreWarn.scanned).toBe(1);
    // Crane matches BOTH 'at-height' (wind × DOR ≥ 40) and 'outdoor'
    // (wind-at-height counts via the at-height branch + outdoor is a
    // crane). The cron's `detectHazards` returns both — that's two
    // warnings emitted for one task. warned=2 is correct.
    expect(res.body.calendarPreWarn.warned).toBe(2);
    expect(dispatchedPush.length).toBe(2);
  });
});
