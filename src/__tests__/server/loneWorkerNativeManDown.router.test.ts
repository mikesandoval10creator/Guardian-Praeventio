// Native ManDown capability contract: the Android foreground service never
// receives a Firebase credential. It may report only a short-lived, one-time
// session-bound capability, and the server re-checks the persisted session.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import request from "supertest";

const H = vi.hoisted(() => ({
  db: null as ReturnType<
    typeof import("../helpers/fakeFirestore").createFakeFirestore
  > | null,
}));

vi.mock("firebase-admin", async () => {
  const { adminMock } = await import("../helpers/fakeFirestore");
  return adminMock(() => H.db!);
});

vi.mock("../../server/middleware/verifyAuth.js", () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header("x-test-uid");
    if (!uid) return void res.status(401).json({ error: "unauthorized" });
    (req as Request & { user: Record<string, unknown> }).user = { uid };
    next();
  },
}));
vi.mock("../../server/middleware/captureRouteError.js", () => ({
  captureRouteError: vi.fn(),
}));
vi.mock("../../utils/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import loneWorkerRouter from "../../server/routes/loneWorker.js";
import { createFakeFirestore } from "../helpers/fakeFirestore";

const PROJECT = "project-native";
const UID = "worker-native";
const SESSION = "session-native";
const base = `/api/${PROJECT}/lone-worker/${SESSION}`;

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", loneWorkerRouter);
  return a;
}

function seedActiveSession() {
  H.db!._seed(`projects/${PROJECT}`, { members: [UID], createdBy: UID });
  H.db!._seed(`projects/${PROJECT}/lone_worker_sessions/${SESSION}`, {
    id: SESSION,
    workerUid: UID,
    status: "active",
    startedAt: "2026-08-13T15:00:00.000Z",
    checkInIntervalMin: 15,
    checkIns: [],
  });
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedActiveSession();
});

describe("native ManDown foreground capability", () => {
  it("mints a short-lived opaque capability only for the session owner", async () => {
    const res = await request(app())
      .post(`${base}/native-mandown-capability`)
      .set("x-test-uid", UID)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sessionId: SESSION,
      expiresAt: expect.any(String),
    });
    expect(res.body.capability).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const stored =
      H.db!._dump()[`projects/${PROJECT}/lone_worker_sessions/${SESSION}`];
    expect(stored.nativeManDownCapabilityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(res.body.capability);
  });

  it("rejects another project member from minting a worker capability", async () => {
    H.db!._seed(`projects/${PROJECT}`, {
      members: [UID, "other-member"],
      createdBy: UID,
    });
    const res = await request(app())
      .post(`${base}/native-mandown-capability`)
      .set("x-test-uid", "other-member")
      .send({});
    expect(res.status).toBe(409);
  });

  it("deduplicates a replay while allowing a later distinct trigger in the same open session", async () => {
    const cap = await request(app())
      .post(`${base}/native-mandown-capability`)
      .set("x-test-uid", UID)
      .send({});

    const payload = {
      clientEventId: "11111111-1111-4111-8111-111111111111",
      kind: "impact",
      occurredAt: new Date().toISOString(),
      accelerationMps2: 28,
    };
    const accepted = await request(app())
      .post(`${base}/native-man-down`)
      .set("x-mandown-capability", cap.body.capability)
      .send(payload);
    expect(accepted.status).toBe(202);
    expect(accepted.body).toMatchObject({
      accepted: true,
      eventId: expect.any(String),
    });

    const events = Object.entries(H.db!._dump()).filter(([k]) =>
      k.startsWith(`projects/${PROJECT}/mandown_events/`),
    );
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({
      sessionId: SESSION,
      workerId: UID,
      status: "active",
      source: "android_foreground_service",
      trigger: "impact",
    });

    const replay = await request(app())
      .post(`${base}/native-man-down`)
      .set("x-mandown-capability", cap.body.capability)
      .send(payload);
    expect(replay.status).toBe(202);
    expect(replay.body).toMatchObject({ accepted: true, duplicate: true });
    const distinctTrigger = await request(app())
      .post(`${base}/native-man-down`)
      .set("x-mandown-capability", cap.body.capability)
      .send({
        clientEventId: "55555555-5555-4555-8555-555555555555",
        kind: "inactivity",
        occurredAt: new Date().toISOString(),
        inactivityMs: 30_000,
      });
    expect(distinctTrigger.status).toBe(202);
    expect(distinctTrigger.body).toMatchObject({ accepted: true });
    expect(
      Object.keys(H.db!._dump()).filter((k) =>
        k.startsWith(`projects/${PROJECT}/mandown_events/`),
      ),
    ).toHaveLength(2);
  });

  it("accepts an alert captured before temporary network loss while the session capability is still valid", async () => {
    const cap = await request(app())
      .post(`${base}/native-mandown-capability`)
      .set("x-test-uid", UID)
      .send({});

    // The Android outbox may retry after the WebView has been suspended. The
    // event time is preserved; validity comes from the session-bound capability,
    // not an arbitrary five-minute transport deadline.
    const capturedAt = new Date(Date.now() - 10 * 60_000).toISOString();
    const res = await request(app())
      .post(`${base}/native-man-down`)
      .set("x-mandown-capability", cap.body.capability)
      .send({
        clientEventId: "22222222-2222-4222-8222-222222222222",
        kind: "impact",
        occurredAt: capturedAt,
        accelerationMps2: 28,
      });

    expect(res.status).toBe(202);
  });

  it("keeps a capability valid through overdue status, but fails closed after explicit end", async () => {
    const cap = await request(app())
      .post(`${base}/native-mandown-capability`)
      .set("x-test-uid", UID)
      .send({});

    H.db!._seed(`projects/${PROJECT}/lone_worker_sessions/${SESSION}`, {
      id: SESSION,
      workerUid: UID,
      status: "overdue_critical",
      startedAt: "2026-08-13T15:00:00.000Z",
      checkInIntervalMin: 15,
      checkIns: [],
      nativeManDownCapabilityHash:
        H.db!._dump()[`projects/${PROJECT}/lone_worker_sessions/${SESSION}`]
          .nativeManDownCapabilityHash,
      nativeManDownCapabilityExpiresAt:
        H.db!._dump()[`projects/${PROJECT}/lone_worker_sessions/${SESSION}`]
          .nativeManDownCapabilityExpiresAt,
    });
    const acceptedWhileOverdue = await request(app())
      .post(`${base}/native-man-down`)
      .set("x-mandown-capability", cap.body.capability)
      .send({
        clientEventId: "33333333-3333-4333-8333-333333333333",
        kind: "impact",
        occurredAt: new Date().toISOString(),
        accelerationMps2: 28,
      });
    expect(acceptedWhileOverdue.status).toBe(202);
  });

  it("fails closed after the session doc is marked ended, even if the capability still hashes", async () => {
    const cap = await request(app())
      .post(`${base}/native-mandown-capability`)
      .set("x-test-uid", UID)
      .send({});
    H.db!._seed(`projects/${PROJECT}/lone_worker_sessions/${SESSION}`, {
      id: SESSION,
      workerUid: UID,
      status: "ended",
      startedAt: "2026-08-13T15:00:00.000Z",
      endedAt: "2026-08-13T15:01:00.000Z",
      checkInIntervalMin: 15,
      checkIns: [],
    });
    const res = await request(app())
      .post(`${base}/native-man-down`)
      .set("x-mandown-capability", cap.body.capability)
      .send({
        clientEventId: "44444444-4444-4444-8444-444444444444",
        kind: "impact",
        occurredAt: new Date().toISOString(),
        accelerationMps2: 28,
      });
    expect(res.status).toBe(409);
  });

  it("end-session is pure-compute: returns 200 even when no Firestore session exists", async () => {
    H.db = createFakeFirestore();
    H.db!._seed(`projects/${PROJECT}`, { members: [UID], createdBy: UID });
    const res = await request(app())
      .post(`/api/${PROJECT}/lone-worker/end-session`)
      .set("x-test-uid", UID)
      .send({
        session: {
          id: SESSION,
          workerUid: UID,
          status: "active",
          startedAt: "2026-08-13T15:00:00.000Z",
          checkInIntervalMin: 15,
          checkIns: [],
        },
        endedAt: "2026-08-13T15:01:00.000Z",
      });
    expect(res.status).toBe(200);
    expect(res.body.session).toMatchObject({
      id: SESSION,
      status: "ended",
      endedAt: "2026-08-13T15:01:00.000Z",
    });
    expect(res.body.session.nativeManDownCapabilityHash).toBeUndefined();
  });
});
