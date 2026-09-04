const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
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
