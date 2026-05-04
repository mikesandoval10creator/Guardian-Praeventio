#!/usr/bin/env node
/**
 * convert-to-webp.mjs
 *
 * Converts PNG/JPG/JPEG files to WebP using sharp.
 * Used for hero/raster assets in public/. Original files are kept in place
 * as graceful fallbacks for the small set of browsers that still lack WebP.
 *
 * Usage:
 *   node scripts/convert-to-webp.mjs <file1> [file2] [...]   # explicit list
 *   node scripts/convert-to-webp.mjs --all                   # walks public/ and converts every *.png/.jpg/.jpeg
 *
 * Notes:
 * - Quality defaults to 85 (configurable via WEBP_QUALITY env var).
 * - Existing .webp output files are overwritten only when the source mtime is newer.
 * - SVG icons (e.g. public/icons/biology/*) are skipped — placeholders are preserved.
 */
import sharp from 'sharp';
import { readdir, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
const QUALITY = Number(process.env.WEBP_QUALITY ?? 85);
const SUPPORTED = new Set(['.png', '.jpg', '.jpeg']);

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip biology icons (SVG-only placeholders, no raster work needed)
      if (full.includes(path.join('icons', 'biology'))) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

async function shouldConvert(input, output) {
  if (!existsSync(output)) return true;
  const [inStat, outStat] = await Promise.all([stat(input), stat(output)]);
  return inStat.mtimeMs > outStat.mtimeMs;
}

async function convert(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  if (!SUPPORTED.has(ext)) {
    console.warn(`[skip] unsupported extension: ${inputPath}`);
    return null;
  }
  const outputPath = inputPath.slice(0, -ext.length) + '.webp';
  await mkdir(path.dirname(outputPath), { recursive: true });

  if (!(await shouldConvert(inputPath, outputPath))) {
    console.log(`[cached] ${path.relative(REPO_ROOT, outputPath)}`);
    return outputPath;
  }

  const inputStat = await stat(inputPath);
  await sharp(inputPath).webp({ quality: QUALITY }).toFile(outputPath);
  const outputStat = await stat(outputPath);
  const reduction = ((1 - outputStat.size / inputStat.size) * 100).toFixed(1);
  console.log(
    `[ok] ${path.relative(REPO_ROOT, inputPath)} ` +
      `(${(inputStat.size / 1024).toFixed(0)} KB) -> ` +
      `${path.relative(REPO_ROOT, outputPath)} ` +
      `(${(outputStat.size / 1024).toFixed(0)} KB, -${reduction}%)`,
  );
  return outputPath;
}

async function main() {
  const args = process.argv.slice(2);
  let files = [];

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(
      [
        'convert-to-webp.mjs — Convert raster images to WebP using sharp',
        '',
        'Usage:',
        '  node scripts/convert-to-webp.mjs <file1> [file2] ...',
        '  node scripts/convert-to-webp.mjs --all',
        '',
        'Env:',
        '  WEBP_QUALITY (default: 85)',
      ].join('\n'),
    );
    return;
  }

  if (args.includes('--all')) {
    for await (const file of walk(PUBLIC_DIR)) {
      const ext = path.extname(file).toLowerCase();
      if (SUPPORTED.has(ext)) files.push(file);
    }
  } else {
    files = args.map((f) => path.resolve(REPO_ROOT, f));
  }

  if (files.length === 0) {
    console.log('No raster images to convert.');
    return;
  }

  console.log(`Converting ${files.length} file(s) at quality=${QUALITY}...`);
  for (const file of files) {
    try {
      await convert(file);
    } catch (err) {
      console.error(`[error] ${file}: ${err.message}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
