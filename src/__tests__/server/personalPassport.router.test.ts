// Real-router tests for worker-owned offboarding passports. The former project
// loses access; only the worker can export or selectively share to a recipient
// who is still an authenticated member of a future project.

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
  callerUid: "manager-a",
  revokedUids: [] as string[],
}));

process.env.COMPLIANCE_EVIDENCE_ATTESTATION_CURRENT_KEY_ID = "passport-test";
process.env.COMPLIANCE_EVIDENCE_ATTESTATION_KEYS = JSON.stringify({
  "passport-test": "passport-test-attestation-secret-at-least-32-bytes",
});

vi.mock("firebase-admin", async () => {
  const { adminMock } = await import("../helpers/fakeFirestore");
  return adminMock(() => H.db!, {
    revokeRefreshTokens: async (uid: string) => {
      H.revokedUids.push(uid);
    },
  });
});
vi.mock("../../server/middleware/verifyAuth.js", () => ({
  verifyAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!H.callerUid)
      return void res.status(401).json({ error: "unauthorized" });
    (req as Request & { user: { uid: string } }).user = { uid: H.callerUid };
    next();
  },
}));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn() };
  },
}));
vi.mock("../../services/email/resendService.js", () => ({
  EmailService: { fromEnv: () => null },
}));
vi.mock("../../services/email/templates.js", () => ({
  projectInvitationTemplate: () => "<html>",
}));
vi.mock("../../services/analytics/serverAdapter.js", () => ({
  serverAnalytics: { track: vi.fn(async () => {}) },
}));
vi.mock("../../services/observability/index.js", () => ({
  getErrorTracker: () => ({ captureException: vi.fn() }),
}));
vi.mock("../../utils/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import projectsRouter from "../../server/routes/projects.js";
import personalPassportRouter from "../../server/routes/personalPassport.js";
import { createFakeFirestore } from "../helpers/fakeFirestore";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api/projects", projectsRouter);
  instance.use("/api/personal-passports", personalPassportRouter);
  return instance;
}

beforeEach(() => {
  H.callerUid = "manager-a";
  H.revokedUids = [];
  H.db = createFakeFirestore();
  H.db._seed("projects/source-a", {
    name: "Empresa A",
    tenantId: "tenant-a",
    createdBy: "manager-a",
    members: ["manager-a", "worker-1"],
    memberRoles: { "manager-a": "gerente", "worker-1": "operario" },
  });
  H.db._seed("projects/source-a/workers/worker-1", {
    role: "operario",
    capabilities: ["altura"],
    certifications: [{ code: "ALT-01", issuer: "OTEC" }],
    trainingRecords: [{ code: "SEG-01", completedAt: "2026-01-01" }],
    shareableAptitudes: [{ status: "apto", validUntil: "2027-01-01" }],
    rut: "11.111.111-1",
    incidentDiagnosis: "privado",
    colleagues: ["tercero"],
  });
  H.db._seed("tasks/done-altura", {
    projectId: "source-a",
    assignedUids: ["worker-1"],
    status: "done",
    riskCategory: "altura",
    description: "procedimiento interno que no es portable",
  });
  H.db._seed("tasks/done-general", {
    projectId: "source-a",
    assignedUids: ["worker-1"],
    status: "done",
    category: "general",
    description: "detalle de faena que no es portable",
  });
  H.db._seed("tasks/not-done", {
    projectId: "source-a",
    assignedUids: ["worker-1"],
    status: "pending",
    riskCategory: "electricidad",
  });
  H.db._seed("tasks/other-worker", {
    projectId: "source-a",
    assignedUids: ["other-worker"],
    status: "done",
    riskCategory: "altura",
  });
  H.db._seed("tasks/other-project", {
    projectId: "other-project",
    assignedUids: ["worker-1"],
    status: "done",
    riskCategory: "quimico",
  });
  H.db._seed("projects/future-b", {
    name: "Empresa B",
    tenantId: "tenant-b",
    createdBy: "manager-b",
    members: ["manager-b", "recipient-b"],
    memberRoles: { "manager-b": "gerente", "recipient-b": "supervisor" },
  });
});

async function offboard(): Promise<void> {
  const res = await request(app()).post(
    "/api/projects/source-a/members/worker-1/offboard",
  );
  expect(res.status).toBe(200);
}

describe("personal passport sovereign export and selective sharing", () => {
  it("revokes Company A route access while retaining a PII-minimized closure audit and owner-only export", async () => {
    await offboard();
    const audit = Object.values(H.db!._dump()).find(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        (value as Record<string, unknown>).action === "projects.memberOffboard",
    ) as Record<string, unknown> | undefined;
    expect(audit).toMatchObject({
      action: "projects.memberOffboard",
      projectId: "source-a",
      details: {
        projectId: "source-a",
        targetUid: "worker-1",
        passportId: "source-a",
      },
    });
    expect(JSON.stringify(audit)).not.toContain("11.111.111-1");
    expect(JSON.stringify(audit)).not.toContain("privado");
    const sourceWorker = H.db!._dump()[
      "projects/source-a/workers/worker-1"
    ] as Record<string, unknown>;
    expect(sourceWorker).toMatchObject({
      archived: true,
      archivedBy: "manager-a",
      offboardedAt: expect.any(String),
    });
    expect(H.revokedUids).toEqual(["worker-1"]);
    const accessAudit = Object.values(H.db!._dump()).find(
      (row) => (row as { action?: string }).action === "projects.memberOffboardAccessRevocation",
    );
    expect(JSON.stringify(accessAudit)).toContain('"tokenRevocation":"revoked"');

    H.callerUid = "worker-1";
    expect(
      (await request(app()).get("/api/projects/source-a/members")).status,
    ).toBe(403);
    const res = await request(app()).get(
      "/api/personal-passports/source-a/export",
    );
    expect(res.status).toBe(200);
    expect(res.headers["x-passport-checksum"]).toMatch(/^[a-f0-9]{64}$/);
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.text).toContain("ALT-01");
    expect(res.text).toContain('"completedTaskCount":2');
    expect(res.text).toContain('"altura":1');
    expect(res.text).toContain('"general":1');
    expect(res.text).not.toContain("procedimiento interno que no es portable");
    expect(res.text).not.toContain("detalle de faena que no es portable");
    expect(res.text).not.toContain("11.111.111-1");
    expect(res.text).not.toContain("privado");
  });

  it("rejects an export after any passport field or its server attestation is tampered with", async () => {
    await offboard();
    const key = "users/worker-1/personal_passports/source-a";
    const tampered = structuredClone(
      H.db!._dump()[key] as Record<string, unknown>,
    );
    tampered.capabilities = ["forged"];
    H.db!._seed(key, tampered);
    H.callerUid = "worker-1";
    expect(
      (await request(app()).get("/api/personal-passports/source-a/export"))
        .status,
    ).toBe(404);

    await offboard();
    const attestationTampered = structuredClone(
      H.db!._dump()[key] as Record<string, unknown>,
    );
    attestationTampered.archiveAttestation = {
      version: 1,
      keyId: "passport-test",
      macB64u: "A".repeat(43),
    };
    H.db!._seed(key, attestationTampered);
    expect(
      (await request(app()).get("/api/personal-passports/source-a/export"))
        .status,
    ).toBe(404);
  });

  it("binds a worker-selected subset to an authenticated recipient in a future project, then revokes it", async () => {
    await offboard();
    H.callerUid = "worker-1";
    const created = await request(app())
      .post("/api/personal-passports/source-a/shares")
      .send({
        recipientUid: "recipient-b",
        targetProjectId: "future-b",
        fields: ["capabilities", "certifications", "taskExperience"],
        ttlHours: 1,
      });
    expect(created.status).toBe(201);
    expect(created.body.shareUrl).toContain(`#${created.body.secret}`);
    expect(JSON.stringify(H.db!._dump())).not.toContain(created.body.secret);

    H.callerUid = "recipient-b";
    const consumed = await request(app())
      .post(
        `/api/personal-passports/worker-1/shares/${created.body.shareId}/consume`,
      )
      .send({ secret: created.body.secret });
    expect(consumed.status).toBe(200);
    expect(consumed.body.passport).toMatchObject({
      capabilities: ["altura"],
      certifications: [{ code: "ALT-01", issuer: "OTEC" }],
      taskExperience: {
        completedTaskCount: 2,
        completedByCategory: { altura: 1, general: 1 },
      },
    });
    expect(consumed.body.passport).not.toHaveProperty("roles");
    expect(JSON.stringify(consumed.body)).not.toContain("11.111.111-1");

    H.callerUid = "worker-1";
    expect(
      (
        await request(app()).post(
          `/api/personal-passports/source-a/shares/${created.body.shareId}/revoke`,
        )
      ).status,
    ).toBe(200);
    H.callerUid = "recipient-b";
    expect(
      (
        await request(app())
          .post(
            `/api/personal-passports/worker-1/shares/${created.body.shareId}/consume`,
          )
          .send({ secret: created.body.secret })
      ).status,
    ).toBe(403);
  });

  it("fails closed for a same-tenant target and if the target tenant changes after consent", async () => {
    await offboard();
    H.callerUid = "worker-1";
    H.db!._seed("projects/same-tenant", {
      name: "Otra obra de Empresa A",
      tenantId: "tenant-a",
      createdBy: "manager-a2",
      members: ["recipient-a2"],
      memberRoles: { "recipient-a2": "supervisor" },
    });
    const sameTenant = await request(app())
      .post("/api/personal-passports/source-a/shares")
      .send({
        recipientUid: "recipient-a2",
        targetProjectId: "same-tenant",
        fields: ["capabilities"],
      });
    expect(sameTenant.status).toBe(403);
    expect(sameTenant.body.error).toBe("target_tenant_must_differ_from_source");

    const created = await request(app())
      .post("/api/personal-passports/source-a/shares")
      .send({
        recipientUid: "recipient-b",
        targetProjectId: "future-b",
        fields: ["capabilities"],
      });
    expect(created.status).toBe(201);
    H.db!._seed("projects/future-b", {
      name: "Empresa B",
      tenantId: "tenant-mutated",
      createdBy: "manager-b",
      members: ["manager-b", "recipient-b"],
      memberRoles: { "manager-b": "gerente", "recipient-b": "supervisor" },
    });
    H.callerUid = "recipient-b";
    const consumed = await request(app())
      .post(
        `/api/personal-passports/worker-1/shares/${created.body.shareId}/consume`,
      )
      .send({ secret: created.body.secret });
    expect(consumed.status).toBe(403);
  });

  it("refuses the source employer and any target-project membership that is no longer active", async () => {
    await offboard();
    H.callerUid = "worker-1";
    const sourceShare = await request(app())
      .post("/api/personal-passports/source-a/shares")
      .send({
        recipientUid: "manager-a",
        targetProjectId: "source-a",
        fields: ["capabilities"],
      });
    expect(sourceShare.status).toBe(403);

    const created = await request(app())
      .post("/api/personal-passports/source-a/shares")
      .send({
        recipientUid: "recipient-b",
        targetProjectId: "future-b",
        fields: ["capabilities"],
      });
    expect(created.status).toBe(201);
    H.db!._seed("projects/future-b", {
      name: "Empresa B",
      tenantId: "tenant-b",
      createdBy: "manager-b",
      members: ["manager-b"],
      memberRoles: { "manager-b": "gerente" },
    });
    H.callerUid = "recipient-b";
    expect(
      (
        await request(app())
          .post(
            `/api/personal-passports/worker-1/shares/${created.body.shareId}/consume`,
          )
          .send({ secret: created.body.secret })
      ).status,
    ).toBe(403);
  });
});
