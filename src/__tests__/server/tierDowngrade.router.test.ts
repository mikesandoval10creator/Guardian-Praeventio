import { beforeEach, describe, expect, it, vi } from "vitest";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import request from "supertest";

const H = vi.hoisted(() => ({
  db: null as ReturnType<
    typeof import("../helpers/fakeFirestore").createFakeFirestore
  > | null,
}));
const A = vi.hoisted(() => ({
  auditServerEvent: vi.fn(async () => undefined),
}));

vi.mock("firebase-admin", async () => {
  const { adminMock } = await import("../helpers/fakeFirestore");
  return adminMock(() => H.db!, {
    verifyIdToken: async () => ({ uid: "owner" }),
  });
});

vi.mock("../../server/middleware/verifyAuth.js", () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header("x-test-uid");
    if (!uid) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));

vi.mock("../../server/middleware/auditLog.js", () => ({
  auditServerEvent: A.auditServerEvent,
}));

vi.mock("../../utils/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { createFakeFirestore } from "../helpers/fakeFirestore";
import tierDowngradeRouter from "../../server/routes/tierDowngrade.js";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api/tier-downgrade", tierDowngradeRouter);
  return instance;
}

function seedValidOroSubscription() {
  H.db!._seed("users/owner", {
    subscription: {
      planId: "oro",
      status: "active",
      provider: "manual",
    },
  });
}

describe("tierDowngradeRouter", () => {
  beforeEach(() => {
    H.db = createFakeFirestore();
    A.auditServerEvent.mockClear();
    seedValidOroSubscription();
  });

  it("computes the oldest active project excess from the verified owner and canonical target tier", async () => {
    H.db!._seed("projects/p-oldest", {
      tenantId: "owner",
      status: "active",
      name: "Oldest",
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    H.db!._seed("projects/p-middle", {
      tenantId: "owner",
      status: "active",
      name: "Middle",
      createdAt: "2024-02-01T00:00:00.000Z",
    });
    H.db!._seed("projects/p-newest", {
      tenantId: "owner",
      status: "active",
      name: "Newest",
      createdAt: "2024-03-01T00:00:00.000Z",
    });
    H.db!._seed("projects/p-other-tenant", {
      tenantId: "attacker",
      status: "active",
      createdAt: "2023-01-01T00:00:00.000Z",
    });
    H.db!._seed("projects/p-archived", {
      tenantId: "owner",
      status: "archived",
      createdAt: "2022-01-01T00:00:00.000Z",
    });

    const res = await request(app())
      .post("/api/tier-downgrade/preview")
      .set("x-test-uid", "owner")
      .send({ targetTier: "gratis" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sourceTier: "oro",
      targetTier: "gratis",
      overages: {
        projects: {
          count: 2,
          current: 3,
          cap: 1,
          candidateIds: ["p-oldest", "p-middle"],
        },
      },
    });
  });

  it("computes worker excess per faena and excludes archived workers and foreign projects", async () => {
    H.db!._seed("projects/p-owned", {
      tenantId: "owner",
      status: "active",
      createdAt: "2024-01-01T00:00:00.000Z",
    });

    H.db!._seed("projects/p-foreign", {
      tenantId: "attacker",
      status: "active",
      createdAt: "2024-01-01T00:00:00.000Z",
    });

    for (const [id, createdAt] of [
      ["w-oldest", "2024-01-01T00:00:00.000Z"],
      ["w-middle", "2024-02-01T00:00:00.000Z"],
      ["w-3", "2024-03-01T00:00:00.000Z"],
      ["w-4", "2024-04-01T00:00:00.000Z"],
      ["w-newest", "2024-05-01T00:00:00.000Z"],
    ]) {
      H.db!._seed(`projects/p-owned/workers/${id}`, {
        createdAt,
        archived: false,
      });
    }
    H.db!._seed("projects/p-owned/workers/w-already-archived", {
      createdAt: "2023-01-01T00:00:00.000Z",
      archived: true,
    });

    H.db!._seed("projects/p-foreign/workers/w-foreign-1", { archived: false });
    H.db!._seed("projects/p-foreign/workers/w-foreign-2", { archived: false });
    H.db!._seed("projects/p-foreign/workers/w-foreign-3", { archived: false });
    H.db!._seed("projects/p-foreign/workers/w-foreign-4", { archived: false });

    const res = await request(app())
      .post("/api/tier-downgrade/preview")
      .set("x-test-uid", "owner")
      .send({ targetTier: "gratis" });

    expect(res.status).toBe(200);
    expect(res.body.overages.workers).toEqual({
      count: 2,
      capPerProject: 3,
      projects: [
        {
          projectId: "p-owned",
          current: 5,
          cap: 3,
          count: 2,
          candidateIds: ["p-owned/w-oldest", "p-owned/w-middle"],
        },
      ],
    });
  });

  it("does not archive workers from projects that the same downgrade will archive", async () => {
    H.db!._seed("projects/p-old-project", {
      tenantId: "owner",
      status: "active",
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    H.db!._seed("projects/p-kept-project", {
      tenantId: "owner",
      status: "active",
      createdAt: "2024-02-01T00:00:00.000Z",
    });
    for (let index = 1; index <= 10; index += 1) {
      H.db!._seed(`projects/p-old-project/workers/w-${index}`, {
        createdAt: `2024-01-${String(index).padStart(2, "0")}T00:00:00.000Z`,
        archived: false,
      });
    }
    H.db!._seed("projects/p-kept-project/workers/w-1", { archived: false });
    H.db!._seed("projects/p-kept-project/workers/w-2", { archived: false });

    const res = await request(app())
      .post("/api/tier-downgrade/preview")
      .set("x-test-uid", "owner")
      .send({ targetTier: "gratis" });

    expect(res.status).toBe(200);
    expect(res.body.overages.projects.candidateIds).toEqual(["p-old-project"]);
    expect(res.body.overages.workers).toEqual({
      count: 0,
      capPerProject: 3,
      projects: [],
    });
  });

  it("exports the exact authoritative worker candidates with a stable fingerprint", async () => {
    H.db!._seed("projects/p-owned", {
      tenantId: "owner",
      status: "active",
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    for (const [id, createdAt, name] of [
      ["w-oldest", "2024-01-01T00:00:00.000Z", "Ana"],
      ["w-middle", "2024-02-01T00:00:00.000Z", "Beto"],
      ["w-3", "2024-03-01T00:00:00.000Z", "Carla"],
      ["w-4", "2024-04-01T00:00:00.000Z", "Diego"],
      ["w-newest", "2024-05-01T00:00:00.000Z", "Elena"],
    ]) {
      H.db!._seed(`projects/p-owned/workers/${id}`, {
        createdAt,
        name,
        archived: false,
      });
    }

    const res = await request(app())
      .post("/api/tier-downgrade/export")
      .set("x-test-uid", "owner")
      .send({ targetTier: "gratis", category: "workers" });

    expect(res.status).toBe(200);
    expect(res.body.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(res.body.backup).toMatchObject({
      version: 1,
      sourceTier: "oro",
      targetTier: "gratis",
      category: "workers",
      count: 2,
      records: [
        {
          kind: "worker",
          projectId: "p-owned",
          workerId: "w-oldest",
          data: { name: "Ana", archived: false },
        },
        {
          kind: "worker",
          projectId: "p-owned",
          workerId: "w-middle",
          data: { name: "Beto", archived: false },
        },
      ],
    });
    expect(Date.parse(res.body.backup.generatedAt)).not.toBeNaN();
  });

  it("soft-archives exactly the exported workers, updates project count, and audits the mutation", async () => {
    H.db!._seed("projects/p-owned", {
      tenantId: "owner",
      status: "active",
      workersCount: 5,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    for (const [id, createdAt] of [
      ["w-oldest", "2024-01-01T00:00:00.000Z"],
      ["w-middle", "2024-02-01T00:00:00.000Z"],
      ["w-3", "2024-03-01T00:00:00.000Z"],
      ["w-4", "2024-04-01T00:00:00.000Z"],
      ["w-newest", "2024-05-01T00:00:00.000Z"],
    ]) {
      H.db!._seed(`projects/p-owned/workers/${id}`, {
        createdAt,
        archived: false,
      });
    }

    const exported = await request(app())
      .post("/api/tier-downgrade/export")
      .set("x-test-uid", "owner")
      .send({ targetTier: "gratis", category: "workers" });

    const archived = await request(app())
      .post("/api/tier-downgrade/archive")
      .set("x-test-uid", "owner")
      .send({
        targetTier: "gratis",
        category: "workers",
        expectedFingerprint: exported.body.fingerprint,
      });

    expect(archived.status).toBe(200);
    expect(archived.body).toEqual({ success: true, archivedCount: 2 });
    const dump = H.db!._dump();
    expect(dump["projects/p-owned/workers/w-oldest"]).toMatchObject({
      archived: true,
      archivedBy: "owner",
    });
    expect(dump["projects/p-owned/workers/w-middle"]).toMatchObject({
      archived: true,
      archivedBy: "owner",
    });
    expect(dump["projects/p-owned/workers/w-3"]?.archived).toBe(false);
    expect(dump["projects/p-owned"].workersCount).toBe(3);
    expect(A.auditServerEvent).toHaveBeenCalledWith(
      expect.anything(),
      "tierDowngrade.archive",
      "billing",
      expect.objectContaining({ category: "workers", archivedCount: 2 }),
    );
  });

  it("rejects archival when the authoritative candidates changed after export", async () => {
    H.db!._seed("projects/p-owned", {
      tenantId: "owner",
      status: "active",
      workersCount: 5,
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    for (const [id, createdAt] of [
      ["w-oldest", "2024-01-01T00:00:00.000Z"],
      ["w-middle", "2024-02-01T00:00:00.000Z"],
      ["w-3", "2024-03-01T00:00:00.000Z"],
      ["w-4", "2024-04-01T00:00:00.000Z"],
      ["w-newest", "2024-05-01T00:00:00.000Z"],
    ]) {
      H.db!._seed(`projects/p-owned/workers/${id}`, {
        createdAt,
        archived: false,
      });
    }

    const exported = await request(app())
      .post("/api/tier-downgrade/export")
      .set("x-test-uid", "owner")
      .send({ targetTier: "gratis", category: "workers" });
    H.db!._seed("projects/p-owned/workers/w-now-oldest", {
      createdAt: "2023-01-01T00:00:00.000Z",
      archived: false,
    });

    const archived = await request(app())
      .post("/api/tier-downgrade/archive")
      .set("x-test-uid", "owner")
      .send({
        targetTier: "gratis",
        category: "workers",
        expectedFingerprint: exported.body.fingerprint,
      });

    expect(archived.status).toBe(409);
    expect(archived.body).toEqual({ error: "downgrade_candidates_changed" });
    const workerRows = Object.entries(H.db!._dump()).filter(([path]) =>
      path.startsWith("projects/p-owned/workers/"),
    );
    expect(workerRows.every(([, row]) => row.archived === false)).toBe(true);
    expect(A.auditServerEvent).not.toHaveBeenCalled();
  });

  it("exports and soft-archives only the oldest owned active project excess", async () => {
    for (const [id, createdAt, name] of [
      ["p-oldest", "2024-01-01T00:00:00.000Z", "Oldest"],
      ["p-middle", "2024-02-01T00:00:00.000Z", "Middle"],
      ["p-newest", "2024-03-01T00:00:00.000Z", "Newest"],
    ]) {
      H.db!._seed(`projects/${id}`, {
        tenantId: "owner",
        status: "active",
        createdAt,
        name,
      });
    }
    H.db!._seed("projects/p-foreign", {
      tenantId: "attacker",
      status: "active",
      createdAt: "2023-01-01T00:00:00.000Z",
    });

    const exported = await request(app())
      .post("/api/tier-downgrade/export")
      .set("x-test-uid", "owner")
      .send({ targetTier: "gratis", category: "projects" });
    expect(exported.status).toBe(200);
    expect(exported.body.backup.records).toMatchObject([
      { kind: "project", projectId: "p-oldest", data: { name: "Oldest" } },
      { kind: "project", projectId: "p-middle", data: { name: "Middle" } },
    ]);

    const archived = await request(app())
      .post("/api/tier-downgrade/archive")
      .set("x-test-uid", "owner")
      .send({
        targetTier: "gratis",
        category: "projects",
        expectedFingerprint: exported.body.fingerprint,
      });

    expect(archived.status).toBe(200);
    expect(archived.body).toEqual({ success: true, archivedCount: 2 });
    const dump = H.db!._dump();
    expect(dump["projects/p-oldest"]).toMatchObject({
      status: "archived",
      archivedBy: "owner",
    });
    expect(dump["projects/p-middle"]).toMatchObject({
      status: "archived",
      archivedBy: "owner",
    });
    expect(dump["projects/p-newest"].status).toBe("active");
    expect(dump["projects/p-foreign"].status).toBe("active");
  });

  it("requires authentication before reading tenant or subscription data", async () => {
    const res = await request(app())
      .post("/api/tier-downgrade/preview")
      .send({ targetTier: "gratis" });

    expect(res.status).toBe(401);
    expect(H.db!._dump()["projects/p-owned"]).toBeUndefined();
  });

  it("strictly rejects client-supplied counts, owners, and candidate ids", async () => {
    const res = await request(app())
      .post("/api/tier-downgrade/archive")
      .set("x-test-uid", "owner")
      .send({
        targetTier: "gratis",
        category: "projects",
        excess: 99,
        ownerUid: "attacker",
        candidateIds: ["p-foreign"],
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_request" });
    expect(A.auditServerEvent).not.toHaveBeenCalled();
  });

  it("rejects a target that is not below the authoritative current plan", async () => {
    const res = await request(app())
      .post("/api/tier-downgrade/preview")
      .set("x-test-uid", "owner")
      .send({ targetTier: "titanio" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "target_is_not_a_downgrade" });
  });
});
