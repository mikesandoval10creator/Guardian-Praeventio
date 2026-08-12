const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildMatrix,
  extractRoutes,
  renderMarkdown,
} = require("./generate-readiness-matrix.cjs");

test("extractRoutes returns unique route surfaces with source lines", () => {
  const source = `
    <Route path="/" element={<Landing />} />
    <Route path="/emergency" element={<Emergency />} />
    <Route path="/emergency" element={<Emergency />} />
  `;

  assert.deepEqual(extractRoutes(source), [
    { path: "/", sourceLine: 2 },
    { path: "/emergency", sourceLine: 3 },
  ]);
});

test("buildMatrix defaults every evidence dimension to unknown", () => {
  const matrix = buildMatrix(
    '    <Route path="/settings" element={<Settings />} />\n',
  );

  assert.equal(matrix.length, 1);
  assert.deepEqual(matrix[0], {
    surface: "/settings",
    sourceLine: 1,
    persistence: "unknown",
    authorization: "unknown",
    automation: "unknown",
    realTest: "unknown",
    productionEvidence: "unknown",
  });
});

test("renderMarkdown includes measured denominator and six evidence columns", () => {
  const markdown = renderMarkdown(
    buildMatrix('<Route path="/" element={<Landing />} />\n'),
  );

  assert.match(markdown, /Measured route surfaces: 1/);
  assert.match(markdown, /Persistencia real/);
  assert.match(markdown, /Autorización tenant-scoped/);
  assert.match(markdown, /Prueba real/);
  assert.match(markdown, /Evidencia de producción/);
  assert.match(markdown, /unknown/);
});
