#!/usr/bin/env node
/**
 * download-slm-model.mjs — Bucket O.4 (Brecha B).
 *
 * Downloads the TinyLlama 1.1B Chat ONNX Q4 weights into
 * `public/models/slm/tinyllama-1.1b-q4.onnx` so the dev server (or a
 * CDN behind it) can serve the file to `OnnxSlmAdapter.loadModel()`.
 *
 * IMPORTANT — DO NOT COMMIT THE 600 MB WEIGHTS TO THE REPO. The
 * `.gitignore` already excludes `public/models/slm/*.onnx`. In
 * production we serve the file from Cloud Storage + CDN with the
 * cross-origin-isolation headers configured in `server.ts`.
 *
 * Usage:
 *   node scripts/download-slm-model.mjs
 *   node scripts/download-slm-model.mjs --force        # ignore existing file
 *   node scripts/download-slm-model.mjs --url=<url>    # override source
 *
 * Behavior:
 *   1. Skip if the destination file already exists (unless --force).
 *   2. Stream-download from the configured HuggingFace URL.
 *   3. Verify SHA-256 against the pinned hash — abort if mismatched.
 *
 * The pinned hash is the canonical fingerprint of the upstream upload
 * we audited. If you bump the source URL, recompute and update both
 * `EXPECTED_SHA256` here and the cache version in
 * `src/services/slm/onnxAdapter.ts` so old IDB rows are invalidated.
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

/**
 * Default source URL. Points at the community ONNX export of TinyLlama
 * 1.1B Chat. The `/resolve/main/` path is HuggingFace's stable redirect
 * to the canonical blob — preferable to the per-commit-sha URL because
 * it survives upstream re-uploads of identical content.
 */
const DEFAULT_URL =
  'https://huggingface.co/Xenova/TinyLlama-1.1B-Chat-v1.0/resolve/main/onnx/decoder_model_merged_quantized.onnx';

/** Destination on disk — kept in sync with `OnnxSlmAdapter`'s default `modelUrl`. */
const DEST_REL = 'public/models/slm/tinyllama-1.1b-q4.onnx';
const DEST_ABS = resolve(REPO_ROOT, DEST_REL);

/**
 * Expected SHA-256 of the canonical upload.
 *
 * Set to `null` while we await a manual hash audit of the upstream
 * blob. When set to `null`, the script logs the computed hash but does
 * NOT abort — first-time integrators are expected to run this once,
 * note the hash, paste it here, and check the resulting commit. After
 * that, mismatches are fatal.
 *
 * To recompute by hand (after running this script once):
 *   sha256sum public/models/slm/tinyllama-1.1b-q4.onnx
 */
const EXPECTED_SHA256 = null;

const args = parseArgs(process.argv.slice(2));

/**
 * Crude argv parser — just enough for `--force` and `--url=...`. We
 * deliberately avoid a CLI library dep so this script stays
 * `node-only` and runs from any CI without an npm install.
 */
function parseArgs(argv) {
  const out = { force: false, url: DEFAULT_URL };
  for (const a of argv) {
    if (a === '--force') out.force = true;
    else if (a.startsWith('--url=')) out.url = a.slice('--url='.length);
  }
  return out;
}

async function main() {
  // 1. Skip if already present and the user didn't pass --force.
  if (!args.force && existsSync(DEST_ABS)) {
    const size = statSync(DEST_ABS).size;
    console.log(
      `[slm-model] ${DEST_REL} already exists (${formatBytes(size)}); skipping. Pass --force to redownload.`,
    );
    return 0;
  }

  // 2. Make sure the destination directory exists.
  mkdirSync(dirname(DEST_ABS), { recursive: true });

  // 3. Stream-download into a `.partial` sibling so a failed run
  //    doesn't leave a half-written ONNX where the dev server can
  //    serve it.
  const tmpPath = `${DEST_ABS}.partial`;
  if (existsSync(tmpPath)) {
    await rm(tmpPath);
  }

  console.log(`[slm-model] downloading ${args.url}`);
  console.log(`[slm-model]    → ${DEST_REL}`);

  const res = await fetch(args.url);
  if (!res.ok) {
    throw new Error(
      `[slm-model] HTTP ${res.status} ${res.statusText} fetching ${args.url}`,
    );
  }
  if (!res.body) {
    throw new Error('[slm-model] response had no body');
  }

  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  const hash = createHash('sha256');

  const sink = createWriteStream(tmpPath);
  // Tap into the stream for progress + hash without buffering the
  // whole 600 MB in memory.
  const tap = Readable.from(progressTap(res.body, (chunk) => {
    received += chunk.byteLength;
    hash.update(chunk);
    if (total > 0) {
      const pct = ((received / total) * 100).toFixed(1);
      process.stdout.write(`\r[slm-model] ${formatBytes(received)} / ${formatBytes(total)} (${pct}%)   `);
    }
  }));

  await pipeline(tap, sink);
  process.stdout.write('\n');

  const digest = hash.digest('hex');
  console.log(`[slm-model] sha256 = ${digest}`);

  if (EXPECTED_SHA256 && digest !== EXPECTED_SHA256) {
    await rm(tmpPath);
    throw new Error(
      `[slm-model] SHA-256 mismatch.\n  expected: ${EXPECTED_SHA256}\n  got:      ${digest}\nFile rejected.`,
    );
  }
  if (!EXPECTED_SHA256) {
    console.warn(
      '[slm-model] WARNING: EXPECTED_SHA256 is null in this script. ' +
        'Verify the hash above and pin it before merging.',
    );
  }

  await rename(tmpPath, DEST_ABS);
  console.log(`[slm-model] OK — ${DEST_REL} (${formatBytes(received)}).`);
  console.log(
    '[slm-model] Reminder: do NOT commit this file. Serve it from CDN in production.',
  );
  return 0;
}

/**
 * Convert a Web ReadableStream into an async iterable that also hands
 * each chunk to `cb` as it flows through. Lets us compute the SHA-256
 * + show progress without pulling the whole download into memory.
 */
async function* progressTap(body, cb) {
  const reader = body.getReader();
  // eslint-disable-next-line no-constant-condition
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

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
