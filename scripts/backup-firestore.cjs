#!/usr/bin/env node
/**
 * Nightly Firestore export to GCS.
 *
 * Usage (Cloud Scheduler invocation):
 *   GOOGLE_APPLICATION_CREDENTIALS=/secrets/sa.json \
 *   GCS_BACKUP_BUCKET=gs://praeventio-backups \
 *   GCP_PROJECT_ID=praeventio-prod \
 *   node scripts/backup-firestore.cjs
 *
 * Manual:
 *   node scripts/backup-firestore.cjs --collections=audit_logs,medical_exams \
 *     --label=before-migration
 *
 * Output: gs://praeventio-backups/firestore-export-YYYY-MM-DD-HHMM/
 *         (managed export format readable by `gcloud firestore import`)
 *
 * Implementation note:
 *   The Firestore Admin export is a long-running operation (LRO) and is NOT
 *   exposed on the firebase-admin Firestore() instance. We use the
 *   `v1.FirestoreAdminClient` from `@google-cloud/firestore` (a transitive
 *   dep of firebase-admin) to call ExportDocuments / pollOnce. The script
 *   awaits the LRO promise (with timeout) so a Cloud Run job exits cleanly
 *   only after the export is durable in GCS.
 *
 * After the export completes, a `manifest.json` is written next to the
 * export folder in GCS containing:
 *   - timestamp (UTC ISO)
 *   - operation name
 *   - outputUriPrefix
 *   - collectionIds (or [] if all)
 *   - approxDocumentCount per collection (best-effort, sampled at start)
 *   - script version
 *
 * Exit codes:
 *   0 — export completed successfully
 *   1 — bad invocation (missing env, etc.)
 *   2 — export started but failed or timed out
 */

'use strict';

const admin = require('firebase-admin');
const { v1 } = require('@google-cloud/firestore');
const { Storage } = require('@google-cloud/storage');

const SCRIPT_VERSION = '1.0.0';
const DEFAULT_BUCKET = 'gs://praeventio-backups';
// Cloud Scheduler -> Cloud Run job has a 60-min execution window by default.
// We poll the LRO up to 50 minutes to leave headroom for startup + manifest.
const EXPORT_TIMEOUT_MS = 50 * 60 * 1000;

// ---- arg parsing -----------------------------------------------------------

const args = process.argv.slice(2);
const collectionsArg = args.find((a) => a.startsWith('--collections='));
const labelArg = args.find((a) => a.startsWith('--label='));

const collections = collectionsArg
  ? collectionsArg
      .split('=')[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  : [];
const label = labelArg ? labelArg.split('=')[1].trim() : '';

// ---- logging helpers -------------------------------------------------------

function log(...m) {
  // eslint-disable-next-line no-console
  console.log('[backup-firestore]', ...m);
}
function warn(...m) {
  // eslint-disable-next-line no-console
  console.warn('[backup-firestore][WARN]', ...m);
}
function err(...m) {
  // eslint-disable-next-line no-console
  console.error('[backup-firestore][ERROR]', ...m);
}
function fail(msg, code = 1) {
  err(msg);
  process.exit(code);
}

// ---- helpers ---------------------------------------------------------------

function isoTimestampSlug() {
  // 2026-04-28T03:14:09.123Z -> 2026-04-28-0314
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  );
}

function parseGsUri(uri) {
  // gs://bucket/optional/prefix -> { bucket, prefix }
  if (!uri.startsWith('gs://')) {
    throw new Error(`Invalid GCS URI: ${uri} (must start with gs://)`);
  }
  const without = uri.slice('gs://'.length);
  const slash = without.indexOf('/');
  if (slash === -1) return { bucket: without, prefix: '' };
  return { bucket: without.slice(0, slash), prefix: without.slice(slash + 1) };
}

async function approxCount(db, collectionId) {
  // Best-effort sampled count. Limit to 1000 for speed; we do NOT rely on
  // this for correctness — just for the manifest's human-readable summary.
  try {
    const snap = await db.collection(collectionId).limit(1000).count().get();
    return snap.data().count;
  } catch {
    // count() requires Admin SDK >= 11.x. Fall back to a small read.
    try {
      const snap = await db.collection(collectionId).limit(1).get();
      return snap.size === 0 ? 0 : -1; // -1 == "non-empty, exact count not available"
    } catch {
      return -1;
    }
  }
}

// ---- main ------------------------------------------------------------------

(async () => {
  // 1. Pre-flight env.
  const projectId =
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    fail(
      'GCP_PROJECT_ID is not set. Export GCP_PROJECT_ID=praeventio-prod (or pass via env).',
    );
  }
  const bucketUri = process.env.GCS_BACKUP_BUCKET || DEFAULT_BUCKET;
  const { bucket: bucketName, prefix: bucketPrefix } = parseGsUri(bucketUri);

  // 2. Build the timestamped output URI.
  const slug = isoTimestampSlug();
  const folderName = label
    ? `firestore-export-${slug}-${label.replace(/[^a-zA-Z0-9_-]/g, '_')}`
    : `firestore-export-${slug}`;
  const outputUriPrefix = bucketPrefix
    ? `gs://${bucketName}/${bucketPrefix.replace(/\/$/, '')}/${folderName}`
    : `gs://${bucketName}/${folderName}`;

  log(`project=${projectId}`);
  log(`outputUriPrefix=${outputUriPrefix}`);
  log(`collections=${collections.length === 0 ? '(all)' : collections.join(',')}`);
  if (label) log(`label=${label}`);

  // 3. Init firebase-admin for the manifest count step.
  if (!admin.apps.length) {
    admin.initializeApp({ projectId });
  }
  const db = admin.firestore();

  // 4. Pre-export: gather approximate collection counts. If specific
  // collections were requested, only count those; otherwise list root
  // collections and count each.
  let countTargets = collections;
  if (countTargets.length === 0) {
    try {
      const roots = await db.listCollections();
      countTargets = roots.map((c) => c.id);
      log(`discovered ${countTargets.length} root collections.`);
    } catch (e) {
      warn(`listCollections failed: ${e && e.message ? e.message : e}. Manifest will skip counts.`);
      countTargets = [];
    }
  }

  const collectionCounts = {};
  for (const cid of countTargets) {
    // eslint-disable-next-line no-await-in-loop
    collectionCounts[cid] = await approxCount(db, cid);
  }

  // 5. Trigger the export via FirestoreAdminClient.
  const client = new v1.FirestoreAdminClient();
  const databaseName = client.databasePath(projectId, '(default)');

  log('starting exportDocuments()…');
  let operationResult;
  try {
    const [operation] = await client.exportDocuments({
      name: databaseName,
      outputUriPrefix,
      collectionIds: collections, // empty array == all
    });
    log(`operation started: ${operation.name}`);

    // Race the LRO promise against a hard timeout.
    operationResult = await Promise.race([
      operation.promise(),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `export operation did not complete within ${EXPORT_TIMEOUT_MS / 60000} minutes`,
              ),
            ),
          EXPORT_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (e) {
    fail(`exportDocuments failed: ${e && e.stack ? e.stack : e}`, 2);
  }

  const [response] = operationResult;
  const finalOutputUri = (response && response.outputUriPrefix) || outputUriPrefix;
  log(`export complete. outputUriPrefix=${finalOutputUri}`);

  // 6. Write manifest.json into the export folder for integrity testing.
  try {
    const storage = new Storage({ projectId });
    const { bucket: manifestBucket, prefix: manifestPrefix } = parseGsUri(finalOutputUri);
    const manifestPath = manifestPrefix
      ? `${manifestPrefix.replace(/\/$/, '')}/manifest.json`
      : 'manifest.json';

    const manifest = {
      schemaVersion: 1,
      scriptVersion: SCRIPT_VERSION,
      timestamp: new Date().toISOString(),
      project: projectId,
      database: '(default)',
      outputUriPrefix: finalOutputUri,
      collectionIds: collections,
      collectionCounts,
      label: label || null,
    };

    await storage
      .bucket(manifestBucket)
      .file(manifestPath)
      .save(JSON.stringify(manifest, null, 2), {
        contentType: 'application/json',
        metadata: { cacheControl: 'no-cache' },
      });
    log(`wrote manifest gs://${manifestBucket}/${manifestPath}`);
  } catch (e) {
    // Manifest failure is NOT fatal — the export itself is durable.
    warn(`failed to write manifest.json: ${e && e.message ? e.message : e}`);
  }

  log('SUCCESS');
  process.exit(0);
})().catch((e) => {
  fail(`unhandled error: ${e && e.stack ? e.stack : e}`, 2);
});
