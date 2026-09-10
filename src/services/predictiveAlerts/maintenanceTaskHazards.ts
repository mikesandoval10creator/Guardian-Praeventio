// SPDX-License-Identifier: MIT
//
// maintenanceTaskHazards — derives the pre-warn hazard tags that the
// calendar pre-warn cron needs from real MaintenanceTask documents.
//
// The pre-warn engine (`predictiveAlerts/calendarPreWarn.ts`) speaks in
// terms of `hazardTags` ('at-height' | 'confined-space' | 'outdoor' |
// 'heavy-lifting' | 'electrical') because that is what
// `detectHazards()` cross-checks against weather/seismic. MaintenanceTask
// docs do not carry those tags directly — they carry `equipmentType` and
// `severity`. We map equipment classes to hazard tags here so the cron
// can run against the actual repo schema (`tenants/{tid}/projects/{pid}
// /maintenance_tasks`) instead of pretending `projects/{pid}/tasks` with
// `hazardTags` exists.
//
// The mapping is conservative: only equipment classes that have an
// unambiguous outdoor / at-height / confined / electrical / heavy-lift
// profile are returned. Unknown equipmentType yields an empty array so
// the cron skips the row honestly — no fabricated hazard.

import type { MaintenanceTask } from "../maintenance/maintenanceScheduler.js";

export type HazardTag =
  "at-height" | "confined-space" | "outdoor" | "heavy-lifting" | "electrical";

const AT_HEIGHT = new Set<string>([
  "crane",
  "manlift",
  "scissor_lift",
  "boom_lift",
  "cherry_picker",
  "scaffold",
  "ladder",
  "rooftop_unit",
  "antenna",
]);

const CONFINED_SPACE = new Set<string>([
  "tank",
  "vat",
  "silo",
  "boiler",
  "chamber",
  "manhole",
  "pipeline_internal",
]);

const OUTDOOR = new Set<string>([
  "excavator",
  "bulldozer",
  "loader",
  "dump_truck",
  "haul_truck",
  "crane", // outdoor cranes are double-tagged (at-height + outdoor)
  "manlift", // outdoor manlifts are double-tagged
  "rooftop_unit",
  "antenna",
  "tower",
]);

const HEAVY_LIFTING = new Set<string>([
  "crane",
  "forklift",
  "telehandler",
  "hoist",
  "winch",
]);

const ELECTRICAL = new Set<string>([
  "panel",
  "transformer",
  "switchgear",
  "generator",
  "ups",
  "motor",
  "inverter",
]);

function norm(value: string | undefined | null): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/**
 * Pure: derive hazard tags from a MaintenanceTask. Severity is intentionally
 * NOT used to inflate hazard tags — only equipment class drives the
 * classification. The pre-warn engine's `detectHazards()` will skip the row
 * if weather/seismic does not match.
 *
 * Returns an empty array for unknown / unmapped equipment. That is the
 * honest answer — better to skip than to fabricate a hazard.
 */
export function maintenanceTaskHazardTags(
  task: Pick<MaintenanceTask, "equipmentType">,
): HazardTag[] {
  const eq = norm(task.equipmentType);
  if (!eq) return [];
  const out: HazardTag[] = [];
  if (AT_HEIGHT.has(eq)) out.push("at-height");
  if (CONFINED_SPACE.has(eq)) out.push("confined-space");
  if (OUTDOOR.has(eq)) out.push("outdoor");
  if (HEAVY_LIFTING.has(eq)) out.push("heavy-lifting");
  if (ELECTRICAL.has(eq)) out.push("electrical");
  return out;
}
