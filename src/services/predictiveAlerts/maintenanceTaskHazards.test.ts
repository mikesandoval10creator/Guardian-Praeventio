// SPDX-License-Identifier: MIT
//
// maintenanceTaskHazards — pure mapping tests. The mapper is the contract
// between the real MaintenanceTask schema and the calendar pre-warn
// engine. These tests pin the mapping to known equipment classes so a
// future addition or removal of an entry is a conscious, testable change.

import { describe, it, expect } from "vitest";
import { maintenanceTaskHazardTags } from "./maintenanceTaskHazards";
import type { MaintenanceTask } from "../maintenance/maintenanceScheduler.js";

function task(overrides: Partial<MaintenanceTask>): MaintenanceTask {
  return {
    id: "mt-1",
    projectId: "p1",
    equipmentId: "eq-1",
    equipmentType: "crane",
    thresholdHours: 1000,
    triggeredAtHours: 1000,
    multiplier: 1,
    severity: "critical",
    status: "scheduled",
    dueAtIso: "2026-09-15T00:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    createdBy: "system",
    ...overrides,
  };
}

describe("maintenanceTaskHazardTags", () => {
  it("maps at-height equipment to at-height + outdoor + heavy-lifting", () => {
    const tags = maintenanceTaskHazardTags(task({ equipmentType: "crane" }));
    expect(tags).toEqual(
      expect.arrayContaining(["at-height", "outdoor", "heavy-lifting"]),
    );
    expect(tags).not.toContain("confined-space");
    expect(tags).not.toContain("electrical");
  });

  it("maps electrical equipment to electrical only", () => {
    const tags = maintenanceTaskHazardTags(
      task({ equipmentType: "transformer" }),
    );
    expect(tags).toEqual(["electrical"]);
  });

  it("maps confined-space equipment to confined-space", () => {
    const tags = maintenanceTaskHazardTags(task({ equipmentType: "tank" }));
    expect(tags).toEqual(["confined-space"]);
  });

  it("returns an empty array for unknown equipment class — NO fabricated hazard", () => {
    expect(
      maintenanceTaskHazardTags(task({ equipmentType: "spaceship" })),
    ).toEqual([]);
    expect(maintenanceTaskHazardTags(task({ equipmentType: "" }))).toEqual([]);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(
      maintenanceTaskHazardTags(task({ equipmentType: "  Crane  " })),
    ).toEqual(maintenanceTaskHazardTags(task({ equipmentType: "crane" })));
  });

  it("does NOT inflate hazards based on severity — severity is not a hazard tag", () => {
    const low = maintenanceTaskHazardTags(
      task({ equipmentType: "spaceship", severity: "critical" }),
    );
    expect(low).toEqual([]);
    const crit = maintenanceTaskHazardTags(
      task({ equipmentType: "spaceship", severity: "critical" }),
    );
    expect(crit).toEqual([]);
  });

  it("is pure — same input yields same output", () => {
    const a = maintenanceTaskHazardTags(task({ equipmentType: "manlift" }));
    const b = maintenanceTaskHazardTags(task({ equipmentType: "manlift" }));
    expect(a).toEqual(b);
  });
});
