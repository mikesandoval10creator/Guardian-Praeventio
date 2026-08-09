// Real-router supertest for pain-based upsell on the metallic tier ladder.

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

import upsellRouter from "../../server/routes/upsell.js";
import { createFakeFirestore } from "../helpers/fakeFirestore";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", upsellRouter);
  return app;
}

const uid = { "x-test-uid": "u1" };
const noPain = {
  manualReportsPerWeek: 0,
  exceptionsRaisedLast30d: 0,
  dataConfidenceScore: 1,
  currentTier: "cobre",
};

beforeEach(() => {
  H.db = createFakeFirestore();
  H.db._seed("projects/p1", { members: ["u1"], createdBy: "owner" });
  H.db._seed("projects/p2", { members: ["someone-else"], createdBy: "owner" });
});

describe("POST /:projectId/upsell/suggest", () => {
  const url = "/api/p1/upsell/suggest";

  it("401 without authentication", async () => {
    expect((await request(buildApp()).post(url).send(noPain)).status).toBe(401);
  });

  it("returns no suggestion without measured pain", async () => {
    const response = await request(buildApp()).post(url).set(uid).send(noPain);
    expect(response.status).toBe(200);
    expect(response.body.suggestions).toEqual([]);
  });

  it("suggests matched addons and the immediate next metallic tier", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        ...noPain,
        manualReportsPerWeek: 10,
        activeProjectCount: 4,
      });

    expect(response.status).toBe(200);
    expect(response.body.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ addonOrTier: "addon.automated_reports" }),
        expect.objectContaining({
          addonOrTier: "tier.plata",
          kind: "tier_upgrade",
        }),
      ]),
    );
  });

  it("suggests Oro, not a legacy plan, when a Plata tenant exceeds its project cap", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        ...noPain,
        currentTier: "plata",
        exceptionsRaisedLast30d: 10,
        activeProjectCount: 6,
      });

    const suggestions = response.body.suggestions.map(
      ({ addonOrTier }: { addonOrTier: string }) => addonOrTier,
    );
    expect(response.status).toBe(200);
    expect(suggestions).toContain("tier.oro");
    expect(suggestions).not.toContain("tier.pro");
    expect(suggestions).not.toContain("tier.enterprise");
  });

  it("derives scale pain from the canonical current-tier project cap", async () => {
    const fits = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        ...noPain,
        activeProjectCount: 3,
      });
    const exceeds = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        ...noPain,
        activeProjectCount: 4,
      });

    expect(fits.body.suggestions).toEqual([]);
    expect(exceeds.body.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ addonOrTier: "tier.plata" }),
      ]),
    );
  });

  it("does not invent a tier above Diamante", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        ...noPain,
        currentTier: "diamante",
        activeProjectCount: 51,
      });
    expect(response.status).toBe(200);
    expect(response.body.suggestions).toEqual([]);
  });

  it("rejects unknown tier-shaped fields instead of silently stripping them", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        ...noPain,
        legacyTier: "free",
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_payload");
  });

  it("rejects the legacy tier vocabulary", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        ...noPain,
        currentTier: "free",
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_payload");
  });

  it("400 when dataConfidenceScore is out of range", async () => {
    const response = await request(buildApp())
      .post(url)
      .set(uid)
      .send({
        ...noPain,
        dataConfidenceScore: 1.5,
      });
    expect(response.status).toBe(400);
  });

  it("400 when a required signal is missing", async () => {
    const { manualReportsPerWeek: _omitted, ...missing } = noPain;
    const response = await request(buildApp()).post(url).set(uid).send(missing);
    expect(response.status).toBe(400);
  });

  it("403 when the caller is not a project member", async () => {
    const response = await request(buildApp())
      .post("/api/p2/upsell/suggest")
      .set(uid)
      .send(noPain);
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("forbidden");
  });

  it("403 when the project does not exist", async () => {
    const response = await request(buildApp())
      .post("/api/ghost/upsell/suggest")
      .set(uid)
      .send(noPain);
    expect(response.status).toBe(403);
  });
});
