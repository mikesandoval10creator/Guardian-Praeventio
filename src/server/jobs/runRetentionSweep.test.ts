// Tests para runRetentionSweep — Ticket 39baa66d-73fe-81f8-b9f0-da5503007f5b.
//
// Contrato: el job recorre las colecciones cubiertas por el motor de
// retención, evalúa cada doc con `decideRetention`, respeta legal holds,
// NO elimina documentos fuente (preserva prevención y trazabilidad), y persiste un informe
// por ejecucion en `retention_sweep_runs/{runId}` con métricas.

import { describe, it, expect, beforeEach } from "vitest";
import { createFakeFirestore } from "../../__tests__/helpers/fakeFirestore";
import { runRetentionSweep } from "./runRetentionSweep.js";
import type { RetentionRule } from "../../services/privacyRetention/dataRetentionPolicy.js";

const FAKE_NOW = "2026-08-01T00:00:00.000Z";

beforeEach(() => {
  // No global setup needed; each test seeds its own dataset.
});

function seedDoc(
  db: ReturnType<typeof createFakeFirestore>,
  path: string,
  data: Record<string, unknown>,
) {
  db._seed(path, data);
}

describe("runRetentionSweep — apply policy to real data", () => {
  it("returns a typed report with the categories swept + counts per action", async () => {
    const db = createFakeFirestore();
    // 1 doc queda activo y 4 quedan archive_immutable: d2 se degrada desde
    // purge, d3 sale de la ventana activa, d4 tiene legal hold y a1 es audit_log.
    seedDoc(db, "discrepancies/d1", {
      id: "d1",
      category: "audit_log",
      jurisdiction: "CL",
      createdAt: "2026-07-30T00:00:00.000Z",
      legalHold: false,
    });
    seedDoc(db, "discrepancies/d2", {
      id: "d2",
      category: "attendance",
      jurisdiction: "CL",
      createdAt: "2025-01-01T00:00:00.000Z",
      legalHold: false,
    });
    seedDoc(db, "discrepancies/d3", {
      id: "d3",
      category: "medical_diagnosis",
      jurisdiction: "CL",
      createdAt: "2023-01-01T00:00:00.000Z",
      legalHold: false,
    });
    seedDoc(db, "discrepancies/d4", {
      id: "d4",
      category: "medical_diagnosis",
      jurisdiction: "CL",
      createdAt: "2023-01-01T00:00:00.000Z",
      legalHold: true, // block purge
    });
    seedDoc(db, "audit_log/a1", {
      id: "a1",
      category: "audit_log",
      jurisdiction: "CL",
      createdAt: "2020-01-01T00:00:00.000Z",
      legalHold: false,
    });

    const result = await runRetentionSweep(db, {
      now: new Date(FAKE_NOW),
      categories: ["audit_log", "attendance", "medical_diagnosis"],
      defaultRules: [
        // d1 (2 días de edad) queda activo; a1 (audit_log 2020) igual gatilla
        // la guarda anti-delete del job.
        {
          category: "audit_log",
          jurisdiction: "CL",
          activeDays: 10,
          totalDays: 30,
        },
        {
          category: "attendance",
          jurisdiction: "CL",
          activeDays: 30,
          totalDays: 365,
        },
        {
          category: "medical_diagnosis",
          jurisdiction: "CL",
          activeDays: 365,
          totalDays: 3650,
        },
      ],
    });

    expect(result.runId).toMatch(/^[a-z0-9-]+$/);
    expect(result.totalDocs).toBe(5);
    expect(result.counts.keep_active).toBeGreaterThanOrEqual(1); // d1
    expect(result.counts.archive_immutable).toBeGreaterThanOrEqual(1); // d4 (legal hold)
    expect(result.decisions).toHaveLength(5);
    const d4 = result.decisions.find((d) => d.recordId === "d4");
    expect(d4?.action).toBe("archive_immutable");
    expect(d4?.blockedByLegalHold).toBe(true);
    // ADR-0024: los documentos de prevención nunca se eliminan. Los registros
    // fuera de ventana se conservan y se copia una versión inmutable para
    // separar archivo de eliminación.
    expect((await db.doc("discrepancies/d3").get()).exists).toBe(true);
    expect(
      (await db.doc("retention_archives/discrepancies/d3").get()).exists,
    ).toBe(true);
    const d2 = result.decisions.find((d) => d.recordId === "d2");
    expect(d2?.action).toBe("archive_immutable");
    expect(d2?.rationale).toMatch(/ADR-0024/i);
    const d3 = result.decisions.find((d) => d.recordId === "d3");
    expect(d3?.action).toBe("archive_immutable");
    expect(result.counts.purge).toBe(0);
    expect(result.purged).toBe(0);
    expect(
      (await db.doc("retention_archives/discrepancies/d4").get()).exists,
    ).toBe(true);
    // Audit log nunca se elimina — el job debe reportar la decisión pero
    // no invocar una acción destructiva sobre la colección.
    expect((await db.doc("audit_log/a1").get()).exists).toBe(true);
    expect(result.auditLogLeftAlone).toBe(true);
  });

  it("never purges audit_log even when policy says purge (preserva trazabilidad)", async () => {
    const db = createFakeFirestore();
    seedDoc(db, "audit_log/old", {
      id: "old",
      category: "audit_log",
      jurisdiction: "CL",
      createdAt: "2020-01-01T00:00:00.000Z",
      legalHold: false,
    });
    const result = await runRetentionSweep(db, {
      now: new Date(FAKE_NOW),
      categories: ["audit_log"],
      // Policy purga audit_log (sin la guarda del job).
      defaultRules: [
        {
          category: "audit_log",
          jurisdiction: "CL",
          activeDays: 1,
          totalDays: 30,
        },
      ],
    });
    const decision = result.decisions[0];
    expect(decision.action).toBe("archive_immutable");
    expect(decision.rationale).toMatch(/audit_log/i);
    expect(result.counts.purge).toBe(0);
    expect(result.purged).toBe(0);
    expect((await db.doc("audit_log/old").get()).exists).toBe(true);
    expect((await db.doc("retention_archives/audit_log/old").get()).exists).toBe(true);
  });

  it("persists a run report at retention_sweep_runs/{runId}", async () => {
    const db = createFakeFirestore();
    seedDoc(db, "discrepancies/x", {
      id: "x",
      category: "attendance",
      jurisdiction: "CL",
      createdAt: "2026-07-25T00:00:00.000Z",
      legalHold: false,
    });
    const result = await runRetentionSweep(db, {
      now: new Date(FAKE_NOW),
      categories: ["attendance"],
      defaultRules: [
        {
          category: "attendance",
          jurisdiction: "CL",
          activeDays: 30,
          totalDays: 365,
        },
      ],
    });
    const report = await db.doc(`retention_sweep_runs/${result.runId}`).get();
    expect(report.data()).toMatchObject({
      runId: result.runId,
      totalDocs: 1,
      now: FAKE_NOW,
      counts: { purge: 0 },
      purged: 0,
    });
  });

  it("is idempotent — re-running on the same data produces the same report", async () => {
    const db = createFakeFirestore();
    seedDoc(db, "discrepancies/y", {
      id: "y",
      category: "attendance",
      jurisdiction: "CL",
      createdAt: "2024-01-01T00:00:00.000Z",
      legalHold: false,
    });
    const opts = {
      now: new Date(FAKE_NOW),
      categories: ["attendance"] as const,
      defaultRules: [
        {
          category: "attendance",
          jurisdiction: "CL",
          activeDays: 30,
          totalDays: 365,
        },
      ] satisfies RetentionRule[],
    };
    const r1 = await runRetentionSweep(db, opts);
    const r2 = await runRetentionSweep(db, opts);
    expect(r1.counts).toEqual(r2.counts);
    expect(r1.decisions).toEqual(r2.decisions);
    expect(r1.purged).toBe(0);
    expect(r2.purged).toBe(0);
    expect((await db.doc("discrepancies/y").get()).exists).toBe(true);
    expect(
      (await db.doc("retention_archives/discrepancies/y").get()).exists,
    ).toBe(true);
  });

  it("preserves every source when prevention collection paths yield purge", async () => {
    const db = createFakeFirestore();
    const cases = [
      { path: "incidents/i1", category: "incident" as const },
      { path: "medical_records/m1", category: "medical_diagnosis" as const },
      { path: "training_records/t1", category: "training_record" as const },
      { path: "epp_assignments/e1", category: "epp_assignment" as const },
      { path: "sensor_telemetry/s1", category: "sensor_telemetry" as const },
      { path: "communication_logs/c1", category: "communication_log" as const },
      { path: "document_versions/v1", category: "document_version" as const },
    ];
    for (const { path, category } of cases) {
      seedDoc(db, path, {
        category,
        jurisdiction: "CL",
        createdAt: "2020-01-01T00:00:00.000Z",
        legalHold: false,
      });
    }
    const rules: RetentionRule[] = cases.map(({ category }) => ({
      category,
      jurisdiction: "CL",
      activeDays: 1,
      totalDays: 30,
    }));

    const result = await runRetentionSweep(db, {
      now: new Date(FAKE_NOW),
      categories: cases.map(({ category }) => category),
      collectionPaths: cases.map(({ path }) => path.split("/")[0]),
      defaultRules: rules,
    });

    expect(result.decisions).toHaveLength(cases.length);
    expect(result.counts.purge).toBe(0);
    expect(result.purged).toBe(0);
    expect(result.archived).toBe(cases.length);
    for (const { path } of cases) {
      const [collectionPath, docId] = path.split("/");
      expect((await db.doc(path).get()).exists).toBe(true);
      expect(
        (await db.doc(`retention_archives/${collectionPath}/${docId}`).get())
          .exists,
      ).toBe(true);
    }
  });

  it("blocks an immediate purge from a zero-day custom rule", async () => {
    const db = createFakeFirestore();
    seedDoc(db, "sensor_telemetry/immediate", {
      category: "sensor_telemetry",
      jurisdiction: "CL",
      createdAt: "2020-01-01T00:00:00.000Z",
      legalHold: false,
    });

    const result = await runRetentionSweep(db, {
      now: new Date(FAKE_NOW),
      categories: ["sensor_telemetry"],
      collectionPaths: ["sensor_telemetry"],
      defaultRules: [
        {
          category: "sensor_telemetry",
          jurisdiction: "CL",
          activeDays: 0,
          totalDays: 0,
        },
      ],
    });

    expect(result.purged).toBe(0);
    expect(result.counts.purge).toBe(0);
    expect(result.decisions[0]?.action).toBe("archive_immutable");
    expect(result.decisions[0]?.rationale).toMatch(/ADR-0024/i);
    expect((await db.doc("sensor_telemetry/immediate").get()).exists).toBe(true);
    expect(
      (await db.doc("retention_archives/sensor_telemetry/immediate").get()).exists,
    ).toBe(true);
  });

  it("skips incomplete or unknown records without deleting them", async () => {
    const db = createFakeFirestore();
    seedDoc(db, "discrepancies/missing-fields", {
      category: "attendance",
      jurisdiction: "CL",
    });
    seedDoc(db, "discrepancies/unknown-category", {
      category: "unclassified_future_category",
      jurisdiction: "CL",
      createdAt: "2020-01-01T00:00:00.000Z",
    });

    const result = await runRetentionSweep(db, {
      now: new Date(FAKE_NOW),
      collectionPaths: ["discrepancies"],
    });

    expect(result.totalDocs).toBe(0);
    expect(result.purged).toBe(0);
    expect((await db.doc("discrepancies/missing-fields").get()).exists).toBe(true);
    expect((await db.doc("discrepancies/unknown-category").get()).exists).toBe(true);
  });
});
