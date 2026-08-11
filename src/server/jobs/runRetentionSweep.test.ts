// Tests para runRetentionSweep — Ticket 39baa66d-73fe-81f8-b9f0-da5503007f5b.
//
// Contrato: el job recorre las colecciones cubiertas por el motor de
// retención, evalúa cada doc con `decideRetention`, respeta legal holds,
// NO purga `audit_log` (preserva trazabilidad), y persiste un informe
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
    // 2 docs keep_active, 1 archive_immutable, 1 purge (no legal hold),
    // 1 purge bloqueado por legal hold -> archive_immutable, 1 audit_log viejo.
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
    // Aplica acciones reales: purga docs elegibles y archiva docs que salieron
    // de ventana activa (incluyendo legal hold) en una colección inmutable.
    expect((await db.doc("discrepancies/d3").get()).exists).toBe(false);
    expect(
      (await db.doc("retention_archives/discrepancies/d4").get()).exists,
    ).toBe(true);
    // Audit log nunca se purga — el job debe reportar la decisión pero
    // no invocar una acción de delete sobre la colección.
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
    });
  });

  it("is idempotent — re-running on the same data produces the same report", async () => {
    const db = createFakeFirestore();
    seedDoc(db, "discrepancies/y", {
      id: "y",
      category: "attendance",
      jurisdiction: "CL",
      createdAt: "2026-07-31T00:00:00.000Z",
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
  });
});
