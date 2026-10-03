// The actual route adapter, two independent Admin SDK clients, one emulator.
// This covers store scheduling only: no auth/rules, HTTP, device or production claim.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getEmulatorAdminFirestore } from "../../test/firestore-emulator-setup";
import { buildTaskStore } from "../../server/routes/horometro";
import {
  buildMaintenanceTask,
  scheduleMaintenanceTask,
} from "../../services/maintenance/maintenanceScheduler";

const TENANT = "maintenance-concurrency-tenant";
const PROJECT = "maintenance-concurrency-project";
const taskPath = `tenants/${TENANT}/projects/${PROJECT}/maintenance_tasks`;
let apps: App[] = [];
let clients: Firestore[] = [];

function task(equipmentId = "compressor-a", actor = "actor-a") {
  return buildMaintenanceTask({
    projectId: PROJECT,
    equipmentId,
    equipmentType: "compresor",
    cross: {
      cycleHours: 250,
      multiplier: 1,
      triggeredAtHours: 250,
      severity: "low",
    },
    triggeredAtIso: "2026-10-01T10:00:00.000Z",
    createdBy: actor,
    notes: `Original notes from ${actor}`,
  });
}

beforeAll(() => {
  const projectId = process.env.GCLOUD_PROJECT ?? "praeventio-test";
  apps = ["maintenance-actor-a", "maintenance-actor-b"].map((name) =>
    initializeApp({ projectId }, name),
  );
  clients = apps.map((app) => getFirestore(app));
});

afterAll(async () => {
  await Promise.all(clients.map((db) => db.terminate()));
  await Promise.all(apps.map((app) => deleteApp(app)));
});

describe("maintenance task scheduling against Firestore", () => {
  it("returns one unchanged winner to two independent concurrent schedulers", async () => {
    const candidates = [
      task("compressor-a", "actor-a"),
      task("compressor-a", "actor-b"),
    ];
    const stores = clients.map((db) => buildTaskStore(db, TENANT));
    const results = await Promise.all(
      stores.map((store, index) =>
        scheduleMaintenanceTask(
          { tenantId: TENANT, task: candidates[index] },
          store,
        ),
      ),
    );
    const snapshot = await getEmulatorAdminFirestore()
      .collection(taskPath)
      .get();
    expect(snapshot.docs).toHaveLength(1);
    const persisted = snapshot.docs[0].data();
    expect(candidates).toContainEqual(persisted);
    expect(results).toEqual([persisted, persisted]);
  });

  it.each(["cancelled", "completed", "scheduled", "in_progress"] as const)(
    "preserves persisted %s metadata under concurrent threshold replay",
    async (status) => {
      const original = {
        ...task(),
        status,
        notes: "Keep the operator decision",
        ...(status === "completed"
          ? {
              completion: {
                completedByUid: "technician",
                completedAt: "2026-10-01T11:00:00.000Z",
                notes: "Signed closure",
                biometricSignatureHash: "test-signature-hash",
                horometroAtCompletion: 275,
              },
            }
          : {}),
      };
      const admin = getEmulatorAdminFirestore();
      await admin.collection(taskPath).doc(original.id).set(original);
      const results = await Promise.all(
        clients.map((db, index) =>
          scheduleMaintenanceTask(
            { tenantId: TENANT, task: task("compressor-a", `replay-${index}`) },
            buildTaskStore(db, TENANT),
          ),
        ),
      );
      expect(results).toEqual([original, original]);
      expect(
        (await admin.collection(taskPath).doc(original.id).get()).data(),
      ).toEqual(original);
    },
  );

  it("creates the next threshold without reopening the cancelled previous cycle", async () => {
    const original = {
      ...task(),
      status: "cancelled" as const,
      notes: "Operator cancelled cycle one",
    };
    const admin = getEmulatorAdminFirestore();
    await admin.collection(taskPath).doc(original.id).set(original);
    const next = buildMaintenanceTask({
      projectId: PROJECT,
      equipmentId: original.equipmentId,
      equipmentType: original.equipmentType,
      cross: {
        cycleHours: 250,
        multiplier: 2,
        triggeredAtHours: 500,
        severity: "low",
      },
      triggeredAtIso: "2026-10-02T10:00:00.000Z",
      notes: "A genuinely new threshold",
    });
    const result = await scheduleMaintenanceTask(
      { tenantId: TENANT, task: next },
      buildTaskStore(clients[0], TENANT),
    );
    expect(result).toEqual(next);
    const snapshot = await admin.collection(taskPath).get();
    expect(snapshot.docs).toHaveLength(2);
    expect(
      (await admin.collection(taskPath).doc(original.id).get()).data(),
    ).toEqual(original);
    expect(
      (await admin.collection(taskPath).doc(next.id).get()).data(),
    ).toEqual(next);
  });

  it.each([
    { boundary: "tenant", tenantId: "other-tenant", projectId: PROJECT },
    { boundary: "project", tenantId: TENANT, projectId: "other-project" },
  ])(
    "isolates the same deterministic task ID by $boundary",
    async ({ tenantId, projectId }) => {
      const original = { ...task(), status: "cancelled" as const };
      const other = { ...task("compressor-a", "other-actor"), projectId };
      const admin = getEmulatorAdminFirestore();
      await admin.collection(taskPath).doc(original.id).set(original);
      const result = await scheduleMaintenanceTask(
        { tenantId, task: other },
        buildTaskStore(clients[1], tenantId),
      );
      expect(result).toEqual(other);
      expect(
        (await admin.collection(taskPath).doc(original.id).get()).data(),
      ).toEqual(original);
      expect(
        (
          await admin
            .doc(
              `tenants/${tenantId}/projects/${projectId}/maintenance_tasks/${other.id}`,
            )
            .get()
        ).data(),
      ).toEqual(other);
    },
  );
});
