const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

/**
 * Contrato operacional ejecutable (Etapa C del PLAN-COOLIFY-HYBRID.md).
 * Fija en código las decisiones cerradas del contrato de despliegue para que
 * una regresión documental o de clasificación rompa CI, no el despliegue.
 */

const PUBLIC_FIREBASE_FIELDS = new Set([
  'projectId',
  'appId',
  'apiKey',
  'authDomain',
  'firestoreDatabaseId',
  'storageBucket',
  'messagingSenderId',
  'measurementId',
]);

const FORBIDDEN_ADMIN_FIELDS = [
  'private_key',
  'client_email',
  'client_id',
  'client_secret',
  'service_account',
  'privateKey',
];

test('firebase-applet-config.json stays a PUBLIC client config (classification)', () => {
  const raw = read('firebase-applet-config.json');
  const config = JSON.parse(raw);
  for (const key of Object.keys(config)) {
    assert.ok(
      PUBLIC_FIREBASE_FIELDS.has(key),
      `campo no clasificado como público en firebase-applet-config.json: ${key}`,
    );
  }
  for (const field of FORBIDDEN_ADMIN_FIELDS) {
    assert.ok(!raw.includes(field), `credencial admin detectada en firebase-applet-config.json: ${field}`);
  }
  assert.ok(config.projectId, 'projectId requerido (server.ts lo usa para el tenant de datos)');
});

test('Dockerfile.api is the canonical API image and bakes the public config', () => {
  const dockerfile = read('Dockerfile.api');
  assert.match(dockerfile, /COPY --from=build \/app\/firebase-applet-config\.json/);
  assert.match(dockerfile, /PUBLIC Firebase client config/);
  assert.match(dockerfile, /HEALTHCHECK[^\n]*\n[\s\S]*?\/api\/health/);
  assert.match(dockerfile, /ENV NODE_ENV=production[\s\S]*?PORT=3000/);
  assert.match(dockerfile, /EXPOSE 3000/);
});

test('legacy Dockerfile no longer contradicts the classification and is deprecated', () => {
  const legacy = read('Dockerfile');
  assert.match(legacy, /DEPRECADO/);
  assert.doesNotMatch(legacy, /Se monta como Secret Manager/);
  assert.match(legacy, /CLASIFICACIÓN RESUELTA/);
});

test('frontend image serves the SPA with fallback and deep-link headers', () => {
  const nginx = read('nginx.conf');
  assert.match(nginx, /listen\s+8080;/);
  assert.match(nginx, /try_files \$uri \$uri\/ \/index\.html;/);
  assert.match(nginx, /application\/wasm/);
  assert.match(nginx, /frame-ancestors 'none'/);
  const frontend = read('Dockerfile.frontend');
  assert.match(frontend, /COPY nginx\.conf \/etc\/nginx\/conf\.d\/praeventio\.conf/);
  assert.match(frontend, /EXPOSE 8080/);
});

test('health probe contract is preserved at GET /api/health', () => {
  assert.match(read('src/server/routes/health.ts'), /router\.get\('\/health'/);
  assert.match(read('server.ts'), /app\.use\("\/api", healthRouter\)/);
  assert.match(read('src/server/middleware/securityHeaders.ts'), /'wasm-unsafe-eval'/);
  assert.match(read('src/server/middleware/cors.ts'), /Access-Control-Allow/i);
});

test('image build is fail-closed on the Android association fingerprint', () => {
  const renderer = read('scripts/render-well-known.mjs');
  assert.match(renderer, /REQUIRE_ANDROID_CERT está activo \(release fail-closed\)/);
  assert.match(renderer, /PLACEHOLDER_PATTERNS/);
  const api = read('Dockerfile.api');
  assert.match(api, /ARG REQUIRE_ANDROID_CERT=1/);
  assert.match(api, /REQUIRE_ANDROID_CERT=\$\{REQUIRE_ANDROID_CERT\}/);
});

test('every npm ci stage ships the postinstall patch scripts and vendored tarballs', () => {
  // `xlsx` es una dependencia `file:vendor/xlsx-0.20.3.tgz`: sin COPY vendor/
  // antes de `npm ci`, TODO build de imagen muere con ENOENT (probado en la
  // corrida real de construcción de Dockerfile.api, 2026-10-28).
  // El `postinstall` de la raíz ejecuta scripts/patch-artillery.mjs +
  // scripts/patch-stryker-vitest5.cjs (ambos no-opan sanamente si las
  // herramientas dev no están instaladas): sin esos archivos en el stage,
  // `npm ci` muere con "Cannot find module '/app/scripts/...'" (probado en
  // la misma corrida real).
  assert.match(read('package.json'), /"xlsx": "file:vendor\//);
  assert.match(read('package.json'), /postinstall[^\n]*patch-artillery\.mjs[^\n]*patch-stryker-vitest5\.cjs/);
  for (const dockerfile of ['Dockerfile.api', 'Dockerfile.frontend', 'Dockerfile']) {
    const text = read(dockerfile);
    const stages = text.split(/^FROM /m).slice(1);
    for (const stage of stages) {
      if (!/RUN [^\n]*npm ci/.test(stage)) continue;
      const ciIndex = stage.search(/RUN [^\n]*npm ci/);
      const copyIndex = stage.search(/COPY vendor\/ \.\/vendor\//);
      assert.ok(
        copyIndex !== -1 && copyIndex < ciIndex,
        `${dockerfile}: un stage con 'npm ci' debe hacer 'COPY vendor/ ./vendor/' ANTES (dependencia file:vendor/)`,
      );
      const scriptsIndex = stage.search(/COPY scripts\/patch-artillery\.mjs scripts\/patch-stryker-vitest5\.cjs \.\/scripts\//);
      assert.ok(
        scriptsIndex !== -1 && scriptsIndex < ciIndex,
        `${dockerfile}: un stage con 'npm ci' debe copiar los scripts de postinstall ANTES`,
      );
    }
  }
});

test('ops-contract CI workflow wires the canonical images and runtime probes', () => {
  const workflow = read('.github/workflows/ops-contract.yml');
  assert.match(workflow, /docker build -f Dockerfile\.api/);
  assert.match(workflow, /docker build -f Dockerfile\.frontend/);
  assert.match(workflow, /scripts\/ops-contract-probe\.sh api /);
  assert.match(workflow, /scripts\/ops-contract-probe\.sh frontend /);
  assert.match(workflow, /--build-arg ANDROID_CERT_SHA256=/);
  const probe = read('scripts/ops-contract-probe.sh');
  assert.match(probe, /assetlinks/);
  assert.match(probe, /frame-ancestors 'none'/);
  assert.match(probe, /Access-Control-Allow-Origin/);
});
