#!/usr/bin/env node
/**
 * fix-mojibake.mjs
 *
 * One-shot cleanup of UTF-8 sequences double-decoded as CP1252 ("mojibake")
 * in source files. The 2026-05-17 audit (H25) flagged ~37 .ts files
 * created during Sprint 19/20 multi-agent runs where the OS console
 * misinterpreted UTF-8 emit as CP1252 before writing to disk.
 *
 * Strategy: operate on raw bytes so we capture the invisible CP1252
 * control characters that show up in the middle of mojibake sequences
 * (e.g. the em-dash mojibake is `0xC3 0xA2 0xE2 0x80 0x9D 0x94` —
 * the `0x9D` is a CP1252 control character that LOOKS like a quote
 * after re-decode but is invisible in many editors).
 *
 * We use Node's `Buffer.indexOf` to find the byte patterns and replace
 * them with the correct UTF-8 bytes.
 *
 * Usage:
 *   node scripts/fix-mojibake.mjs [--dry-run] [--check] [path]
 *
 * Flags:
 *   --dry-run  Show which files would change without writing.
 *   --check    Exit 1 if any file still contains mojibake.
 *   path       Limit to a specific file or directory (default: src/).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';

// Each entry is [mojibake bytes, correct UTF-8 bytes]. Order matters:
// multi-byte sequences first so they don't get partially matched by
// shorter ones (e.g. â€" must be tried before â€).
//
// The mojibake byte pattern is what you get when UTF-8 output is
// re-interpreted as CP1252 (Windows-1252) and re-encoded back to UTF-8.
const REPLACEMENTS = [
  // — em dash: U+2014, UTF-8 [E2 80 94], CP1252 reinterpret → [C3 A2 E2 82 AC E2 80 9D] which then UTF-8 is `â€"`
  // The actual mojibake bytes seen in our files:
  [[0xc3, 0xa2, 0xe2, 0x82, 0xac, 0xe2, 0x80, 0x9d], [0xe2, 0x80, 0x94]], // — em dash
  [[0xc3, 0xa2, 0xe2, 0x82, 0xac, 0xe2, 0x80, 0x9c], [0xe2, 0x80, 0x93]], // – en dash
  [[0xc3, 0xa2, 0xe2, 0x82, 0xac, 0xc2, 0xa2], [0xe2, 0x80, 0xa2]], // • bullet
  [[0xc3, 0xa2, 0xe2, 0x80, 0xa0, 0xc2, 0xb2], [0xe2, 0x86, 0x92]], // → right arrow
  [[0xc3, 0xa2, 0xe2, 0x82, 0xac, 0xcb, 0x9c], [0xe2, 0x80, 0x98]], // ‘ left single quote
  [[0xc3, 0xa2, 0xe2, 0x82, 0xac, 0xe2, 0x84, 0xa2], [0xe2, 0x80, 0x99]], // ’ right single quote / apostrophe
  [[0xc3, 0xa2, 0xe2, 0x82, 0xac, 0xc5, 0x93], [0xe2, 0x80, 0x9c]], // “ left double quote
  // Spanish accented letters (lowercase): Ã + second byte
  [[0xc3, 0x83, 0xc2, 0xa1], [0xc3, 0xa1]], // á
  [[0xc3, 0x83, 0xc2, 0xa9], [0xc3, 0xa9]], // é
  [[0xc3, 0x83, 0xc2, 0xad], [0xc3, 0xad]], // í
  [[0xc3, 0x83, 0xc2, 0xb3], [0xc3, 0xb3]], // ó
  [[0xc3, 0x83, 0xc2, 0xba], [0xc3, 0xba]], // ú
  [[0xc3, 0x83, 0xc2, 0xb1], [0xc3, 0xb1]], // ñ
  [[0xc3, 0x83, 0xc2, 0xbc], [0xc3, 0xbc]], // ü
  // Spanish accented letters (uppercase)
  [[0xc3, 0x83, 0xe2, 0x80, 0x9a], [0xc3, 0x81]], // Á
  [[0xc3, 0x83, 0xe2, 0x80, 0xb0], [0xc3, 0x89]], // É
  [[0xc3, 0x83, 0xe2, 0x80, 0x9d], [0xc3, 0x93]], // Ó
  [[0xc3, 0x83, 0xe2, 0x80, 0x99], [0xc3, 0x91]], // Ñ
  // Sprint 41 follow-up (Codex P2 on PR #361): the first sweep missed
  // these CP1252-control-character mojibake variants. The same Ã/Â
  // double-encoding pattern but with U+0080-U+009F control chars as the
  // second byte, which editors hide.
  [[0xc3, 0x83, 0xc2, 0x8d], [0xc3, 0x8d]], // Í (e.g. "SÍSMICA")
  [[0xc3, 0x83, 0xc2, 0x9c], [0xc3, 0x9c]], // Ü
  [[0xc3, 0x82, 0xc2, 0xb7], [0xc2, 0xb7]], // · middle dot
  [[0xc3, 0x82, 0xc2, 0xa1], [0xc2, 0xa1]], // ¡ inverted exclam
  [[0xc3, 0x82, 0xc2, 0xbf], [0xc2, 0xbf]], // ¿ inverted question
  [[0xc3, 0x82, 0xc2, 0xb0], [0xc2, 0xb0]], // ° degree
  [[0xc3, 0x82, 0xc2, 0xb1], [0xc2, 0xb1]], // ± plus-minus
  [[0xc3, 0x82, 0xc2, 0xa9], [0xc2, 0xa9]], // © copyright
  [[0xc3, 0x82, 0xc2, 0xae], [0xc2, 0xae]], // ® registered
  [[0xc3, 0x82, 0xc2, 0xa7], [0xc2, 0xa7]], // § section
  [[0xc3, 0x82, 0xc2, 0xb6], [0xc2, 0xb6]], // ¶ pilcrow
  [[0xc3, 0x82, 0xc2, 0xa0], [0xc2, 0xa0]], // nbsp
  // Superscripts + math symbols (Codex residual check on PR #361b):
  [[0xc3, 0x82, 0xc2, 0xb2], [0xc2, 0xb2]], // ² superscript 2
  [[0xc3, 0x82, 0xc2, 0xb3], [0xc2, 0xb3]], // ³ superscript 3
  [[0xc3, 0x82, 0xc2, 0xb5], [0xc2, 0xb5]], // µ micro sign
  [[0xc3, 0x83, 0xc2, 0x81], [0xc3, 0x81]], // Á (alt encoding — same target as 0x9a variant)
  // BOM at file start
  [[0xef, 0xbb, 0xbf], []],
];

/**
 * Residual mojibake detector — used by --check mode to flag any
 * suspicious 4-byte Ã/Â+UTF-8-continuation sequence we don't have an
 * explicit rule for yet. Catches future regressions where a new
 * mojibake variant slips through the table.
 *
 * Pattern: lead byte is `0xC3` (Ã) or `0xC2` (Â), next byte is `0xC2`
 * or `0xE2` (typical CP1252-double-encode markers), then a continuation.
 * False positives are rare because legitimate text rarely produces
 * `Ã+Â` adjacent — Spanish/Portuguese accented letters encode as
 * `0xC3 + (0xA0..0xBF)` directly.
 */
const RESIDUAL_PATTERN = /\xc3[\x83\x82]\xc2[\x80-\x9f\xa0-\xbf]/g;

// argv layout: [node binary, this script, ...user args]
const userArgs = process.argv.slice(2);
const dryRun = userArgs.includes('--dry-run');
const checkOnly = userArgs.includes('--check');
const root = userArgs.find((a) => !a.startsWith('--')) ?? 'src';

async function* walkTsFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.stryker-tmp' ||
        entry.name === 'coverage' ||
        entry.name === '.claude'
      ) {
        continue;
      }
      yield* walkTsFiles(full);
    } else if (
      entry.isFile() &&
      (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))
    ) {
      yield full;
    }
  }
}

/**
 * Byte-level find/replace using Buffer.indexOf. Operates iteratively so a
 * single mojibake sequence at multiple offsets is fully replaced before
 * advancing to the next pattern.
 */
function fixBuffer(input) {
  let buf = input;
  let changed = false;
  for (const [bad, good] of REPLACEMENTS) {
    const badBuf = Buffer.from(bad);
    const goodBuf = Buffer.from(good);
    let idx = buf.indexOf(badBuf);
    while (idx !== -1) {
      buf = Buffer.concat([
        buf.subarray(0, idx),
        goodBuf,
        buf.subarray(idx + badBuf.length),
      ]);
      changed = true;
      idx = buf.indexOf(badBuf, idx + goodBuf.length);
    }
  }
  return { buf, changed };
}

async function main() {
  if (!existsSync(root)) {
    console.error(`[fix-mojibake] Path not found: ${root}`);
    process.exit(2);
  }
  const stat = await fs.stat(root);
  const targets = [];
  if (stat.isFile()) {
    targets.push(root);
  } else {
    for await (const f of walkTsFiles(root)) targets.push(f);
  }

  let changedCount = 0;
  let stillBadCount = 0;
  let residualCount = 0;
  for (const file of targets) {
    const original = await fs.readFile(file);
    const { buf, changed } = fixBuffer(original);
    if (changed) {
      changedCount += 1;
      if (checkOnly) {
        stillBadCount += 1;
        console.log(`[fix-mojibake] WOULD-FIX ${file}`);
      } else if (dryRun) {
        console.log(`[fix-mojibake] dry-run ${file}`);
      } else {
        await fs.writeFile(file, buf);
        console.log(`[fix-mojibake] fixed ${file}`);
      }
    }
    if (checkOnly) {
      // Detect residual mojibake patterns NOT in REPLACEMENTS so future
      // variants surface as failures rather than passing silently. Use
      // Latin-1 decoding to operate on the raw bytes via String.
      const asLatin1 = buf.toString('latin1');
      const matches = asLatin1.match(RESIDUAL_PATTERN);
      if (matches && matches.length > 0) {
        residualCount += matches.length;
        console.log(
          `[fix-mojibake] RESIDUAL ${file} (${matches.length} unknown pattern${matches.length === 1 ? '' : 's'})`,
        );
      }
    }
  }

  const verb = dryRun || checkOnly ? 'would change' : 'changed';
  console.log(`[fix-mojibake] ${changedCount} file(s) ${verb}.`);
  if (checkOnly) {
    if (stillBadCount > 0) {
      console.error(`[fix-mojibake] FAIL: ${stillBadCount} file(s) still have known mojibake patterns.`);
      process.exit(1);
    }
    if (residualCount > 0) {
      console.error(
        `[fix-mojibake] FAIL: ${residualCount} residual mojibake-shaped sequence(s) detected. Inspect manually and add to REPLACEMENTS table.`,
      );
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('[fix-mojibake]', err);
  process.exit(2);
});
