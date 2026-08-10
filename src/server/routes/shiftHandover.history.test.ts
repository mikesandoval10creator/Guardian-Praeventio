// Praeventio Guard — shiftHandover router: GET /history behavioral test.
//
// Ticket 39aaa66d-73fe-81ba-a153-f6f80bef29d6 [P2] — anti-stub:
// ShiftHandoverHistoryList consume `fetchShiftHandoverHistory` que hoy
// devuelve { shifts: [] } siempre. Este test fija el contrato del endpoint
// REAL que reemplaza al stub: lee shifts de Firestore, computa quality
// server-side, pagina y devuelve { shifts: ShiftHandoverEntry[] }.

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

const asUser = (uid: string) => ({ "x-test-uid": uid });
const url = (suffix: string) => `${PREFIX}/${PROJECT}/shift-handover/${suffix}`;

function seedShift(
  id: string,
  startedAt: string,
  opts: { notes?: number; urgent?: number; acked?: boolean } = {},
) {
  H.db!._seed(`projects/${PROJECT}/shifts/${id}`, {
    id,
    projectId: PROJECT,
    kind: "morning",
    startedAt,
    supervisorUid: MEMBER,
    logEntries: [],
    handoverNotes: Array.from({ length: opts.notes ?? 1 }, (_, i) => ({
      category: "observation" as const,
      text: `nota-${i}`,
      severity: (opts.urgent && i === 0 ? "urgent" : "info") as
        "info" | "urgent",
    })),
    ...(opts.acked
      ? {
          acknowledgedByUid: "other-1",
          acknowledgedAt: "2026-08-01T00:00:00.000Z",
        }
      : {}),
  });
}

describe("shiftHandoverRouter — GET /:projectId/shift-handover/history", () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    seedProject();
  });

  it("401 without a token", async () => {
    const res = await request(buildApp()).get(url("history"));
    expect(res.status).toBe(401);
  });

  it("403 when caller is not a project member", async () => {
    const res = await request(buildApp())
      .get(url("history"))
      .set(asUser("stranger-9"));
    expect(res.status).toBe(403);
  });

  it("200 returns shifts with server-computed quality, newest first", async () => {
    seedShift("sh-old", "2026-07-01T08:00:00.000Z", { notes: 1 });
    seedShift("sh-new", "2026-08-01T08:00:00.000Z", { notes: 2, urgent: 1 });

    const res = await request(buildApp())
      .get(url("history?days=90"))
      .set(asUser(MEMBER));

    expect(res.status).toBe(200);
    const { shifts } = res.body as {
      shifts: {
        shift: { id: string };
        quality: { qualityScore: number; urgentNotes: number };
      }[];
    };
    expect(Array.isArray(shifts)).toBe(true);
    expect(shifts).toHaveLength(2);
    // newest first
    expect(shifts[0].shift.id).toBe("sh-new");
    expect(shifts[1].shift.id).toBe("sh-old");
    // quality server-side real: sh-new has urgent note + 2 notes
    expect(shifts[0].quality.urgentNotes).toBe(1);
    expect(shifts[0].quality.qualityScore).toBeGreaterThan(0);
    expect(typeof shifts[0].quality.qualityScore).toBe("number");
  });

  it("200 respects ?days= filter (excludes older shifts)", async () => {
    seedShift("sh-recent", "2026-08-05T08:00:00.000Z", { notes: 1 });
    seedShift("sh-ancient", "2026-01-01T08:00:00.000Z", { notes: 1 });

    const res = await request(buildApp())
      .get(url("history?days=7"))
      .set(asUser(MEMBER));

    expect(res.status).toBe(200);
    const { shifts } = res.body as { shifts: { shift: { id: string } }[] };
    expect(shifts).toHaveLength(1);
    expect(shifts[0].shift.id).toBe("sh-recent");
  });

  it("200 returns empty shifts when no handovers stored", async () => {
    const res = await request(buildApp())
      .get(url("history"))
      .set(asUser(MEMBER));
    expect(res.status).toBe(200);
    const { shifts } = res.body as { shifts: unknown[] };
    expect(shifts).toHaveLength(0);
  });
});
