#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// generate-ar-usdz.mjs — Sprint 23 Bucket EE.6.
//
// Itera los 17 `.glb` en public/models/ar/ y produce sus pares `.usdz`
// para AR Quick Look (iOS Safari). El converter corre en una Cloud
// Function aislada (infra/usdz-converter/, OpenUSD) — este script:
//
//   1) Sube cada GLB a un bucket GCS temporal (gs://$USDZ_STAGING_BUCKET/...).
//   2) Llama POST /convert al UsdzConverter.
//   3) Descarga el USDZ desde el signedUrl resultante.
//   4) Lo guarda en public/models/ar/{kind}.usdz.
//
// Idempotente: si el .usdz local ya existe se omite (--force lo regenera).
//
// Requiere las env vars (matching .env.example):
//   USDZ_CONVERTER_URL       URL público del Cloud Run service
//   USDZ_CONVERTER_TOKEN     bearer token compartido
//   USDZ_STAGING_BUCKET      bucket de staging (input + output)
//   GOOGLE_APPLICATION_CREDENTIALS  ADC para subir el GLB al bucket
//
// Uso:
//   node scripts/generate-ar-usdz.mjs [--force]

import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const AR_DIR = path.join(REPO_ROOT, 'public', 'models', 'ar');

// Mismos 17 kinds que generate-ar-models.mjs — fuente única.
const KINDS = [
  'extinguisher_pqs',
  'extinguisher_co2',
  'extinguisher_water',
  'hydrant',
  'sign_evacuation',
  'sign_warning',
  'sign_mandatory',
  'sign_prohibition',
  'aed',
  'first_aid_kit',
  'emergency_shower',
  'eye_wash_station',
  'gas_detector',
  'spill_kit',
  'safety_shower',
  'assembly_point',
  'evacuation_route',
];

const FORCE = process.argv.includes('--force');

function envOrFail(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[usdz-gen] missing env var ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const converterUrl = envOrFail('USDZ_CONVERTER_URL').replace(/\/$/, '');
  const token = envOrFail('USDZ_CONVERTER_TOKEN');
  const stagingBucket = envOrFail('USDZ_STAGING_BUCKET');

  // GCS upload: dynamic import so users without the dep installed can
  // at least run --help / lint the script.
  const { Storage } = await import('@google-cloud/storage');
  const storage = new Storage();
  const bucket = storage.bucket(stagingBucket);

  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const kind of KINDS) {
    const glbPath = path.join(AR_DIR, `${kind}.glb`);
    const usdzPath = path.join(AR_DIR, `${kind}.usdz`);

    if (!existsSync(glbPath)) {
      console.warn(`[usdz-gen] skip ${kind}: GLB missing at ${glbPath}`);
      continue;
    }

    if (existsSync(usdzPath) && !FORCE) {
      skipped++;
      console.log(`[usdz-gen] skip ${kind}: .usdz already exists (use --force to regenerate)`);
      continue;
    }

    try {
      // 1. Upload GLB to staging bucket
      const objectName = `usdz-staging/${Date.now()}-${kind}.glb`;
      await bucket.upload(glbPath, { destination: objectName, contentType: 'model/gltf-binary' });
      const inputUri = `gs://${stagingBucket}/${objectName}`;

      // 2. POST /convert
      const res = await fetch(`${converterUrl}/convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ inputUri, outputBucket: stagingBucket }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`convert HTTP ${res.status}: ${errText.slice(0, 500)}`);
      }
      const body = await res.json();
      if (!body.ok || !body.signedUrl) {
        throw new Error(`convert response invalid: ${JSON.stringify(body).slice(0, 500)}`);
      }

      // 3. Download .usdz
      const dlRes = await fetch(body.signedUrl);
      if (!dlRes.ok) {
        throw new Error(`download HTTP ${dlRes.status}`);
      }
      const buffer = Buffer.from(await dlRes.arrayBuffer());
      await fs.writeFile(usdzPath, buffer);

      // 4. Cleanup staging input GLB (ignore errors — janitor lifecycle on bucket cleans up too)
      try {
        await bucket.file(objectName).delete();
      } catch { /* best-effort */ }

      converted++;
      console.log(`[usdz-gen] ok ${kind}: ${(buffer.length / 1024).toFixed(1)} KiB sha256=${body.sha256.slice(0, 12)}`);
    } catch (err) {
      failed++;
      console.error(`[usdz-gen] FAIL ${kind}:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\n[usdz-gen] done: converted=${converted} skipped=${skipped} failed=${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[usdz-gen] fatal:', err);
  process.exit(1);
});
