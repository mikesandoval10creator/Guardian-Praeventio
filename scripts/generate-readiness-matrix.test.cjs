const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const {
  collectRouteDeclarations,
  collectBackgroundCapabilities,
  buildRouteMatrix,
  buildBackgroundMatrix,
  renderMarkdown,
  ROUTE_FILES,
  BACKGROUND_CAPABILITIES,
} = require("./generate-readiness-matrix.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");

test("ROUTE_FILES covers AppRoutes.tsx plus the seven route groups", () => {
  assert.equal(ROUTE_FILES.length, 8);
  assert.ok(ROUTE_FILES.includes("src/AppRoutes.tsx"));
  assert.ok(ROUTE_FILES.some((p) => p.startsWith("src/routes/")));
});

test("collectRouteDeclarations scans all 8 files and supports `key=` before `path=`", () => {
  const routes = collectRouteDeclarations(REPO_ROOT);
  // Sanity baseline — the actual count is owned by the source and may grow.
  assert.ok(routes.length >= 200, `expected >=200 routes, got ${routes.length}`);
  for (const r of routes) {
    assert.ok(typeof r.surface === "string" && r.surface.length > 0);
    assert.ok(typeof r.sourceLine === "number" && r.sourceLine >= 1);
    assert.ok(ROUTE_FILES.includes(r.sourceFile));
  }
});

test("collectRouteDeclarations counts every declared <Route> per file", () => {
  const routes = collectRouteDeclarations(REPO_ROOT);
  // The repo has 46 cross-file duplicates by design (legacy shadows, demo vs
  // authenticated trees). The contract is: one entry per declaration, even if
  // the same path shows up multiple times in the same or different files.
  const declared = routes.length;
  const unique = new Set(routes.map((r) => r.surface)).size;
  assert.ok(declared > unique, "expect duplicates in the route tree");
  for (const r of routes) {
    assert.ok(typeof r.surface === "string" && r.surface.length > 0);
    assert.ok(typeof r.sourceLine === "number" && r.sourceLine >= 1);
    assert.ok(ROUTE_FILES.includes(r.sourceFile));
  }
});

test("buildRouteMatrix emits six evidence columns as the literal string `unknown`", () => {
  const matrix = buildRouteMatrix([
    { surface: "/x", sourceLine: 1, sourceFile: "src/AppRoutes.tsx" },
  ]);
  assert.equal(matrix.length, 1);
  const row = matrix[0];
  for (const key of [
    "persistence",
    "authorization",
    "automation",
    "realTest",
    "productionEvidence",
  ]) {
    assert.equal(row[key], "unknown", `${key} should be 'unknown'`);
  }
});

test("collectBackgroundCapabilities declares 8 mobile capabilities", () => {
  assert.equal(BACKGROUND_CAPABILITIES.length, 8);
  const caps = collectBackgroundCapabilities(REPO_ROOT);
  assert.equal(caps.length, 8);
  for (const c of caps) {
    assert.ok(typeof c.id === "string" && c.id.length > 0);
    assert.ok(typeof c.label === "string" && c.label.length > 0);
    assert.ok(c.status === "code-present" || c.status === "code-missing");
  }
});

test("renderMarkdown separates route and background-capability sections", () => {
  const routes = collectRouteDeclarations(REPO_ROOT);
  const caps = collectBackgroundCapabilities(REPO_ROOT);
  const md = renderMarkdown({
    routes,
    capabilities: caps,
    routeCount: routes.length,
    capabilityCount: caps.length,
  });
  assert.match(md, /## Route surfaces/);
  assert.match(md, /## Background capabilities/);
  assert.match(md, /Source files scanned: 8 route files \+ 8 background capabilities\./);
  assert.match(md, /unknown/);
});

function withGeneratedFixture(check) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guardian-readiness-"));
  try {
    fs.mkdirSync(path.join(root, "src"));
    fs.writeFileSync(
      path.join(root, "src/AppRoutes.tsx"),
      '<Route path="/fixture" element={<Fixture />} />',
    );
    const markdownPath = path.join(root, "matrix.md");
    const jsonPath = path.join(root, "matrix.json");
    const args = [
      path.join(__dirname, "generate-readiness-matrix.cjs"),
      `--output=${markdownPath}`,
      `--json=${jsonPath}`,
    ];
    const generated = spawnSync(process.execPath, args, {
      cwd: root,
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 65536,
    });
    assert.equal(generated.status, 0, generated.stderr);
    check({ markdownPath, jsonPath, args, cwd: root });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("CLI renders unknown evidence cells for both routes and background capabilities", () => {
  withGeneratedFixture(({ markdownPath, jsonPath }) => {
    const rows = fs.readFileSync(markdownPath, "utf8").split("\n")
      .filter((line) => /^\| (route|background-capability) \|/.test(line));
    const records = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    assert.equal(rows.length, 9, "one declared route and eight background capabilities");
    assert.equal(records.length, 9);
    for (const line of rows) {
      const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
      assert.deepEqual(cells.slice(-5), Array(5).fill("unknown"));
      const surface = cells[2].replaceAll("`", "");
      const record = records.find((row) => row.kind === cells[0] && row.surface === surface);
      assert.ok(record, `matching JSON record for ${surface}`);
      for (const field of ["persistence", "authorization", "automation", "realTest", "productionEvidence"]) {
        assert.equal(record[field], "unknown");
      }
      if (record.kind === "background-capability") {
        assert.equal(cells[3], "code-missing", "fixture has no native capabilities");
      }
    }
  });
});

test("CLI check rejects stale JSON even when Markdown remains current", () => {
  withGeneratedFixture(({ jsonPath, args, cwd }) => {
    const valid = spawnSync(process.execPath, [...args, "--check"], { cwd, encoding: "utf8", timeout: 10000 });
    assert.equal(valid.status, 0, valid.stderr);
    fs.writeFileSync(jsonPath, "[]\n");
    const stale = spawnSync(process.execPath, [...args, "--check"], { cwd, encoding: "utf8", timeout: 10000 });
    assert.equal(stale.status, 1, "check must reject JSON that no longer matches source");
    assert.ok(stale.stderr.includes(jsonPath));
  });
});
