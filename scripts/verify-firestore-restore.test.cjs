"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertStagingProject,
  validateRestoredSnapshot,
} = require("./verify-firestore-restore.cjs");

test("refuses production and requires an explicit staging target", () => {
  assert.throws(
    () => assertStagingProject("praeventio-prod"),
    /refusing real restore into production/i,
  );
  assert.throws(() => assertStagingProject(""), /staging project is required/i);
  assert.doesNotThrow(() => assertStagingProject("praeventio-staging"));
});

test("validates manifest counts and project references after import", () => {
  const report = validateRestoredSnapshot(
    {
      collectionCounts: { projects: 2, crews: 2, processes: 2 },
    },
    {
      projects: [{ id: "p1" }, { id: "p2" }],
      crews: [
        { id: "c1", projectId: "p1" },
        { id: "c2", projectId: "p2" },
      ],
      processes: [
        { id: "x1", projectId: "p1" },
        { id: "x2", projectId: "p2" },
      ],
    },
  );
  assert.deepEqual(report, {
    countMismatches: [],
    orphanCrews: [],
    orphanProcesses: [],
    healthy: true,
  });
});

test("reports count and referential-integrity failures", () => {
  const report = validateRestoredSnapshot(
    { collectionCounts: { projects: 1, crews: 3, processes: 1 } },
    {
      projects: [{ id: "p1" }],
      crews: [{ id: "c1", projectId: "missing" }, { id: "c2" }],
      processes: [{ id: "x1", projectId: "missing" }],
    },
  );
  assert.deepEqual(report.countMismatches, [
    { collection: "crews", expected: 3, actual: 2 },
  ]);
  assert.deepEqual(report.orphanCrews, ["c1", "c2"]);
  assert.deepEqual(report.orphanProcesses, ["x1"]);
  assert.equal(report.healthy, false);
});
