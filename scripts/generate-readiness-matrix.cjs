#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const UNKNOWN = "unknown";

function extractRoutes(source) {
  const routes = [];
  const seen = new Set();
  const routePattern = /<Route\s+path=["']([^"']+)["']/g;
  let match;

  while ((match = routePattern.exec(source)) !== null) {
    const route = match[1];
    if (seen.has(route)) continue;
    seen.add(route);
    const sourceLine = source.slice(0, match.index).split("\n").length;
    routes.push({ path: route, sourceLine });
  }

  return routes;
}

function buildMatrix(source) {
  return extractRoutes(source).map(({ path: surface, sourceLine }) => ({
    surface,
    sourceLine,
    persistence: UNKNOWN,
    authorization: UNKNOWN,
    automation: UNKNOWN,
    realTest: UNKNOWN,
    productionEvidence: UNKNOWN,
  }));
}

function renderMarkdown(matrix) {
  const rows = matrix.map(
    (row) =>
      `| \`${row.surface}\` | \`${row.sourceLine}\` | ${row.persistence} | ${row.authorization} | ${row.automation} | ${row.realTest} | ${row.productionEvidence} |`,
  );

  return `<!-- prettier-ignore-start -->\n# Guardian readiness matrix\n\n> Generated from the unique route surfaces declared in \`src/AppRoutes.tsx\`.\n> This is an evidence ledger, not a claim that unknown cells are healthy.\n\n## Measurement\n\n- Measured route surfaces: ${matrix.length}\n- Historical denominators such as 202 product surfaces are not assumed here unless a versioned source inventory provides them.\n- \`${UNKNOWN}\` means that this pass has not found authoritative evidence; it must not be read as pass.\n- Evidence classes are intentionally separate: code presence, persistence, tenant-scoped authorization, provisioned automation, real test execution, and production evidence.\n\n## Matrix\n\n| Surface | Source line | Persistencia real | Autorización tenant-scoped | Automatización provisionada/verificada | Prueba real | Evidencia de producción |\n|---|---:|---|---|---|---|---|\n${rows.join("\n")}\n<!-- prettier-ignore-end -->\n`;
}

function main(argv = process.argv.slice(2)) {
  const check = argv.includes("--check");
  const input = path.resolve(
    argv.find((arg) => arg.startsWith("--input="))?.slice(8) ??
      "src/AppRoutes.tsx",
  );
  const output = path.resolve(
    argv.find((arg) => arg.startsWith("--output="))?.slice(9) ??
      "docs/readiness/READINESS_MATRIX.md",
  );
  const markdown = renderMarkdown(buildMatrix(fs.readFileSync(input, "utf8")));

  if (check) {
    const current = fs.readFileSync(output, "utf8");
    if (current !== markdown) {
      process.stderr.write(`Readiness matrix is stale: ${output}\n`);
      process.exitCode = 1;
    }
    return;
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, markdown);
  process.stdout.write(`Generated ${output}\n`);
}

if (require.main === module) main();

module.exports = { UNKNOWN, extractRoutes, buildMatrix, renderMarkdown };
