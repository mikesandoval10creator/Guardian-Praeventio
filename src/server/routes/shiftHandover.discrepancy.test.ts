// Praeventio Guard — shiftHandover router: POST /discrepancy behavioral test.
//
// Ticket 39aaa66d-73fe-81ba-a153-f6f80bef29d6 [P2] slice 2 — anti-stub:
// `addShiftHandoverDiscrepancy` (hook) hoy devuelve un shell vacio. Este
// test fija el contrato del endpoint REAL: persiste la discrepancia bajo
// `projects/{projectId}/shifts/{shiftId}/discrepancies/{idempotencyKey}`
// (doc determinista = idempotente) y devuelve el shift actualizado.

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const H = vi.hoisted(() => ({
  db: null as ReturnType<
    typeof import("../../__tests__/helpers/fakeFirestore").createFakeFirestore
  > | null,
}));

vi.mock("firebase-admin", async () => {
  const { adminMock } = await import("../../__tests__/helpers/fakeFirestore");
  return adminMock(() => H.db!);
});

vi.mock("../middleware/verifyAuth.js", () => ({
  verifyAuth: (
    req: import("express").Request,
    res: import("express").Response,
    next: import("express").NextFunction,
  ) => {
    const uid = req.header("x-test-uid");
    if (!uid) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.user = {
      uid,
      email: req.header("x-test-email") ?? null,
    } as import("express").Request["user"];
    next();
  },
}));

vi.mock("../middleware/captureRouteError.js", () => ({
  captureRouteError: vi.fn(),
}));
vi.mock("../../utils/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import shiftHandoverRouter from "./shiftHandover";
import { createFakeFirestore } from "../../__tests__/helpers/fakeFirestore";

const PREFIX = "/api/sprint-k";
const PROJECT = "p1";
const MEMBER = "member-1";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(PREFIX, shiftHandoverRouter);
  return app;
}

function seedProject(members: string[] = [MEMBER]) {
  H.db!._seed(`projects/${PROJECT}`, { members, createdBy: MEMBER });
}

function seedShift() {
  H.db!._seed(`projects/${PROJECT}/shifts/s1`, {
    id: "s1",
    projectId: PROJECT,
    kind: "morning",
    startedAt: "2026-08-01T08:00:00.000Z",
    supervisorUid: MEMBER,
    logEntries: [],
    handoverNotes: [],
  });
}

const asUser = (uid: string) => ({ "x-test-uid": uid });
const url = (suffix: string) => `${PREFIX}/${PROJECT}/shift-handover/${suffix}`;

describe("shiftHandoverRouter — POST /:projectId/shift-handover/:shiftId/discrepancy", () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    seedProject();
    seedShift();
  });

  it("401 without a token", async () => {
    const res = await request(buildApp()).post(url("s1/discrepancy"));
    expect(res.status).toBe(401);
  });

  it("403 when caller is not a project member", async () => {
    const res = await request(buildApp())
      .post(url("s1/discrepancy"))
      .set(asUser("stranger-9"))
      .send({ text: "discrepancia detectada en conteo", idempotencyKey: "k1" });
    expect(res.status).toBe(403);
  });

  it("400 with invalid body (short text)", async () => {
    const res = await request(buildApp())
      .post(url("s1/discrepancy"))
      .set(asUser(MEMBER))
      .send({ text: "x", idempotencyKey: "k1" });
    expect(res.status).toBe(400);
  });

  it("200 persists the discrepancy under the idempotency key and returns the shift", async () => {
    const res = await request(buildApp())
      .post(url("s1/discrepancy"))
      .set(asUser(MEMBER))
      .send({
        text: "El conteo de EPP no coincide con el inventario",
        idempotencyKey: "disc-abc-123",
      });

    expect(res.status).toBe(200);
    const body = res.body as { shift: { id: string } };
    expect(body.shift).toBeDefined();
    expect(body.shift.id).toBe("s1");

    // El doc determinista quedo escrito (idempotencia por clave).
    const writtenSnap = await H.db!.doc(
      `projects/${PROJECT}/shifts/s1/discrepancies/disc-abc-123`,
    ).get();
    expect(writtenSnap.data()).toMatchObject({
      text: "El conteo de EPP no coincide con el inventario",
      idempotencyKey: "disc-abc-123",
      authorUid: MEMBER,
    });
  });

  it("200 is idempotent: same key twice does not duplicate", async () => {
    const payload = {
      text: "Discrepancia unica para esta clave",
      idempotencyKey: "disc-same-key",
    };
    const app = buildApp();
    const first = await request(app)
      .post(url("s1/discrepancy"))
      .set(asUser(MEMBER))
      .send(payload);
    const second = await request(app)
      .post(url("s1/discrepancy"))
      .set(asUser(MEMBER))
      .send(payload);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const colSnap = await H.db!.collection(
      `projects/${PROJECT}/shifts/s1/discrepancies`,
    ).get();
    const docs = colSnap.docs.map((d) => d.id);
    expect(docs.filter((id) => id === "disc-same-key")).toHaveLength(1);
  });
});
