#!/usr/bin/env node
/**
 * prepackage-slm-models.mjs — Sprint 54 release pipeline.
 *
 * Reads the SLM registry (`src/services/slm/registry.ts`) and, for every
 * model that declares a `prePackagedPath`, downloads + verifies +
 * places the ONNX file (plus any companion `.onnx_data` files) at the
 * exact path the registry promises.
 *
 * Why a release-time script and not bundler glue:
 *   - Models are 100s of MB to 2+ GB. Vite imports would freeze the
 *     dev loop and balloon CI build time.
 *   - Production builds run this once before `vite build`; CI caches
 *     the resulting `public/models/<id>/` directory between runs so a
 *     2.7 GB download happens at most once per registry change.
 *   - The script is idempotent: if the destination already exists and
 *     its SHA-256 matches the registry-pinned value, it skips the
 *     download.
 *
 * Usage:
 *   node scripts/prepackage-slm-models.mjs                  # all pre-packaged models
 *   node scripts/prepackage-slm-models.mjs --model=qwen-2.5-0.5b
 *   node scripts/prepackage-slm-models.mjs --force          # re-download even if cached
 *   node scripts/prepackage-slm-models.mjs --dry-run        # plan only, no fetch
 *
 * Exit codes:
 *   0  — all targeted models are in place + verified
 *   1  — unrecoverable error (network, integrity, missing prePackagedPath)
 *   2  — partial success: at least one model downloaded but another failed
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  createReadStream,
  createWriteStream,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { rename, rm } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const REGISTRY_PATH = resolve(REPO_ROOT, 'src/services/slm/registry.ts');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');
const MODEL_FILTER = args.find((a) => a.startsWith('--model='))?.slice('--model='.length);

// ────────────────────────────────────────────────────────────────────────
// Registry parser
// ────────────────────────────────────────────────────────────────────────

/**
 * Naive TypeScript-source parser. We DO NOT want to add a tsc dependency
 * here — the script must run on a clean `node_modules` (or none, in CI
 * before `npm install`). Instead we use a deliberately conservative
 * regex extraction of the `MODEL_REGISTRY = [...]` literal.
 *
 * Format expectations (enforced by `registry.test.ts`):
 *   - Each model is an object literal with `id`, `url`, `prePackagedPath?`,
 *     `expectedSha256`, `weightFilename?`, `companionFiles?`.
 *   - `companionFiles` is an inline array of `{ filename, size, expectedSha256 }`.
 *
 * If the registry shape changes, this parser must be updated in the same
 * PR. The CI smoke runs this script in `--dry-run` mode, so a parser
 * regression is caught immediately.
 */
function parseRegistry() {
  const src = readFileSync(REGISTRY_PATH, 'utf8');
  // Capture the array body between `MODEL_REGISTRY: readonly ModelDescriptor[] = [` and the closing `] as const`.
  const m = src.match(/MODEL_REGISTRY\s*:[^=]+=\s*\[([\s\S]+?)\]\s+as\s+const/);
  if (!m) {
    throw new Error('prepackage-slm-models: could not find MODEL_REGISTRY literal in registry.ts');
  }
  const body = m[1];

  // Split on `},` at the top object level. A simple {} tracker is enough
  // because object values inside descriptors are flat strings / numbers /
  // small arrays of objects (companionFiles).
  const models = [];
  let depth = 0;
  let buf = '';
  for (const ch of body) {
    buf += ch;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        models.push(buf.trim().replace(/^,\s*/, ''));
        buf = '';
      }
    }
  }

  return models
    .filter((s) => s.length > 0 && s.startsWith('{'))
    .map(parseModelLiteral)
    .filter(Boolean);
}

function parseModelLiteral(literal) {
  // Extract simple `field: 'value'` and `field: number` and the
  // companion-files array. This is brittle by design — any change to
  // the registry shape should fail the parser loudly so the operator
  // notices.
  const grab = (field) => {
    const r = new RegExp(`${field}\\s*:\\s*['"\`]([^'"\`]+)['"\`]`);
    const m = literal.match(r);
    return m ? m[1] : null;
  };
  const grabNum = (field) => {
    const r = new RegExp(`${field}\\s*:\\s*([0-9_]+)`);
    const m = literal.match(r);
    return m ? Number(m[1].replace(/_/g, '')) : null;
  };

  const id = grab('id');
  if (!id) return null;

  // companionFiles: capture each {filename, size, expectedSha256} block.
  const companions = [];
  const compMatch = literal.match(/companionFiles\s*:\s*\[([\s\S]*?)\]/);
  if (compMatch) {
    const companionBody = compMatch[1];
    const objRe = /\{([^}]+)\}/g;
    let cm;
    while ((cm = objRe.exec(companionBody)) !== null) {
      const obj = cm[1];
      const cFilename = obj.match(/filename\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
      const cSize = Number(obj.match(/size\s*:\s*([0-9_]+)/)?.[1]?.replace(/_/g, '') ?? '0');
      const cSha = obj.match(/expectedSha256\s*:\s*['"`]([^'"`]+)['"`]/)?.[1];
      if (cFilename && cSha) {
        companions.push({ filename: cFilename, size: cSize, expectedSha256: cSha });
      }
    }
  }

  return {
    id,
    url: grab('url'),
    weightFilename: grab('weightFilename'),
    expectedSha256: grab('expectedSha256'),
    prePackagedPath: grab('prePackagedPath'),
    size: grabNum('size'),
    companionFiles: companions,
  };
}

// ────────────────────────────────────────────────────────────────────────
// SHA-256 helpers
// ────────────────────────────────────────────────────────────────────────

async function fileSha256(path) {
  return new Promise((resolveP, rejectP) => {
    const h = createHash('sha256');
    const s = createReadStream(path);
    s.on('error', rejectP);
    s.on('data', (chunk) => h.update(chunk));
    s.on('end', () => resolveP(h.digest('hex')));
  });
}

// ────────────────────────────────────────────────────────────────────────
// Download with progress + integrity
// ────────────────────────────────────────────────────────────────────────

async function downloadAndVerify({ url, dest, expectedSha256, label }) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would fetch ${url} → ${dest}`);
    return;
  }

  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.partial`;
  if (existsSync(tmp)) await rm(tmp);

  console.log(`  ↓ ${label}`);
  console.log(`    src: ${url}`);
  console.log(`    dst: ${dest}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${res.statusText} for ${url}`);
  }
  if (!res.body) throw new Error('fetch: no response body');

  const total = Number(res.headers.get('content-length') ?? '0');
  let received = 0;
  let lastPct = 0;
  const sink = createWriteStream(tmp);

  const reader = res.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sink.write(value);
    received += value.byteLength;
    if (total > 0) {
      const pct = Math.floor((received / total) * 100);
      if (pct >= lastPct + 5) {
        process.stdout.write(`    ${pct}%…`);
        lastPct = pct;
      }
    }
  }
  await new Promise((r) => sink.end(r));
  process.stdout.write('\n');

  const actualSha = await fileSha256(tmp);
  if (actualSha.toLowerCase() !== expectedSha256.toLowerCase()) {
    await rm(tmp);
    throw new Error(
      `INTEGRITY FAIL for ${label}\n  expected SHA-256: ${expectedSha256}\n  got SHA-256:      ${actualSha}\n  (downloaded file evicted)`,
    );
  }
  await rename(tmp, dest);
  const sizeMb = Math.round(statSync(dest).size / 1024 / 1024);
  console.log(`    ✓ verified (${sizeMb} MB)`);
}

// ────────────────────────────────────────────────────────────────────────
// Resolve companion URL from principal URL
// ────────────────────────────────────────────────────────────────────────

function companionUrlFor(principalUrl, companionFilename) {
  // Principal URLs look like
  // `https://huggingface.co/<owner>/<repo>/resolve/main/<path>/<file>.onnx`.
  // Companion lives in the same directory with the relative filename
  // declared in the registry (`onnx/model_q4.onnx_data` ⇒
  // `https://.../resolve/main/onnx/model_q4.onnx_data`).
  const m = principalUrl.match(/^(https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[^/]+)\//);
  if (m) return `${m[1]}/${companionFilename}`;
  // Fallback: replace the last segment with the companion basename.
  const lastSlash = principalUrl.lastIndexOf('/');
  const baseDir = principalUrl.slice(0, lastSlash + 1);
  const basename = companionFilename.includes('/')
    ? companionFilename.slice(companionFilename.lastIndexOf('/') + 1)
    : companionFilename;
  return `${baseDir}${basename}`;
}

// ────────────────────────────────────────────────────────────────────────
// Per-model pipeline
// ────────────────────────────────────────────────────────────────────────

async function processModel(model) {
  if (!model.prePackagedPath) {
    console.log(`[skip] ${model.id}: no prePackagedPath declared`);
    return { id: model.id, status: 'skip-no-prepackage' };
  }
  if (!model.expectedSha256) {
    console.log(`[skip] ${model.id}: expectedSha256 is null (gated or pending)`);
    return { id: model.id, status: 'skip-no-hash' };
  }
  if (!model.url) {
    throw new Error(`model ${model.id}: missing url`);
  }

  console.log(`\n== ${model.id} ==`);

  const principalDest = resolve(REPO_ROOT, 'public' + model.prePackagedPath);

  // Idempotency check.
  if (existsSync(principalDest) && !FORCE) {
    const sha = await fileSha256(principalDest);
    if (sha.toLowerCase() === model.expectedSha256.toLowerCase()) {
      console.log(`  ✓ principal already in place + verified`);
    } else {
      console.log(`  ⚠ principal exists but SHA mismatch; re-downloading`);
      await rm(principalDest);
      await downloadAndVerify({
        url: model.url,
        dest: principalDest,
        expectedSha256: model.expectedSha256,
        label: `principal (${model.weightFilename ?? 'model.onnx'})`,
      });
    }
  } else {
    await downloadAndVerify({
      url: model.url,
      dest: principalDest,
      expectedSha256: model.expectedSha256,
      label: `principal (${model.weightFilename ?? 'model.onnx'})`,
    });
  }

  // Companions live as siblings of the principal (Vite serves them
  // from the same `/models/<id>/` directory).
  for (const c of model.companionFiles) {
    const basename = c.filename.includes('/')
      ? c.filename.slice(c.filename.lastIndexOf('/') + 1)
      : c.filename;
    const compDest = resolve(dirname(principalDest), basename);
    if (existsSync(compDest) && !FORCE) {
      const sha = await fileSha256(compDest);
      if (sha.toLowerCase() === c.expectedSha256.toLowerCase()) {
        console.log(`  ✓ companion ${basename} already in place + verified`);
        continue;
      }
      console.log(`  ⚠ companion ${basename} SHA mismatch; re-downloading`);
      await rm(compDest);
    }
    await downloadAndVerify({
      url: companionUrlFor(model.url, c.filename),
      dest: compDest,
      expectedSha256: c.expectedSha256,
      label: `companion (${c.filename})`,
    });
  }

  return { id: model.id, status: 'ok' };
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────

async function main() {
  // B14 (2026-06-11): this script now runs in `prebuild` so every
  // production build actually SHIPS the default Qwen model (the core of
  // the "embebido" promise — no CDN downloads on faena connections).
  // CI lanes that only need the JS bundle (perf budgets, e2e, typecheck
  // builds) export SLM_PREPACKAGE_SKIP=1 to avoid the 483 MB download;
  // release/deploy lanes MUST NOT set it. The flag never affects
  // runtime behavior — only build-time asset staging.
  if (process.env.SLM_PREPACKAGE_SKIP === '1') {
    console.warn(
      'prepackage-slm-models: SKIPPED via SLM_PREPACKAGE_SKIP=1 — the build ' +
        'output will NOT contain the pre-packaged SLM. Do not ship this build.',
    );
    return;
  }

  const allModels = parseRegistry();
  if (allModels.length === 0) {
    console.error('prepackage-slm-models: empty registry parse — abort');
    process.exit(1);
  }

  const filtered = MODEL_FILTER
    ? allModels.filter((m) => m.id === MODEL_FILTER)
    : allModels;

  if (MODEL_FILTER && filtered.length === 0) {
    console.error(`No model with id '${MODEL_FILTER}'. Known: ${allModels.map((m) => m.id).join(', ')}`);
    process.exit(1);
  }

  const targets = filtered.filter((m) => Boolean(m.prePackagedPath));
  if (targets.length === 0) {
    console.log('No models declare `prePackagedPath` — nothing to do.');
    return;
  }

  console.log(`prepackage-slm-models: ${targets.length} model(s) declared with prePackagedPath`);
  if (DRY_RUN) console.log('(--dry-run — no files will be written)');

  const results = [];
  let failures = 0;

  for (const m of targets) {
    try {
      const r = await processModel(m);
      results.push(r);
    } catch (err) {
      console.error(`\n[error] ${m.id}: ${err instanceof Error ? err.message : String(err)}`);
      results.push({ id: m.id, status: 'error', error: String(err) });
      failures++;
    }
  }

  console.log('\n=== Summary ===');
  for (const r of results) {
    console.log(`  ${r.id}: ${r.status}`);
  }

  if (failures === 0) {
    console.log('\n✓ All targeted models prepackaged successfully.');
  } else if (failures === targets.length) {
    console.error(`\n✗ All ${failures} model(s) failed.`);
    process.exit(1);
  } else {
    console.warn(`\n⚠ ${failures} of ${targets.length} model(s) failed.`);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
