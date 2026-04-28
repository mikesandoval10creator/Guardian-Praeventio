#!/usr/bin/env node
/**
 * One-shot migration: re-wrap legacy plaintext OAuth refresh_tokens into
 * envelope-encrypted form using the configured KMS adapter.
 *
 * The runtime read path in `src/services/oauthTokenStore.ts` already accepts
 * BOTH legacy plaintext strings AND envelope objects, so this script is not
 * required for cutover — flipping `OAUTH_ENVELOPE_ENABLED=true` is safe by
 * itself. But until we re-wrap legacy docs, those refresh_tokens still sit
 * unwrapped in Firestore. This script proactively closes that gap.
 *
 * Idempotent: a doc whose `refresh_token` is already an envelope object is
 * skipped, so re-running the script after a partial run yields zero
 * migrations on the second pass.
 *
 * Usage:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=path/to/sa.json \
 *   KMS_KEY_RESOURCE_NAME=projects/<proj>/locations/southamerica-west1/keyRings/praeventio/cryptoKeys/oauth-tokens-kek \
 *   KMS_ADAPTER=cloud-kms \
 *   OAUTH_ENVELOPE_ENABLED=true \
 *   node scripts/migrate-oauth-tokens-to-envelope.cjs --dry-run
 *
 * Flags:
 *   --dry-run       Print counts + sample uids; perform NO writes.
 *   --batch=<N>     Process at most N docs total (default: 10000 — i.e. all).
 *
 * Implementation note (CJS / ESM bridge):
 *   The TS sources (`kmsEnvelope.ts`, `kmsAdapter.ts`) are ESM with
 *   `.ts`-suffixed imports, so they cannot be `require()`d from a `.cjs`
 *   script directly. We use dynamic `import()` and run the script under
 *   `tsx` (or `ts-node --esm` if you prefer) so the TS modules resolve:
 *
 *     npx tsx scripts/migrate-oauth-tokens-to-envelope.cjs --dry-run
 *
 *   Falling back to plain `node` works only if the project ships compiled
 *   JS at `dist/services/security/...`. We try `tsx` first via the dynamic
 *   import; if that fails the script prints a helpful message.
 */

'use strict';

const admin = require('firebase-admin');

// ---- arg parsing -----------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const batchArg = args.find((a) => a.startsWith('--batch='));
const batchLimit = batchArg ? Math.max(1, parseInt(batchArg.split('=')[1], 10) || 10000) : 10000;

function log(...m) {
  // eslint-disable-next-line no-console
  console.log('[migrate-oauth-tokens]', ...m);
}
function warn(...m) {
  // eslint-disable-next-line no-console
  console.warn('[migrate-oauth-tokens][WARN]', ...m);
}
function fail(msg, code = 1) {
  // eslint-disable-next-line no-console
  console.error(`[migrate-oauth-tokens][FATAL] ${msg}`);
  process.exit(code);
}

// ---- main ------------------------------------------------------------------

(async () => {
  // 1. Pre-flight: required env.
  if (!process.env.KMS_KEY_RESOURCE_NAME && process.env.KMS_ADAPTER === 'cloud-kms') {
    fail(
      'KMS_ADAPTER=cloud-kms but KMS_KEY_RESOURCE_NAME is not set. ' +
        'Export the full key resource name (projects/.../oauth-tokens-kek).',
    );
  }
  if (process.env.OAUTH_ENVELOPE_ENABLED !== 'true') {
    warn(
      'OAUTH_ENVELOPE_ENABLED is not "true". The runtime would still write ' +
        'plaintext after this migration. Continuing anyway, but flip it before flipping prod traffic.',
    );
  }

  // 2. Dynamic import of TS modules. Requires the script to be invoked
  // through tsx / ts-node-esm (or a compiled JS path — see file header).
  let envelopeEncrypt;
  let isEnvelopeCiphertext;
  let getKmsAdapter;
  try {
    ({ envelopeEncrypt, isEnvelopeCiphertext } = await import(
      '../src/services/security/kmsEnvelope.ts'
    ));
    ({ getKmsAdapter } = await import('../src/services/security/kmsAdapter.ts'));
  } catch (err) {
    fail(
      'Failed to import TS modules. Run the script via tsx so .ts files resolve, e.g.:\n' +
        '    npx tsx scripts/migrate-oauth-tokens-to-envelope.cjs --dry-run\n' +
        `Original error: ${err && err.message ? err.message : err}`,
    );
    return; // unreachable, but keeps lint happy
  }

  // 3. Init firebase-admin once. Pulls credentials from
  // GOOGLE_APPLICATION_CREDENTIALS or default ADC.
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  const db = admin.firestore();

  const adapter = getKmsAdapter();
  if (!adapter.isAvailable) {
    fail(
      `Selected KMS adapter '${adapter.name}' is not available. ` +
        'Check KMS_ADAPTER + KMS_KEY_RESOURCE_NAME.',
    );
  }
  log(`Using KMS adapter: ${adapter.name} (dry-run=${dryRun}, batch=${batchLimit})`);

  // 4. Iterate the collection. We use a single get() rather than streaming
  // because the oauth_tokens collection is small (~1 doc per linked
  // user × provider). If it grows large, switch to a paginated cursor.
  const snap = await db.collection('oauth_tokens').limit(batchLimit).get();
  log(`Read ${snap.size} oauth_tokens docs (cap=${batchLimit}).`);

  let total = 0;
  let migrated = 0;
  let alreadyEnvelope = 0;
  let missingRefresh = 0;
  let unknownShape = 0;
  let failed = 0;
  const failedIds = [];

  for (const doc of snap.docs) {
    total++;
    const data = doc.data() || {};
    const rt = data.refresh_token;

    if (rt === undefined || rt === null) {
      missingRefresh++;
      warn(`${doc.id}: no refresh_token field, skipping.`);
      continue;
    }
    if (typeof rt !== 'string') {
      // Object — possibly an envelope already.
      if (isEnvelopeCiphertext(rt)) {
        alreadyEnvelope++;
        continue;
      }
      unknownShape++;
      warn(`${doc.id}: refresh_token has unrecognized shape (typeof=${typeof rt}), skipping.`);
      continue;
    }

    // Plain string == legacy plaintext. Wrap it.
    try {
      const envelope = await envelopeEncrypt(rt, adapter);
      if (dryRun) {
        log(`[dry-run] would migrate ${doc.id}`);
      } else {
        await doc.ref.update({
          refresh_token: envelope,
          // Bump updatedAt so observers see the change. Use server timestamp
          // for consistency with the rest of the store.
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      migrated++;
    } catch (err) {
      failed++;
      failedIds.push(doc.id);
      warn(`${doc.id}: migration failed — ${err && err.message ? err.message : err}`);
    }
  }

  log('--- migration summary ---');
  log(`total           : ${total}`);
  log(`migrated        : ${migrated}${dryRun ? ' (dry-run; no writes)' : ''}`);
  log(`already-envelope: ${alreadyEnvelope}`);
  log(`missing-refresh : ${missingRefresh}`);
  log(`unknown-shape   : ${unknownShape}`);
  log(`failed          : ${failed}`);
  if (failedIds.length) {
    log('failed doc ids  :', failedIds.slice(0, 20).join(', '), failedIds.length > 20 ? '…' : '');
  }

  // Exit non-zero if any failures, so a CI/cron orchestrator notices.
  process.exit(failed === 0 ? 0 : 2);
})().catch((err) => {
  fail(`Unhandled error: ${err && err.stack ? err.stack : err}`);
});
