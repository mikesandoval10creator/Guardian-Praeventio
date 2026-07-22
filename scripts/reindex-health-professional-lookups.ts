/**
 * Resumable HMAC lookup-index rotation for encrypted professional identities.
 *
 * Production usage is intentionally explicit:
 *   HEALTH_LOOKUP_ROTATION_ACTOR=<operator uid> \
 *   npm run health:professional:reindex-lookups -- --batch-size=100
 *
 * Configure HEALTH_PROFESSIONAL_LOOKUP_KEYS with the new key first and the
 * retiring key(s) afterwards. The command decrypts one RUT envelope at a time
 * through Cloud KMS, derives every configured HMAC in memory, and delegates an
 * atomic identity/index/audit write to the production repository.
 */
import admin from 'firebase-admin';

import {
  createFirestoreProfessionalIdentityRepository,
  parseProfessionalLookupKeys,
} from '../src/server/routes/healthProfessionals.js';
import { createHealthProfessionalIdentityStore } from '../src/server/services/healthProfessionalIdentityStore.js';
import { getKmsAdapter } from '../src/services/security/kmsAdapter.js';

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function positiveInteger(name: string, fallback: number, maximum: number): number {
  const raw = option(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`--${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

async function main() {
  if (process.env.KMS_ADAPTER !== 'cloud-kms') {
    throw new Error('KMS_ADAPTER must be cloud-kms for professional lookup rotation');
  }
  const actorUid = option('actor') ?? process.env.HEALTH_LOOKUP_ROTATION_ACTOR;
  if (!actorUid) {
    throw new Error('Set HEALTH_LOOKUP_ROTATION_ACTOR or pass --actor=<operator uid>');
  }
  const lookupKeys = parseProfessionalLookupKeys(
    process.env.HEALTH_PROFESSIONAL_LOOKUP_KEYS,
    process.env.HEALTH_PROFESSIONAL_LOOKUP_KEY,
  );
  if (lookupKeys.length < 2) {
    throw new Error(
      'Rotation requires at least two lookup keys: new primary first, retiring key afterwards',
    );
  }
  if (!admin.apps.length) admin.initializeApp();

  const batchSize = positiveInteger('batch-size', 100, 250);
  const maxBatches = positiveInteger('max-batches', 10_000, 10_000);
  let cursor = option('after');
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalUnchanged = 0;
  const store = createHealthProfessionalIdentityStore({
    repository: createFirestoreProfessionalIdentityRepository(admin.firestore()),
    kmsAdapter: getKmsAdapter(),
    lookupKeys,
  });

  for (let batch = 1; batch <= maxBatches; batch += 1) {
    const page = await store.reindexLookupKeys({
      actorUid,
      afterUid: cursor,
      limit: batchSize,
    });
    totalProcessed += page.processed;
    totalUpdated += page.updated;
    totalUnchanged += page.unchanged;
    console.info(JSON.stringify({
      batch,
      processed: page.processed,
      updated: page.updated,
      unchanged: page.unchanged,
      done: page.done,
      nextCursor: page.nextCursor ?? null,
    }));
    if (page.done) {
      console.info(JSON.stringify({
        result: 'complete',
        totalProcessed,
        totalUpdated,
        totalUnchanged,
      }));
      return;
    }
    if (!page.nextCursor || page.nextCursor === cursor) {
      throw new Error('Reindex cursor did not advance');
    }
    cursor = page.nextCursor;
  }
  throw new Error(`Reached --max-batches; resume with --after=${cursor ?? ''}`);
}

main().catch((error) => {
  console.error('[health-professional-lookup-reindex] failed', error);
  process.exitCode = 1;
});
