#!/usr/bin/env node
'use strict';

/**
 * Keep the store bundles free of the 483 MB browser SLM model and within a
 * predictable size budget.
 *
 * The web app may pre-package `public/models/qwen-2.5-0.5b` for desktop use.
 * The mobile WebView does not need that file: the debug build sets
 * `SLM_PREPACKAGE_SKIP=1` and is ~65 MB, while a release build without the
 * skip produced a 443 MB AAB that included
 * `base/assets/public/models/qwen-2.5-0.5b/model_q4f16.onnx`.
 *
 * The release pipeline runs this against `dist` after the web build (before
 * `cap sync`) and against the signed AAB after the build. The explicit model
 * check gives a clear diagnosis; the byte budgets catch future bloat.
 *
 * Usage:
 *   node scripts/check-mobile-bundle.cjs --assets dist
 *   node scripts/check-mobile-bundle.cjs --aab android/app/build/outputs/bundle/release/app-release.aab
 *   node scripts/check-mobile-bundle.cjs --assets dist --aab app-release.aab
 */

const fs = require('node:fs');
const path = require('node:path');

const MB = 1024 * 1024;
const DEFAULT_MAX_ASSETS_BYTES = 200 * MB;
const DEFAULT_MAX_AAB_BYTES = 250 * MB;
const BROWSER_SLM_DIR = path.join('models', 'qwen-2.5-0.5b');

function walkFiles(dir) {
  const files = [];
  const pending = [dir];

  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) files.push(full);
    }
  }

  return files;
}

function findBundleProblems(options = {}) {
  const {
    assetsDir,
    maxAssetsBytes = DEFAULT_MAX_ASSETS_BYTES,
    aabPath,
    maxAabBytes = DEFAULT_MAX_AAB_BYTES,
  } = options;
  const problems = [];

  if (!assetsDir && !aabPath) {
    problems.push('no --assets or --aab path provided');
  }

  if (assetsDir) {
    if (!fs.existsSync(assetsDir) || !fs.statSync(assetsDir).isDirectory()) {
      problems.push(`mobile assets directory not found: ${assetsDir}`);
    } else {
      const slmDir = path.join(assetsDir, BROWSER_SLM_DIR);
      if (fs.existsSync(slmDir)) {
        problems.push(
          `browser SLM model must not be bundled (found ${slmDir}); set SLM_PREPACKAGE_SKIP=1 and fetch it on demand`,
        );
      }

      const files = walkFiles(assetsDir);
      if (files.length === 0) {
        problems.push(`mobile assets directory is empty: ${assetsDir}`);
      }
      const bytes = files.reduce((total, file) => total + fs.statSync(file).size, 0);
      if (bytes > maxAssetsBytes) {
        problems.push(
          `mobile assets are ${bytes} bytes, over the ${maxAssetsBytes}-byte budget`,
        );
      }
    }
  }

  if (aabPath) {
    if (!fs.existsSync(aabPath)) {
      problems.push(`AAB not found: ${aabPath}`);
    } else {
      const bytes = fs.statSync(aabPath).size;
      if (bytes > maxAabBytes) {
        problems.push(`AAB is ${bytes} bytes, over the ${maxAabBytes}-byte budget`);
      }
    }
  }

  return problems;
}

function readOption(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function readNumberOption(argv, name, fallback) {
  const raw = readOption(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = {
      assetsDir: readOption(argv, '--assets'),
      maxAssetsBytes: readNumberOption(
        argv,
        '--max-assets-bytes',
        DEFAULT_MAX_ASSETS_BYTES,
      ),
      aabPath: readOption(argv, '--aab'),
      maxAabBytes: readNumberOption(argv, '--max-aab-bytes', DEFAULT_MAX_AAB_BYTES),
    };
  } catch (error) {
    console.error(`[mobile-bundle] ${error.message}`);
    return 2;
  }

  const problems = findBundleProblems(options);
  if (problems.length > 0) {
    console.error('[mobile-bundle] FAIL — store bundle is not release-safe:');
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }

  const summary = [];
  if (options.assetsDir) {
    const files = walkFiles(options.assetsDir);
    const bytes = files.reduce((total, file) => total + fs.statSync(file).size, 0);
    summary.push(`${files.length} assets, ${bytes} bytes`);
  }
  if (options.aabPath) {
    summary.push(`AAB ${fs.statSync(options.aabPath).size} bytes`);
  }
  console.log(`[mobile-bundle] PASS — ${summary.join('; ')}`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  BROWSER_SLM_DIR,
  DEFAULT_MAX_AAB_BYTES,
  DEFAULT_MAX_ASSETS_BYTES,
  findBundleProblems,
  main,
  walkFiles,
};
