// Native lone-worker heartbeat contract.
//
// The Android service has no Firebase token. It may only use a short-lived,
// session-bound capability and a stable event id. The server must append the
// authoritative heartbeat to the canonical session exactly once, keep the
// worker's location when supplied, and fail closed after session end.
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

const PROJECT = "project-native-heartbeat";
const UID = "worker-native-heartbeat";
const SESSION = "session-native-heartbeat";
const BASE = `/api/${PROJECT}/lone-worker/${SESSION}`;
const CAPABILITY_HEADER = "x-lone-worker-capability";

function app() {
  const a = express();
  a.use(express.json());
  a.use("/api", loneWorkerRouter);
  return a;
}

function sessionPath(sessionId = SESSION) {
  return `projects/${PROJECT}/lone_worker_sessions/${sessionId}`;
}

function seedActiveSession(sessionId = SESSION, workerUid = UID) {
  H.db!._seed(`projects/${PROJECT}`, {
    members: [workerUid],
    createdBy: workerUid,
  });
  H.db!._seed(sessionPath(sessionId), {
    id: sessionId,
    workerUid,
    status: "active",
    startedAt: "2026-08-13T15:00:00.000Z",
    checkInIntervalMin: 15,
    checkIns: [],
  });
}

async function mintCapability() {
  return request(app())
    .post(`${BASE}/native-lone-worker-capability`)
    .set("x-test-uid", UID)
    .send({});
}

beforeEach(() => {
  H.db = createFakeFirestore();
  seedActiveSession();
});

describe("native lone-worker heartbeat", () => {
  it("mints an opaque capability bound to the open session", async () => {
    const res = await mintCapability();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sessionId: SESSION,
      expiresAt: expect.any(String),
    });
    expect(res.body.capability).toMatch(/^[A-Za-z0-9_-]{32,}$/);

    const stored = H.db!._dump()[sessionPath()];
    expect(stored.nativeLoneWorkerCapabilityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(res.body.capability);
  });

  it("rejects a heartbeat without the native capability", async () => {
    const res = await request(app())
      .post(`${BASE}/native-lone-worker-heartbeat`)
      .send({
        clientEventId: "11111111-1111-4111-8111-111111111111",
        capturedAt: new Date().toISOString(),
      });

    expect(res.status).toBe(401);
  });

  it("accepts a heartbeat, stamps server time, and persists location", async () => {
    const cap = await mintCapability();
    const capturedAt = new Date(Date.now() - 2_000).toISOString();
    const res = await request(app())
      .post(`${BASE}/native-lone-worker-heartbeat`)
      .set(CAPABILITY_HEADER, cap.body.capability)
      .send({
        clientEventId: "22222222-2222-4222-8222-222222222222",
        capturedAt,
        lat: -33.4489,
        lng: -70.6693,
      });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({
      accepted: true,
      eventId: expect.any(String),
      serverAt: expect.any(String),
    });

    const stored = H.db!._dump()[sessionPath()] as {
      checkIns: Array<Record<string, unknown>>;
      lastKnownLocation?: unknown;
      [key: string]: unknown;
    };
    expect(stored.checkIns).toHaveLength(1);
    expect(stored.checkIns[0]).toMatchObject({
      status: "ok",
      lat: -33.4489,
      lng: -70.6693,
    });
    expect(stored.checkIns[0].at).toBe(res.body.serverAt);
    expect(stored.lastKnownLocation).toEqual({
      lat: -33.4489,
      lng: -70.6693,
      at: res.body.serverAt,
    });

    const events = Object.entries(H.db!._dump()).filter(([key]) =>
      key.startsWith(`projects/${PROJECT}/lone_worker_heartbeat_events/`),
    );
    expect(events).toHaveLength(1);
    expect(events[0][1]).toMatchObject({
      projectId: PROJECT,
      sessionId: SESSION,
      workerUid: UID,
      source: "android_lone_worker_service",
      clientEventId: "22222222-2222-4222-8222-222222222222",
    });
    expect(JSON.stringify(events[0][1])).not.toContain(cap.body.capability);
  });

  it("accepts a heartbeat without location and keeps help_requested terminal intent", async () => {
    const cap = await mintCapability();
    H.db!._seed(sessionPath(), {
      ...H.db!._dump()[sessionPath()],
      status: "help_requested",
      checkIns: [{ at: "2026-08-13T15:05:00.000Z", status: "help" }],
    });

    const res = await request(app())
      .post(`${BASE}/native-lone-worker-heartbeat`)
      .set(CAPABILITY_HEADER, cap.body.capability)
      .send({
        clientEventId: "33333333-3333-4333-8333-333333333333",
        capturedAt: new Date().toISOString(),
      });

    expect(res.status).toBe(202);
    const stored = H.db!._dump()[sessionPath()] as {
      checkIns: Array<Record<string, unknown>>;
      lastKnownLocation?: unknown;
      [key: string]: unknown;
    };
    expect(stored.checkIns).toHaveLength(2);
    expect(stored.checkIns[1]).toEqual({ at: res.body.serverAt, status: "ok" });
    expect(stored.lastKnownLocation).toBeUndefined();
    expect(stored.status).toBe("help_requested");
  });

  it("is idempotent for a replay and appends only once", async () => {
    const cap = await mintCapability();
    const payload = {
      clientEventId: "44444444-4444-4444-8444-444444444444",
      capturedAt: new Date().toISOString(),
      lat: -33.45,
      lng: -70.66,
    };

    const first = await request(app())
      .post(`${BASE}/native-lone-worker-heartbeat`)
      .set(CAPABILITY_HEADER, cap.body.capability)
      .send(payload);
    const replay = await request(app())
      .post(`${BASE}/native-lone-worker-heartbeat`)
      .set(CAPABILITY_HEADER, cap.body.capability)
      .send(payload);

    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(replay.body).toMatchObject({ accepted: true, duplicate: true });
    expect(
      H.db!._dump()[sessionPath()].checkIns as unknown[],
    ).toHaveLength(1);
  });

  it("fails closed after end-session and revokes the lone-worker capability", async () => {
    const cap = await mintCapability();
    const ended = await request(app())
      .post(`/api/${PROJECT}/lone-worker/end-session`)
      .set("x-test-uid", UID)
      .send({ sessionId: SESSION });

    expect(ended.status).toBe(200);
    const stored = H.db!._dump()[sessionPath()];
    expect(stored.nativeLoneWorkerCapabilityHash).toBeUndefined();
    expect(stored.nativeLoneWorkerCapabilityExpiresAt).toBeUndefined();

    const heartbeat = await request(app())
      .post(`${BASE}/native-lone-worker-heartbeat`)
      .set(CAPABILITY_HEADER, cap.body.capability)
      .send({
        clientEventId: "55555555-5555-4555-8555-555555555555",
        capturedAt: new Date().toISOString(),
      });
    expect(heartbeat.status).toBe(409);
  });

  it("rejects a materially future device timestamp", async () => {
    const cap = await mintCapability();
    const res = await request(app())
      .post(`${BASE}/native-lone-worker-heartbeat`)
      .set(CAPABILITY_HEADER, cap.body.capability)
      .send({
        clientEventId: "66666666-6666-4666-8666-666666666666",
        capturedAt: new Date(Date.now() + 6 * 60_000).toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("native_lone_worker_invalid_timestamp");
  });
});
