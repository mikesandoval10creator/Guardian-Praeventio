// SPDX-License-Identifier: MIT
// Real Firestore transactions, two independent Admin SDK clients, no mutex.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import {
  provisionOnboarding,
  type OnboardingPayload,
} from "./onboardingProvisioning";

const payload: OnboardingPayload = {
  industry: "construction",
  countries: ["CL"],
  tier: "gratis",
  projectName: "Faena prueba",
  inviteEmails: ["ana@example.cl"],
  workersCsv: "name\nAna",
  siiCode: 410010,
  sectorId: "GP-CONS-RES",
  estimatedWorkers: 30,
};
let apps: App[];
let first: Firestore;
let second: Firestore;
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST)
    throw new Error("Emulator required");
  apps = ["onboarding-a", "onboarding-b"].map((name) =>
    initializeApp(
      {
        projectId: process.env.GCLOUD_PROJECT ?? "praeventio-test",
      },
      name,
    ),
  );
  [first, second] = apps.map((app) => getFirestore(app));
});
afterAll(async () => {
  await Promise.all(apps.map((app) => deleteApp(app)));
});

async function counts(db: Firestore, uid: string, projectId: string) {
  const queries = await Promise.all([
    db.collection("tenants").doc(uid).collection("projects").get(),
    db.collection("projects").where("createdBy", "==", uid).get(),
    db
      .collection("tenants")
      .doc(uid)
      .collection("projects")
      .doc(projectId)
      .collection("invitations")
      .get(),
    db.collection("tenants").doc(uid).collection("imports").get(),
  ]);
  return queries.map((q) => q.size);
}

describe("onboarding atomic completion — Firestore emulator", () => {
  it("serializes concurrent SDK clients and persists one project, invite, import and result", async () => {
    const attempts = await Promise.all([
      provisionOnboarding(first, "owner-concurrent", payload),
      provisionOnboarding(second, "owner-concurrent", payload),
    ]);
    expect(attempts.filter((a) => !a.replayed)).toHaveLength(1);
    expect(attempts[1].result).toEqual(attempts[0].result);
    expect(attempts.flatMap((a) => a.invitations)).toHaveLength(1);
    const result = attempts[0].result;
    expect(await counts(second, "owner-concurrent", result.projectId)).toEqual([
      1, 1, 1, 1,
    ]);
    const user = await second.collection("users").doc("owner-concurrent").get();
    expect(user.get("onboarded")).toBe(true);
    expect(user.get("role")).toBe("gerente");
    const risks = await second
      .collection("nodes")
      .where("projectId", "==", result.projectId)
      .get();
    expect(risks.size).toBe(result.seededRisks);
    expect(risks.size).toBeGreaterThan(0);
    const obligations = await second
      .collection("projects")
      .doc(result.projectId)
      .collection("legal_obligations")
      .get();
    expect(obligations.size).toBe(result.seededObligations);
    expect(obligations.size).toBeGreaterThan(0);
    // Simulate response loss: a later process/client does not provision again.
    const retry = await provisionOnboarding(
      second,
      "owner-concurrent",
      payload,
    );
    expect(retry.replayed).toBe(true);
    expect(retry.result).toEqual(result);
    expect(retry.invitations).toEqual([]);
    expect(await counts(first, "owner-concurrent", result.projectId)).toEqual([
      1, 1, 1, 1,
    ]);
    const receipts = await first.collection("system_idempotency_cache").get();
    expect(receipts.size).toBe(1);
    expect(receipts.docs[0].get("state")).toBe("completed");
    expect(receipts.docs[0].get("expiresAt")).toBeUndefined();
  });

  it("does not over-deduplicate two owners with the same payload", async () => {
    const [a, b] = await Promise.all([
      provisionOnboarding(first, "owner-a", payload),
      provisionOnboarding(second, "owner-b", payload),
    ]);
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(false);
    expect(a.result.projectId).not.toBe(b.result.projectId);
    expect(await counts(first, "owner-a", a.result.projectId)).toEqual([
      1, 1, 1, 1,
    ]);
    expect(await counts(second, "owner-b", b.result.projectId)).toEqual([
      1, 1, 1, 1,
    ]);
  });

  it("rolls back staged projects/seeds when a later write cannot be serialized; retry succeeds", async () => {
    await first
      .collection("users")
      .doc("owner-failure")
      .set({ role: "operario", onboarded: false });
    // Fault after staging projects/seeds/invitations, during the CSV write.
    // The HTTP route rejects this type; this directly exercises rollback of
    // the persistence service, not input validation or a mocked transaction.
    const invalid = {
      ...payload,
      workersCsv: (() => "not serializable") as unknown as string,
    };
    await expect(
      provisionOnboarding(first, "owner-failure", invalid),
    ).rejects.toThrow();
    expect((await second.collection("projects").get()).size).toBe(0);
    expect((await second.collection("nodes").get()).size).toBe(0);
    expect(
      (await second.collection("system_idempotency_cache").get()).size,
    ).toBe(0);
    expect(
      (
        await second
          .collection("tenants")
          .doc("owner-failure")
          .collection("projects")
          .get()
      ).size,
    ).toBe(0);
    const user = await second.collection("users").doc("owner-failure").get();
    expect(user.get("onboarded")).toBe(false);
    expect(user.get("role")).toBe("operario");
    const retry = await provisionOnboarding(second, "owner-failure", payload);
    expect(retry.result.success).toBe(true);
    expect(
      await counts(first, "owner-failure", retry.result.projectId),
    ).toEqual([1, 1, 1, 1]);
  });

  it("rejects changed content without overwriting the completed records", async () => {
    const a = await provisionOnboarding(first, "owner-conflict", payload);
    await expect(
      provisionOnboarding(second, "owner-conflict", {
        ...payload,
        tier: "oro",
      }),
    ).rejects.toThrow("onboarding_payload_conflict");
    expect(await counts(first, "owner-conflict", a.result.projectId)).toEqual([
      1, 1, 1, 1,
    ]);
    expect(
      (await first.collection("users").doc("owner-conflict").get()).get(
        "subscription.planId",
      ),
    ).toBe("gratis");
  });
});
