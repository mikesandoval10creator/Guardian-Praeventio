#!/usr/bin/env node
/**
 * download-mediapipe-models.mjs — Bucket PP.1 (Sprint 25 gaps cleanup).
 *
 * Descarga los assets de MediaPipe Tasks-Vision (Pose Landmarker) que
 * actualmente sirve `useMediaPipePose.ts` desde CDN público, y los deja
 * en `public/models/mediapipe/`. Esto habilita:
 *   1. Operación offline (PWA / Capacitor) sin depender de jsdelivr/Google.
 *   2. Cumplimiento GDPR / ley 19.628 — assets servidos desde nuestro
 *      origen (Cloud CDN), sin hits cross-origin a Google.
 *   3. Resiliencia ante caídas del CDN aguas arriba.
 *
 * Activación automática vía `npm run prebuild` (ver package.json).
 *
 * IMPORTANTE — los `.task` y `.wasm` NO se commitean al repo (.gitignore
 * los excluye). En CI/Cloud Build el prebuild los descarga y termina en
 * el bundle de `dist/`. Sirven con headers Cache-Control inmutables.
 *
 * Uso:
 *   node scripts/download-mediapipe-models.mjs            # idempotente
 *   node scripts/download-mediapipe-models.mjs --force    # redescarga
 *
 * Comportamiento:
 *   - Skip si el archivo destino existe y matchea SHA-256 pinneado.
 *   - Stream-download con progreso, usando `.partial` sibling para no
 *     dejar archivos a medio escribir.
 *   - Si `EXPECTED_SHA256 === null`, loggea hash computado y advierte
 *     (primer run); si está pinneado, mismatch = abort.
 *
 * Si bumpeás la versión de `@mediapipe/tasks-vision` actualizá las URLs
 * de WASM acá Y la versión-cache en el caller.
 */

import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Versión de @mediapipe/tasks-vision — debe coincidir con package.json.
// Si bumpeás el SDK, actualizá esta constante para que el CDN devuelva
// los binarios WASM correspondientes.
const MEDIAPIPE_VERSION = '0.10.34';
const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

/**
 * Tabla de modelos. `sha256: null` significa "no auditado todavía";
 * el script loggea el hash y emite warning en lugar de abortar (igual
 * patrón que `download-slm-model.mjs`). Pinneá luego del primer run.
 */
const MODELS = [
  {
    name: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    sha256: null,
    target: 'public/models/mediapipe/pose_landmarker_lite.task',
  },
  {
    name: 'vision_wasm_internal.wasm',
    url: `${WASM_CDN}/vision_wasm_internal.wasm`,
    sha256: null,
    target: 'public/models/mediapipe/vision_wasm_internal.wasm',
  },
  {
    name: 'vision_wasm_internal.js',
    url: `${WASM_CDN}/vision_wasm_internal.js`,
    sha256: null,
    target: 'public/models/mediapipe/vision_wasm_internal.js',
  },
  // Variante GPU — opcional pero deseable; FilesetResolver elige WASM
  // o GPU según delegate. Si la build no lo necesita podés removerlo.
  {
    name: 'vision_wasm_nosimd_internal.wasm',
    url: `${WASM_CDN}/vision_wasm_nosimd_internal.wasm`,
    sha256: null,
    target: 'public/models/mediapipe/vision_wasm_nosimd_internal.wasm',
    optional: true,
  },
  {
    name: 'vision_wasm_nosimd_internal.js',
    url: `${WASM_CDN}/vision_wasm_nosimd_internal.js`,
    sha256: null,
    target: 'public/models/mediapipe/vision_wasm_nosimd_internal.js',
    optional: true,
  },
];

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = { force: false };
  for (const a of argv) {
    if (a === '--force') out.force = true;
  }
  return out;
}

/**
 * Computa SHA-256 de un archivo existente leyéndolo en streaming.
 */
async function sha256File(path) {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), async function* (src) {
    for await (const chunk of src) {
      hash.update(chunk);
      yield chunk;
    }
  });
  return hash.digest('hex');
}

/**
 * Descarga un modelo si falta o si el hash no matchea. Idempotente.
 *
 * Estrategia:
 *  1. Si existe y `sha256` es null → skip silencioso (no reauditamos).
 *  2. Si existe y matchea hash pinneado → skip.
 *  3. Si existe y NO matchea → re-download.
 *  4. Si no existe → download.
 */
export async function downloadIfMissing(model, { force = false, fetchImpl = fetch } = {}) {
  // Si `model.target` es absoluto, lo usamos tal cual (path para tests);
  // si es relativo, lo resolvemos contra REPO_ROOT.
  const dest = model.target && /^([a-zA-Z]:[\\/]|[\\/])/.test(model.target)
    ? model.target
    : resolve(REPO_ROOT, model.target);
  const tmp = `${dest}.partial`;

  if (!force && existsSync(dest)) {
    if (model.sha256) {
      const actual = await sha256File(dest);
      if (actual === model.sha256) {
        console.log(`[mediapipe] ${model.name} OK (hash match), skip.`);
        return { skipped: true, sha256: actual };
      }
      console.warn(
        `[mediapipe] ${model.name} hash mismatch (got ${actual}), redescargando.`,
      );
    } else {
      const size = statSync(dest).size;
      console.log(
        `[mediapipe] ${model.name} ya existe (${formatBytes(size)}), skip. (--force para redescargar)`,
      );
      return { skipped: true };
    }
  }

  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(tmp)) await rm(tmp);

  console.log(`[mediapipe] descargando ${model.url}`);
  console.log(`[mediapipe]    → ${model.target}`);

  let res;
  try {
    res = await fetchImpl(model.url);
  } catch (err) {
    if (model.optional) {
      console.warn(
        `[mediapipe] ${model.name} (opcional) no se pudo descargar: ${err.message}. Continuando.`,
      );
      return { skipped: true, optional: true };
    }
    throw err;
  }

  if (!res.ok) {
    if (model.optional) {
      console.warn(
        `[mediapipe] ${model.name} (opcional) HTTP ${res.status}; continuando.`,
      );
      return { skipped: true, optional: true };
    }
    throw new Error(
      `[mediapipe] HTTP ${res.status} ${res.statusText} fetching ${model.url}`,
    );
  }
  if (!res.body) throw new Error(`[mediapipe] response sin body para ${model.name}`);

  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  const hash = createHash('sha256');

  const sink = createWriteStream(tmp);
  const tap = Readable.from(progressTap(res.body, (chunk) => {
    received += chunk.byteLength;
    hash.update(chunk);
    if (total > 0) {
      const pct = ((received / total) * 100).toFixed(1);
      process.stdout.write(
        `\r[mediapipe] ${model.name}: ${formatBytes(received)} / ${formatBytes(total)} (${pct}%)   `,
      );
    }
  }));

  await pipeline(tap, sink);
  process.stdout.write('\n');

  const digest = hash.digest('hex');
  console.log(`[mediapipe] ${model.name} sha256 = ${digest}`);

  if (model.sha256 && digest !== model.sha256) {
    await rm(tmp);
    throw new Error(
      `[mediapipe] SHA-256 mismatch para ${model.name}.\n  expected: ${model.sha256}\n  got:      ${digest}`,
    );
  }
  if (!model.sha256) {
    console.warn(
      `[mediapipe] ${model.name}: SHA-256 no pinneado todavía. Verificá y pinneá en el array MODELS.`,
    );
  }

  await rename(tmp, dest);
  return { skipped: false, sha256: digest, bytes: received };
}

async function* progressTap(body, cb) {
  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value) {
      cb(value);
      yield value;
    }
  }
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

export async function main({ force = args.force, fetchImpl = fetch } = {}) {
  mkdirSync(resolve(REPO_ROOT, 'public/models/mediapipe'), { recursive: true });
  const results = [];
  for (const m of MODELS) {
    try {
      const r = await downloadIfMissing(m, { force, fetchImpl });
      results.push({ ...r, name: m.name });
    } catch (err) {
      console.error(`[mediapipe] ERROR descargando ${m.name}: ${err.message}`);
      throw err;
    }
  }
  console.log('[mediapipe] OK — todos los assets presentes en public/models/mediapipe/.');
  return results;
}

export { MODELS, sha256File };

// Ejecutar solo si fue invocado como script (no cuando se importa en tests).
const invokedAsScript =
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` ||
  import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`;

if (invokedAsScript) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exit(1);
    });
}
