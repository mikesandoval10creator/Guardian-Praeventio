#!/usr/bin/env node
// Generates docs/API-INDEX.md — the complete catalog of backend HTTP routes,
// so wiring work can look up "where does real data live". Auto-generated from
// server.ts mounts + src/server/routes/*.
//
//   node scripts/gen-api-index.cjs           # write docs/API-INDEX.md
//   node scripts/gen-api-index.cjs --check    # CI gate: exit 1 if committed file is stale
//
// Requiring this module does NOT run the CLI (guarded by require.main) — the
// vitest gate (src/__tests__/scripts/apiIndexFresh.test.ts) calls generate().
//
// ponytail: regex scan, not a full TS AST. Known ceiling — misses
// dynamically-built paths and `router.route('/x').get().post()` chains, and
// does NOT recurse into sub-routers mounted inside a router file (e.g.
// b2d/index.ts). Upgrade to ts-morph only if those gaps start to matter.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server.ts');
const OUT = path.join(ROOT, 'docs/API-INDEX.md');

function joinPath(prefix, sub) {
  return ('/' + prefix.replace(/^\/|\/$/g, '') + '/' + sub.replace(/^\//, ''))
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

function scanRoutes(relFile) {
  let src;
  try {
    src = fs.readFileSync(path.join(ROOT, relFile), 'utf8');
  } catch {
    return null; // file moved/renamed — flag it
  }
  const routes = [];
  const methodRe = /\.(get|post|put|delete|patch)\(\s*[`'"]([^`'"]+)[`'"]/g; // fresh per call (lastIndex)
  for (let r; (r = methodRe.exec(src)); ) {
    routes.push({ method: r[1].toUpperCase(), sub: r[2] });
  }
  return routes;
}

// Build the full API-INDEX.md content from the current source. Pure (no writes).
function generate() {
  const server = fs.readFileSync(SERVER, 'utf8');

  // 1. router var -> source file:  import xRouter from "./src/server/routes/x.js"
  const varToFile = {};
  const importRe = /import\s+(\w+)\s+from\s+["'](\.\/src\/server\/routes\/[^"']+)["']/g;
  for (let m; (m = importRe.exec(server)); ) {
    varToFile[m[1]] = m[2].replace(/^\.\//, '').replace(/\.js$/, '.ts');
  }

  // 2. mounts:  app.use("/prefix", routerVar)
  const mounts = [];
  const mountRe = /app\.use\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/g;
  for (let m; (m = mountRe.exec(server)); ) {
    const [, prefix, varName] = m;
    if (varToFile[varName]) mounts.push({ prefix, varName, file: varToFile[varName] });
  }
  mounts.sort((a, b) => a.prefix.localeCompare(b.prefix) || a.file.localeCompare(b.file));

  let body = '';
  let totalRoutes = 0;
  let missingFiles = 0;
  for (const mt of mounts) {
    const routes = scanRoutes(mt.file);
    body += `\n### \`${mt.file}\` → \`${mt.prefix}\`\n`;
    if (routes === null) {
      body += `- ⚠ source file not found (import points here but file missing/renamed)\n`;
      missingFiles++;
      continue;
    }
    if (routes.length === 0) {
      body += `- _(no inline route decls found — router.route() chain or sub-router)_\n`;
      continue;
    }
    totalRoutes += routes.length;
    for (const rt of routes) {
      body += `- \`${rt.method} ${joinPath(mt.prefix, rt.sub)}\`\n`;
    }
  }

  const header = `# API Index — catálogo completo de rutas HTTP (AUTO-GENERADO)

<!-- DO NOT EDIT BY HAND. Run: node scripts/gen-api-index.cjs  (gate: --check) -->
<!-- ponytail: regex scan, no TS AST. Misses dynamic paths / router.route() chains / sub-routers. -->

Índice de **dónde vive cada dato real**. Si una ruta no aparece aquí, no existe o es
ficticia → no cablear contra ella. Generado de \`server.ts\` (mounts \`app.use\`) +
\`src/server/routes/*\`. Para el detalle curado de auth/audit/idempotency de las rutas
clave ver \`docs/api-routes.md\`.

**${mounts.length} routers montados · ${totalRoutes} rutas detectadas${missingFiles ? ` · ⚠ ${missingFiles} imports rotos` : ''}.**
`;

  return { content: header + body + '\n', mounts: mounts.length, totalRoutes, missingFiles };
}

module.exports = { generate, OUT };

if (require.main === module) {
  const { content, mounts, totalRoutes, missingFiles } = generate();
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur.trim() !== content.trim()) {
      console.error('[api-index] STALE — run `node scripts/gen-api-index.cjs` and commit docs/API-INDEX.md');
      process.exit(1);
    }
    console.log('[api-index] fresh.');
  } else {
    fs.writeFileSync(OUT, content);
    console.log(`[api-index] wrote ${path.relative(ROOT, OUT)} — ${mounts} routers, ${totalRoutes} routes${missingFiles ? `, ${missingFiles} broken imports` : ''}.`);
  }
}
