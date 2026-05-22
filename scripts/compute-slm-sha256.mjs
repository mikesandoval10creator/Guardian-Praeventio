#!/usr/bin/env node
// §2.9 helper script (2026-05-22).
//
// Computa el SHA-256 de un modelo SLM descargado y opcionalmente
// actualiza `src/services/slm/registry.ts` con el valor real.
//
// Bloqueador del que el usuario habló: Gemma 2 2B ONNX está en un repo
// HuggingFace GATED — requiere accept terms + HF token con scope.
// `registry.ts:119` tiene `expectedSha256: null` porque la pipeline de
// release nunca pudo descargar el archivo para computarlo.
//
// Una vez DevOps:
//   1. Acepta los terms del modelo en https://huggingface.co/google/gemma-2-2b-it
//   2. Genera un HF token con scope al repo
//   3. Descarga el .onnx via `huggingface-cli download ...` o curl
//   4. Corre este script: node scripts/compute-slm-sha256.mjs <path/to/model.onnx> [--model-id gemma-2-2b-it]
//
// El script:
//   - Computa SHA-256 (NodeJS crypto, sin deps externos)
//   - Imprime el valor
//   - Si --model-id se pasa: actualiza el archivo registry.ts en-place
//     reemplazando `expectedSha256: null` por el hash real
//
// Verificación post-update: `npm run test -- registry.test.ts`
// (los tests garantizan que cada modelo tenga SHA-256 real, no null).

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const args = { path: null, modelId: null };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--model-id') {
      args.modelId = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (!args.path) {
      args.path = arg;
    }
  }
  return args;
}

function printHelp() {
  console.log(`§2.9 SLM SHA-256 computation script

USO:
  node scripts/compute-slm-sha256.mjs <path/to/model.onnx> [--model-id <id>]

ARGS:
  <path>             Path al archivo .onnx descargado (required)
  --model-id <id>    Opcional. Si se pasa, actualiza
                     src/services/slm/registry.ts reemplazando el
                     expectedSha256: null del modelo con id <id>.

EJEMPLOS:
  # Solo computar (no toca código):
  node scripts/compute-slm-sha256.mjs ~/Downloads/gemma-2-2b-it-q4.onnx

  # Computar + actualizar registry:
  node scripts/compute-slm-sha256.mjs ~/Downloads/gemma-2-2b-it-q4.onnx \\
      --model-id gemma-2-2b-it

POST-UPDATE:
  Correr tests para verificar: npm test -- src/services/slm/registry.test.ts
`);
}

function computeSha256(path) {
  const hash = createHash('sha256');
  const data = readFileSync(path);
  hash.update(data);
  return hash.digest('hex');
}

function updateRegistry(modelId, sha256) {
  const registryPath = resolve(
    process.cwd(),
    'src',
    'services',
    'slm',
    'registry.ts',
  );
  let content = readFileSync(registryPath, 'utf8');

  // Find the model block by id, then replace its expectedSha256.
  // Match: `id: 'gemma-2-2b-it',` followed (within ~20 lines) by
  // `expectedSha256: null,`
  const modelRe = new RegExp(
    `(id:\\s*['"]${modelId.replace(/[-/]/g, '[-/]')}['"][\\s\\S]{0,2000}?expectedSha256:\\s*)null`,
    'm',
  );
  if (!modelRe.test(content)) {
    throw new Error(
      `Model id '${modelId}' not found in registry.ts (or its expectedSha256 is not null).`,
    );
  }
  content = content.replace(modelRe, `$1'${sha256}'`);
  writeFileSync(registryPath, content, 'utf8');
  console.log(`✓ Updated src/services/slm/registry.ts for model '${modelId}'.`);
}

const args = parseArgs(process.argv);

if (args.help || !args.path) {
  printHelp();
  process.exit(args.help ? 0 : 1);
}

console.log(`Computing SHA-256 of: ${args.path}`);
const sha256 = computeSha256(resolve(args.path));
console.log(`SHA-256: ${sha256}`);

if (args.modelId) {
  updateRegistry(args.modelId, sha256);
  console.log(
    `\nNext step: npm test -- src/services/slm/registry.test.ts`,
  );
} else {
  console.log(
    `\nTo update registry: re-run with --model-id <id> (e.g. --model-id gemma-2-2b-it)`,
  );
}
