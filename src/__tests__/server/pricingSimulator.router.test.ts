// Real-router supertest for the canonical metallic pricing simulator.

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

vi.mock("firebase-admin", async () => {
  const { adminMock } = await import("../helpers/fakeFirestore");
  return adminMock(() => H.db!);
});
vi.mock("../../server/middleware/verifyAuth.js", () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    const uid = req.header("x-test-uid");
    if (!uid) return void res.status(401).json({ error: "unauthorized" });
    (req as Request & { user: { uid: string } }).user = { uid };
    next();
  },
}));
vi.mock("../../utils/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../services/observability/index.js", () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));

import pricingSimulatorRouter from "../../server/routes/pricingSimulator.js";
import { createFakeFirestore } from "../helpers/fakeFirestore";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", pricingSimulatorRouter);
  return app;
}

const uid = { "x-test-uid": "u1" };
const usage = {
  workers: 20,
  projects: 2,
  aiCallsPerMonth: 400,
  storageGb: 8,
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed("projects/p1", { members: ["u1"], createdBy: "owner" });
  H.db._seed("projects/p2", { members: ["someone-else"], createdBy: "owner" });
});

describe("POST /:projectId/pricing/estimate-bill", () => {
  const url = "/api/p1/pricing/estimate-bill";

  it("401 without authentication", async () => {
    expect(
      (await request(buildApp()).post(url).send({ tier: "cobre", usage }))
        .status,
    ).toBe(401);
  });

  it("uses the canonical Cobre price and rejects the legacy vocabulary", async () => {
    const canonical = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tier: "cobre", usage });
    const legacy = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tier: "starter", usage });

    expect(canonical.status).toBe(200);
    expect(canonical.body.estimate).toMatchObject({
      tier: "cobre",
      baseClp: 9_990,
      totalClp: 9_990,
      fitsWithoutOverage: true,
    });
    expect(legacy.status).toBe(400);
    expect(legacy.body.error).toBe("invalid_payload");
  });

  it("uses canonical Cobre overage rates", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        tier: "cobre",
        usage: { ...usage, workers: 30, projects: 4 },
      });

    expect(response.status).toBe(200);
    expect(response.body.estimate.overage.workers).toEqual({
      excess: 6,
      clp: 5_940,
    });
    expect(response.body.estimate.overage.projects).toEqual({
      excess: 1,
      clp: 5_990,
    });
    expect(response.body.estimate.totalClp).toBe(21_920);
  });

  it("rejects caller-defined price overrides", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        tier: "cobre",
        usage,
        options: { rates: { perWorkerClp: 0 } },
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_payload");
  });

  it("400 when usage is missing", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ tier: "cobre" });
    expect(response.status).toBe(400);
  });

  it("403 when the caller is not a project member", async () => {
    const response = await request(buildApp())
      .post("/api/p2/pricing/estimate-bill")
      .set(uid)
      .send({ tier: "cobre", usage });
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("forbidden");
  });
});

describe("POST /:projectId/pricing/compare-tiers", () => {
  const url = "/api/p1/pricing/compare-tiers";

  it("401 without authentication", async () => {
    const response = await request(buildApp())
      .post(url)
      .send({ currentTier: "cobre", usage });
    expect(response.status).toBe(401);
  });

  it("returns all seven metallic tiers in canonical order", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ currentTier: "cobre", usage });

    expect(response.status).toBe(200);
    expect(
      response.body.comparisons.map(({ tier }: { tier: string }) => tier),
    ).toEqual([
      "gratis",
      "cobre",
      "plata",
      "oro",
      "titanio",
      "platino",
      "diamante",
    ]);
  });

  it("recommends Plata when Cobre no longer fits", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ currentTier: "cobre", usage: { ...usage, workers: 25 } });

    const plata = response.body.comparisons.find(
      ({ tier }: { tier: string }) => tier === "plata",
    );
    expect(response.status).toBe(200);
    expect(plata.recommended).toBe(true);
  });

  it("rejects legacy tiers", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({ currentTier: "free", usage });
    expect(response.status).toBe(400);
  });

  it("403 when the caller is not a project member", async () => {
    const response = await request(buildApp())
      .post("/api/p2/pricing/compare-tiers")
      .set(uid)
      .send({ currentTier: "cobre", usage });
    expect(response.status).toBe(403);
  });
});

describe("POST /:projectId/pricing/worker-break-even", () => {
  const url = "/api/p1/pricing/worker-break-even";

  it("401 without authentication", async () => {
    const response = await request(buildApp()).post(url).send({
      currentTier: "cobre",
      nextTier: "plata",
      baseUsage: usage,
    });
    expect(response.status).toBe(401);
  });

  it("finds the canonical Cobre-to-Plata capacity break-even", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        currentTier: "cobre",
        nextTier: "plata",
        baseUsage: { ...usage, workers: 20 },
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ workers: 25, found: true });
  });

  it("400 when nextTier is missing", async () => {
    const response = await request(buildApp()).post(url).set(uid).send({
      currentTier: "cobre",
      baseUsage: usage,
    });
    expect(response.status).toBe(400);
  });

  it("rejects legacy tiers", async () => {
    const response = await request(buildApp()).post(url).set(uid).send({
      currentTier: "free",
      nextTier: "starter",
      baseUsage: usage,
    });
    expect(response.status).toBe(400);
  });

  it("rejects a downgrade passed as nextTier", async () => {
    const response = await request(buildApp()).post(url).set(uid).send({
      currentTier: "plata",
      nextTier: "cobre",
      baseUsage: usage,
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/nextTier must rank above currentTier/);
  });

  it("403 when the caller is not a project member", async () => {
    const response = await request(buildApp())
      .post("/api/p2/pricing/worker-break-even")
      .set(uid)
      .send({ currentTier: "cobre", nextTier: "plata", baseUsage: usage });
    expect(response.status).toBe(403);
  });
});
