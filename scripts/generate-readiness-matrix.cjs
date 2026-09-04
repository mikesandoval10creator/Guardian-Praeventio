#!/usr/bin/env node
"use strict";

/**
 * Guardian Praeventio — readiness matrix generator.
 *
 * Builds a markdown evidence ledger from:
 *   - every <Route> declared in `src/AppRoutes.tsx` and `src/routes/*Routes.tsx`
 *   - every background capability declared under `src/services/mobile/`,
 *     `android/app/src/main/AndroidManifest.xml`,
 *     `packages/capacitor-mandown/android/src/main/AndroidManifest.xml`,
 *     `android/app/src/main/kotlin/`,
 *     and the work-manager / FCM / Health Connect surfaces.
 *
 * The output never claims an `unknown` cell is healthy; it is a contract for
 * the next owner to fill with evidence. The matrix is checked in CI and is a
 * G2 release gate for v1.0.0.
 *
 * Usage:
 *   node scripts/generate-readiness-matrix.cjs [--check]
 *       [--input=<file>] [--output=<file>] [--json=<file>]
 */

const fs = require("node:fs");
const path = require("node:path");

const UNKNOWN = "unknown";

const ROUTE_FILES = [
  "src/AppRoutes.tsx",
  "src/routes/AIRoutes.tsx",
  "src/routes/ComplianceRoutes.tsx",
  "src/routes/EmergencyRoutes.tsx",
  "src/routes/HealthRoutes.tsx",
  "src/routes/OperationsRoutes.tsx",
  "src/routes/RiskRoutes.tsx",
  "src/routes/TrainingRoutes.tsx",
];

const ROUTE_PATTERN = /<Route\b[^>]*?\bpath\s*=\s*["']([^"']+)["']/gis;

const BACKGROUND_CAPABILITIES = [
  {
    id: "fgs-location-health",
    label: "Android FGS `location|health` para lone-worker check-in",
    evidencePaths: [
      "android/app/src/main/AndroidManifest.xml",
      "src/services/mobile/foregroundServiceClient.ts",
      "src/services/mobile/batteryOptimization.ts",
    ],
    requiredFragments: [
      /foregroundServiceType\s*=\s*"location\|health"/i,
      /FOREGROUND_SERVICE_LOCATION/,
      /FOREGROUND_SERVICE_HEALTH/,
    ],
  },
  {
    id: "fgs-mandown",
    label: "Plugin nativo `capacitor-mandown` con FGS `health`",
    evidencePaths: [
      "packages/capacitor-mandown/android/src/main/AndroidManifest.xml",
      "packages/capacitor-mandown/android/src/main/kotlin/",
    ],
    requiredFragments: [
      /foregroundServiceType\s*=\s*"health"/i,
      /FOREGROUND_SERVICE_HEALTH/,
    ],
  },
  {
    id: "fcm-listener",
    label: "FCM push con listener en background",
    evidencePaths: ["android/app/src/main/AndroidManifest.xml"],
    requiredFragments: [/FirebaseMessagingService|FCMService/],
  },
  {
    id: "workmanager-jobs",
    label: "WorkManager para jobs diferidos (cola offline)",
    evidencePaths: ["android/app/src/main/AndroidManifest.xml"],
    requiredFragments: [/androidx\.work\.WorkManager|WorkManagerInitializer/],
  },
  {
    id: "health-connect",
    label: "Integración Health Connect",
    evidencePaths: ["android/app/src/main/AndroidManifest.xml"],
    requiredFragments: [/androidx\.health\.connect|HEALTH_CONNECT_PERMISSION/],
  },
  {
    id: "geolocation",
    label: "Geolocalización en background (single watcher)",
    evidencePaths: ["src/services/mobile/"],
    requiredFragments: [/geolocationSingleWatcher|useGeolocationWatcher/],
  },
  {
    id: "ble-mesh",
    label: "Plugin BLE/Mesh offline",
    evidencePaths: ["packages/capacitor-mesh/"],
    requiredFragments: [/BluetoothLeScanner|startScan|startMesh/],
  },
  {
    id: "battery-optimization",
    label: "Battery optimization helper (Doze / App Standby)",
    evidencePaths: ["src/services/mobile/batteryOptimization.ts"],
    requiredFragments: [/REQUEST_IGNORE_BATTERY_OPTIMIZATIONS|isIgnoringBatteryOptimizations/],
  },
];

const UNKNOWN_CATEGORIES = {
  persistence: "unknown",
  authorization: "unknown",
  automation: "unknown",
  realTest: "unknown",
  productionEvidence: "unknown",
};

function collectRouteDeclarations(repoRoot) {
  const collected = [];
  for (const rel of ROUTE_FILES) {
    const abs = path.join(repoRoot, rel);
    if (!fs.existsSync(abs)) continue;
    const source = fs.readFileSync(abs, "utf8");
    let match;
    ROUTE_PATTERN.lastIndex = 0;
    while ((match = ROUTE_PATTERN.exec(source)) !== null) {
      const route = match[1];
      const sourceLine = source.slice(0, match.index).split("\n").length;
      collected.push({
        surface: route,
        sourceLine,
        sourceFile: rel,
      });
    }
  }
  return collected;
}

function collectBackgroundCapabilities(repoRoot) {
  const collected = [];
  for (const cap of BACKGROUND_CAPABILITIES) {
    const sources = [];
    for (const rel of cap.evidencePaths) {
      const abs = path.join(repoRoot, rel);
      if (!fs.existsSync(abs)) continue;
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        for (const entry of walk(abs)) {
          if (/\.(ts|tsx|js|jsx|kt|java|xml|gradle|kts)$/i.test(entry)) {
            sources.push(fs.readFileSync(entry, "utf8"));
          }
        }
      } else {
        sources.push(fs.readFileSync(abs, "utf8"));
      }
    }
    const joined = sources.join("\n\n/* file boundary */\n\n");
    const missing = cap.requiredFragments.filter((rx) => !rx.test(joined));
    collected.push({
      id: cap.id,
      label: cap.label,
      sourceFile: cap.evidencePaths[0],
      status: missing.length === 0 ? "code-present" : "code-missing",
      missingFragments: missing.map((rx) => rx.source),
    });
  }
  return collected;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(child));
    else out.push(child);
  }
  return out;
}

function buildRouteMatrix(routes) {
  return routes.map((route) => ({
    kind: "route",
    surface: route.surface,
    sourceLine: route.sourceLine,
    sourceFile: route.sourceFile,
    persistence: "unknown",
    authorization: "unknown",
    automation: "unknown",
    realTest: "unknown",
    productionEvidence: "unknown",
  }));
}

function buildBackgroundMatrix(capabilities) {
  return capabilities.map((cap) => ({
    kind: "background-capability",
    surface: cap.id,
    sourceFile: cap.sourceFile,
    summary: cap.label,
    codePresence: cap.status,
    missingFragments: cap.missingFragments,
    persistence: "unknown",
    authorization: "unknown",
    automation: "unknown",
    realTest: "unknown",
    productionEvidence: "unknown",
  }));
}

function renderMarkdown({ routes, capabilities, routeCount, capabilityCount }) {
  const routeRows = routes.map(
    (row) =>
      `| route | \`${row.sourceFile}\` | \`${row.surface}\` | \`${row.sourceLine}\` | ${row.persistence} | ${row.authorization} | ${row.automation} | ${row.realTest} | ${row.productionEvidence} |`,
  );
  const capabilityRows = capabilities.map(
    (row) =>
      `| background-capability | \`${row.sourceFile}\` | \`${row.surface}\` | ${row.codePresence} | ${row.persistence} | ${row.authorization} | ${row.automation} | ${row.realTest} | ${row.productionEvidence} |`,
  );
  return `<!-- prettier-ignore-start -->
# Guardian readiness matrix

> Generated by \`scripts/generate-readiness-matrix.cjs\` from \`src/AppRoutes.tsx\` + the seven route groups in \`src/routes/*Routes.tsx\` and the background-capability catalogue.
> This is an evidence ledger, not a claim that \`unknown\` cells are healthy.

## Measurement

- Source files scanned: ${ROUTE_FILES.length} route files + ${BACKGROUND_CAPABILITIES.length} background capabilities.
- Route declarations: ${routeCount}.
- Background capabilities tracked: ${capabilityCount}.
- \`unknown\` means this pass did not find authoritative evidence; it must not be read as pass.
- Evidence classes are intentionally separate: code presence, persistence, tenant-scoped authorization, provisioned automation, real test execution, and production evidence.

## Route surfaces

| Kind | Source file | Surface | Source line | Persistencia real | Autorización tenant-scoped | Automatización provisionada/verificada | Prueba real | Evidencia de producción |
|---|---|---|---:|---|---|---|---|---|
${routeRows.join("\n")}

## Background capabilities

| Kind | Source file | Surface | Code presence | Persistencia real | Autorización tenant-scoped | Automatización provisionada/verificada | Prueba real | Evidencia de producción |
|---|---|---|---|---|---|---|---|---|
${capabilityRows.join("\n")}
<!-- prettier-ignore-end -->
`;
}

function main(argv = process.argv.slice(2)) {
  const repoRoot = path.resolve(
    argv.find((arg) => arg.startsWith("--repo="))?.slice(6) ?? ".",
  );
  const check = argv.includes("--check");
  const output = path.resolve(
    argv.find((arg) => arg.startsWith("--output="))?.slice(9) ??
      "docs/readiness/READINESS_MATRIX.md",
  );
  const jsonOutput = path.resolve(
    argv.find((arg) => arg.startsWith("--json="))?.slice(7) ??
      "docs/readiness/READINESS_MATRIX.json",
  );

  const routes = collectRouteDeclarations(repoRoot);
  const capabilities = collectBackgroundCapabilities(repoRoot);
  const matrix = [
    ...buildRouteMatrix(routes),
    ...buildBackgroundMatrix(capabilities),
  ];

  const markdown = renderMarkdown({
    routes,
    capabilities,
    routeCount: routes.length,
    capabilityCount: capabilities.length,
  });

  if (check) {
    const current = fs.existsSync(output)
      ? fs.readFileSync(output, "utf8")
      : "";
    if (current !== markdown) {
      process.stderr.write(`Readiness matrix is stale: ${output}\n`);
      process.exitCode = 1;
    }
    return;
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, markdown);
  fs.mkdirSync(path.dirname(jsonOutput), { recursive: true });
  fs.writeFileSync(
    jsonOutput,
    JSON.stringify(matrix, null, 2) + "\n",
  );
  process.stdout.write(
    `Generated ${output} (${routes.length} routes, ${capabilities.length} capabilities)\n`,
  );
  process.stdout.write(`Generated ${jsonOutput}\n`);
}

if (require.main === module) main();

module.exports = {
  UNKNOWN,
  ROUTE_FILES,
  BACKGROUND_CAPABILITIES,
  collectRouteDeclarations,
  collectBackgroundCapabilities,
  buildRouteMatrix,
  buildBackgroundMatrix,
  renderMarkdown,
};
