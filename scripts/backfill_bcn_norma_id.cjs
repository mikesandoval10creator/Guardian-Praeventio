#!/usr/bin/env node
/**
 * Praeventio Guard — Round 17 (R5 agent): BCN deep-link backfill.
 *
 * Run with:
 *   node scripts/backfill_bcn_norma_id.cjs           # dry-run (default)
 *   node scripts/backfill_bcn_norma_id.cjs --live    # actually write
 *
 * After testing locally with the default dry-run, re-run with `--live` to
 * persist `metadata.bcnNormaId` on every legal/normative node we can map.
 *
 * BACKGROUND
 *   Round 16 R1 added a deep-link button on KnowledgeGraph nodes whose
 *   `metadata.bcnNormaId` is set (links straight to the norm in BCN's
 *   leychile.cl). Existing nodes don't have that field, so the button
 *   silently falls back to a free-text search. This script enriches them
 *   in-place by parsing well-known patterns out of `title` / `description`.
 *
 * MAPPING TABLE
 *   We hard-code the BCN idNorma values for the canonical Chilean OSH
 *   norms. These IDs are stable in BCN's database (verified against
 *   leychile.cl on 2026-04-28). When we cannot map a node confidently,
 *   we leave it untouched — better an honest free-text search than a
 *   wrong deep-link.
 *
 *     DS 54 (Reglamento de los Comités Paritarios)        → 88536
 *     DS 40 (Reglamento sobre Prevención de Riesgos Pro.) → 1041130
 *     DS 594 (Condiciones sanitarias y ambientales)       → 167766
 *     Ley 16.744 (Seguro de Accidentes del Trabajo)       → 28650
 *     ISO 45001 — international standard, NOT on BCN. Skipped.
 *
 *   The script is idempotent: nodes that already have a bcnNormaId are
 *   left alone, regardless of whether the existing value matches our
 *   mapping (manual overrides win).
 *
 * BATCHING
 *   Firestore caps batch writes at 500 operations. We chunk updates
 *   into batches of 450 to leave headroom.
 *
 * EXIT CODES
 *   0 — script completed (dry-run or live), zero or more updates done
 *   1 — fatal error during execution (missing creds, network, etc.)
 */

'use strict';

const admin = require('firebase-admin');

// ---- arg parsing -----------------------------------------------------------

const args = process.argv.slice(2);
const live = args.includes('--live');
const verbose = !args.includes('--quiet');

function log(...m) {
  // eslint-disable-next-line no-console
  console.log('[backfill-bcn]', ...m);
}
function warn(...m) {
  // eslint-disable-next-line no-console
  console.warn('[backfill-bcn][WARN]', ...m);
}
function fail(msg, code = 1) {
  // eslint-disable-next-line no-console
  console.error(`[backfill-bcn][FATAL] ${msg}`);
  process.exit(code);
}

// ---- mapping ---------------------------------------------------------------

/**
 * Each entry: a regex that matches the norm's canonical reference and the
 * BCN idNorma we want to stamp. Order matters — more-specific patterns
 * come first (DS 594 must beat DS 5 if we ever add the latter).
 */
const NORM_PATTERNS = [
  { regex: /\bDS\s*0*594\b/i, bcnNormaId: '167766', label: 'DS 594' },
  { regex: /\bDS\s*0*40\b/i, bcnNormaId: '1041130', label: 'DS 40' },
  { regex: /\bDS\s*0*54\b/i, bcnNormaId: '88536', label: 'DS 54' },
  { regex: /\bLey\s*N?\.?\s*16\.?744\b/i, bcnNormaId: '28650', label: 'Ley 16.744' },
  // ISO 45001 is intentionally NOT mapped: international standards aren't
  // hosted on BCN. The fallback free-text search remains the right answer.
];

const MAPPED_NORM_COUNT = NORM_PATTERNS.length; // for the report
log(`mapping table loaded — ${MAPPED_NORM_COUNT} Chilean norms mapped (DS 594, DS 40, DS 54, Ley 16.744)`);

function detectNorm(title, description) {
  const haystack = `${title || ''} ${description || ''}`;
  for (const entry of NORM_PATTERNS) {
    if (entry.regex.test(haystack)) {
      return entry;
    }
  }
  return null;
}

// ---- main ------------------------------------------------------------------

(async () => {
  if (live) {
    log('mode: LIVE — writes will be persisted');
  } else {
    log('mode: DRY-RUN — no writes will happen. Re-run with --live to persist.');
  }

  // Initialize firebase-admin from env / ADC.
  try {
    if (!admin.apps.length) {
      admin.initializeApp();
    }
  } catch (err) {
    fail(`firebase-admin init failed: ${err.message || err}`);
  }
  const db = admin.firestore();

  // Pull every node we might want to enrich. We accept either:
  //   • category === 'legal'         (canonical taxonomy)
  //   • type === 'NORMATIVE'         (legacy enum-style field)
  // and dedupe by doc id.
  log('querying nodes WHERE category=="legal" ...');
  let candidates = new Map();
  try {
    const a = await db.collection('nodes').where('category', '==', 'legal').get();
    a.forEach((d) => candidates.set(d.id, d));
    log(`  found ${a.size} via category=legal`);

    log('querying nodes WHERE type=="NORMATIVE" ...');
    const b = await db.collection('nodes').where('type', '==', 'NORMATIVE').get();
    b.forEach((d) => candidates.set(d.id, d));
    log(`  found ${b.size} via type=NORMATIVE (deduped: total=${candidates.size})`);
  } catch (err) {
    fail(`Firestore query failed: ${err.message || err}`);
  }

  if (candidates.size === 0) {
    log('no candidate nodes found — nothing to do');
    process.exit(0);
  }

  // Plan updates.
  const planned = [];
  let alreadyHas = 0;
  let unmapped = 0;
  for (const docSnap of candidates.values()) {
    const data = docSnap.data() || {};
    const meta = data.metadata || {};
    if (meta.bcnNormaId) {
      alreadyHas++;
      if (verbose) log(`  skip ${docSnap.id}: already has bcnNormaId=${meta.bcnNormaId}`);
      continue;
    }
    const match = detectNorm(data.title, data.description);
    if (!match) {
      unmapped++;
      if (verbose) log(`  skip ${docSnap.id}: no norm pattern matched (title="${data.title || ''}")`);
      continue;
    }
    planned.push({ id: docSnap.id, ref: docSnap.ref, match, title: data.title || '' });
    if (verbose) log(`  plan ${docSnap.id}: ${match.label} → bcnNormaId=${match.bcnNormaId}`);
  }

  log('---- summary ----');
  log(`candidates examined : ${candidates.size}`);
  log(`already has field   : ${alreadyHas}`);
  log(`could not be mapped : ${unmapped}`);
  log(`planned updates     : ${planned.length}`);

  if (!live) {
    log('dry-run complete. No writes performed.');
    process.exit(0);
  }
  if (planned.length === 0) {
    log('nothing to write — exiting cleanly.');
    process.exit(0);
  }

  // Apply updates in batches of 450 (Firestore caps at 500).
  const BATCH_SIZE = 450;
  let written = 0;
  let errors = 0;
  for (let i = 0; i < planned.length; i += BATCH_SIZE) {
    const slice = planned.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { ref, match } of slice) {
      // Use a dotted-path update so we don't clobber sibling metadata fields.
      batch.update(ref, { 'metadata.bcnNormaId': match.bcnNormaId });
    }
    try {
      await batch.commit();
      written += slice.length;
      log(`batch committed: ${written}/${planned.length} written`);
    } catch (err) {
      errors += slice.length;
      warn(`batch commit failed (${slice.length} docs): ${err.message || err}`);
    }
  }

  log('---- live run summary ----');
  log(`written : ${written}`);
  log(`failed  : ${errors}`);
  process.exit(errors === 0 ? 0 : 1);
})().catch((err) => {
  fail(`unhandled error: ${err && err.stack ? err.stack : err}`);
});
